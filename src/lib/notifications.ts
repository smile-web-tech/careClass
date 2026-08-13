/**
 * Notifications.
 *
 * Two needs, two mechanisms, chosen deliberately:
 *
 *  - **Class reminders are LOCAL.** The weekly schedule already lives on the
 *    device, so the phone can raise "IELTS Advanced starts in 15 minutes"
 *    entirely by itself. No server, no FCM, no network — which matters here,
 *    because the app reaches its backend through a reverse proxy on a filtered
 *    network. A reminder that depends on connectivity is a reminder that fails
 *    on the morning the wifi is down.
 *
 *  - **Replies need REMOTE push**, because only the server knows a parent wrote
 *    back. That path needs FCM credentials; see `docs/push.md`.
 *
 * This file covers the local half, which works today with no external setup.
 */
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { CalendarEvent, Group, Student } from '@/data/types';
import { translateNow } from '@/i18n/useT';
import { at, fromKey, toKey } from '@/lib/date';
import { sessionsOn } from '@/lib/schedule';

/** How far ahead to schedule. iOS caps an app at 64 pending notifications. */
const HORIZON_DAYS = 14;

/**
 * How many may be queued at once.
 *
 * The 64 is iOS's limit, and the app has to stay under it or the OS drops the
 * overflow silently. Android has no such cap, and every ClassCare teacher is on
 * Android — with two notifications per lesson now, one before and one on the
 * hour, sixty covered barely a week for anyone teaching four classes a day.
 */
const MAX_SCHEDULED = Platform.OS === 'ios' ? 60 : 150;

/**
 * Birthdays share the same iOS ceiling as class reminders, so they get their
 * own slice of it rather than competing: a teacher with sixty students would
 * otherwise have no room left for a single class.
 */
const MAX_BIRTHDAYS = 20;

/** Marks our reminders so we never clear a notification we did not set. */
const REMINDER_KIND = 'class-reminder';

/**
 * The same thing for something the teacher wrote in the calendar themselves.
 *
 * A separate kind rather than a flag on the first, because tapping one has to
 * open the event and tapping the other has to open the group — but they are
 * planned together, cancelled together and counted together, because from the
 * teacher's side there is one setting called Reminders and it means everything
 * in the calendar.
 */
const EVENT_KIND = 'calendar-event';

/**
 * The one that fires as the lesson begins, rather than before it.
 *
 * Its own kind so that tapping it can open the register — which is what a
 * teacher wants at the moment a class starts, and not what they want fifteen
 * minutes earlier.
 */
const STARTED_KIND = 'class-started';

/**
 * When an all-day entry is raised.
 *
 * "Fifteen minutes before" has no meaning for something with no time on it, so
 * the lead is ignored and it arrives at eight in the morning — early enough to
 * change the day around, late enough not to be a 6am alarm.
 */
const ALL_DAY_HOUR = 8;

export type ReminderLead = 0 | 5 | 10 | 15 | 20 | 30 | 60;

/**
 * Why reminders used to arrive after the class had already started.
 *
 * Android 12 stopped honouring exact alarms without permission. Without
 * `SCHEDULE_EXACT_ALARM` in the manifest, `expo-notifications` falls back to an
 * inexact alarm, which Doze is free to defer — in practice by anything from a
 * few minutes to over an hour, which is how "15 minutes before" turned into
 * "some time after it started".
 *
 * The permission is declared in `app.json`, alongside `USE_EXACT_ALARM` (a
 * reminder app is one of the categories Android grants that to outright) and
 * `RECEIVE_BOOT_COMPLETED`, without which every pending reminder is lost when
 * the phone restarts.
 *
 * None of it takes effect until the app is rebuilt — a manifest permission
 * cannot be added over the air.
 */

/** Foreground presentation: show the banner rather than swallowing it. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Ask for permission, returning whether we have it.
 *
 * Never call this on launch. Asking cold, before the teacher has seen a single
 * class, earns a "Don't allow" that is expensive to reverse — iOS only offers
 * the prompt once. The profile screen asks at the moment they enable reminders.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!Device.isDevice) return false; // Simulators cannot receive them.

  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  // `canAskAgain === false` means the OS will not show the prompt any more;
  // the teacher has to go to Settings, so do not pretend to ask.
  if (!existing.canAskAgain) return false;

  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

export async function notificationPermissionStatus(): Promise<
  'granted' | 'denied' | 'undetermined'
> {
  if (!Device.isDevice) return 'denied';
  const { granted, canAskAgain } = await Notifications.getPermissionsAsync();
  if (granted) return 'granted';
  return canAskAgain ? 'undetermined' : 'denied';
}

/**
 * Android shows nothing without a channel. Safe to call repeatedly.
 *
 * Two channels, not one: a teacher who mutes class reminders during a holiday
 * still wants to know a parent wrote back, and Android only lets them make that
 * distinction if the app made it first.
 */
export async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;

  // Re-registering an existing id updates its name in place, which is how a
  // language change reaches Android's own settings screen. The id must never
  // change: Android treats a new id as a new channel, and the teacher's
  // mute-this-one choice would silently reset.
  await Notifications.setNotificationChannelAsync('classes', {
    name: translateNow('notif.channelClasses'),
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#2457E8',
  });

  // The id here must match `channel_id` in `supabase/functions/_shared/fcm.ts`;
  // Android 8+ silently drops a notification naming a channel that does not
  // exist, which looks exactly like push being broken.
  await Notifications.setNotificationChannelAsync('replies', {
    name: translateNow('notif.channelReplies'),
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#2457E8',
  });
}

/**
 * Rebuild the whole reminder schedule: classes and calendar entries together.
 *
 * One function and one lead time, because there is one switch in Profile and it
 * says Reminders. A teacher who asks to be told fifteen minutes before means
 * fifteen minutes before whatever it is — a lesson, a parents' evening, an exam
 * they typed in themselves. Splitting that into two settings would be asking
 * the same question twice.
 *
 * Cancels and re-creates rather than diffing: the set is small, and a diff that
 * gets it subtly wrong leaves a teacher being reminded about a class they moved
 * last week. Correctness is worth more than the handful of syscalls.
 */
export async function rescheduleReminders(
  groups: Group[],
  events: CalendarEvent[],
  lead: ReminderLead,
) {
  if (!Device.isDevice) return 0;
  const { granted } = await Notifications.getPermissionsAsync();
  if (!granted) return 0;

  await cancelClassReminders();
  await ensureAndroidChannel();

  const now = Date.now();

  /** One pending reminder, whichever kind of thing it is about. */
  type Planned = {
    when: Date;
    title: string;
    body: string;
    data: Record<string, string>;
  };
  const planned: Planned[] = [];

  /*
    The text is frozen into the OS at scheduling time, not read when it fires —
    which is why switching language has to re-plan the whole set.
  */
  const leadText = (start: string) =>
    lead === 0
      ? translateNow('notif.startingNow')
      : translateNow('notif.startsIn', { min: lead, time: start });

  for (let d = 0; d < HORIZON_DAYS; d++) {
    const day = new Date();
    day.setDate(day.getDate() + d);

    for (const s of sessionsOn(groups, day)) {
      const group = groups.find((g) => g.id === s.groupId);
      if (!group) continue;

      const startsAt = at(toKey(day), s.start).getTime();
      const room = group.room?.trim();

      const fireAt = new Date(startsAt - lead * 60_000);
      // A lead time can push the reminder into the past for today's classes.
      if (fireAt.getTime() > now + 30_000) {
        const when = leadText(s.start);
        planned.push({
          when: fireAt,
          title: group.name,
          // A room is optional in practice even though the type says otherwise:
          // an online class has none, and " · undefined" in a notification is
          // the kind of detail that makes an app look unfinished.
          body: room ? `${when} · ${room}` : when,
          data: { kind: REMINDER_KIND, groupId: group.id, start: s.start },
        });
      }

      /*
        And one on the hour itself.

        The lead reminder says a class is coming; this says it is happening. A
        tutor running back-to-back lessons uses the second one to actually
        start — and with a lead of 30 minutes, the warning has long since
        scrolled off the lock screen by the time it matters.

        Skipped when the lead is zero, because then the two would fire at the
        same second and say almost the same thing.
      */
      if (lead !== 0 && startsAt > now + 30_000) {
        planned.push({
          when: new Date(startsAt),
          title: group.name,
          body: room
            ? `${translateNow('notif.started')} · ${room}`
            : translateNow('notif.started'),
          data: { kind: STARTED_KIND, groupId: group.id, start: s.start },
        });
      }
    }
  }

  /*
    Everything the teacher put in the calendar themselves, on the same terms.

    Reminders used to cover classes and nothing else, so a parents' evening
    typed into the calendar was a note the app kept and never mentioned again —
    which is the one thing a teacher writes it down for.
  */
  const horizonEnd = now + HORIZON_DAYS * 86_400_000;

  for (const event of events) {
    const day = fromKey(event.date);
    if (Number.isNaN(day.getTime())) continue;

    const fireAt = event.allDay
      ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), ALL_DAY_HOUR, 0, 0, 0)
      : event.start
        ? new Date(at(event.date, event.start).getTime() - lead * 60_000)
        : null;

    if (!fireAt) continue;
    if (fireAt.getTime() <= now + 30_000) continue;
    if (fireAt.getTime() > horizonEnd) continue;

    planned.push({
      when: fireAt,
      title: event.title,
      body:
        event.allDay || !event.start
          ? translateNow('notif.todayAllDay')
          : leadText(event.start),
      data: { kind: EVENT_KIND, eventId: event.id },
    });
  }

  planned.sort((a, b) => a.when.getTime() - b.when.getTime());

  // The cap is shared rather than one budget each. iOS allows 64 pending
  // notifications per app whatever they are about, and a teacher with a full
  // calendar should get the next sixty things in order, not sixty classes and
  // none of the events they typed in themselves.
  for (const p of planned.slice(0, MAX_SCHEDULED)) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: p.title,
        body: p.body,
        data: p.data,
        ...(Platform.OS === 'android' ? { channelId: 'classes' } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: p.when,
      },
    });
  }

  return Math.min(planned.length, MAX_SCHEDULED);
}

/* -------------------------------------------------------------------------- */
/* Birthdays                                                                  */
/* -------------------------------------------------------------------------- */

const BIRTHDAY_KIND = 'student-birthday';

/** The evening before, at six. Late enough to be remembered, early enough to act. */
const BIRTHDAY_HOUR = 18;

/**
 * Remind the teacher of a birthday the night before.
 *
 * The night before rather than on the day, because the useful version of this
 * reminder is the one that arrives while there is still time to bring
 * something. A notification at 8am on the day is a notification about a thing
 * already happening.
 *
 * Scheduled locally from the dates already on the device, so it works with no
 * connection — and re-planned whenever the roster changes, which is what stops
 * a deleted student wishing themselves many happy returns next March.
 */
export async function rescheduleBirthdays(students: Student[]) {
  if (!Device.isDevice) return 0;
  const { granted } = await Notifications.getPermissionsAsync();
  if (!granted) return 0;

  await cancelBirthdays();
  await ensureAndroidChannel();

  const now = new Date();
  const planned: { when: Date; name: string; id: string }[] = [];

  for (const student of students) {
    if (!student.birthDate) continue;

    const born = fromKey(student.birthDate);
    if (Number.isNaN(born.getTime())) continue;

    // This year's occurrence, or next year's if it has already passed. The
    // eve is what gets scheduled, so the comparison is against the eve too.
    for (const year of [now.getFullYear(), now.getFullYear() + 1]) {
      const birthday = new Date(year, born.getMonth(), born.getDate());
      const eve = new Date(birthday);
      eve.setDate(eve.getDate() - 1);
      eve.setHours(BIRTHDAY_HOUR, 0, 0, 0);

      if (eve.getTime() <= now.getTime() + 60_000) continue;

      // Whose birthday it is, and nothing else. The age used to be worked out
      // and announced, which is both a guess — a birth year typed to get past a
      // required field is not a fact — and not the app's to say out loud.
      planned.push({ when: eve, name: student.name, id: student.id });
      break;
    }
  }

  planned.sort((a, b) => a.when.getTime() - b.when.getTime());

  for (const p of planned.slice(0, MAX_BIRTHDAYS)) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: translateNow('notif.birthdayTitle'),
        body: translateNow('notif.birthdayBody', { name: p.name }),
        data: { kind: BIRTHDAY_KIND, studentId: p.id },
        ...(Platform.OS === 'android' ? { channelId: 'classes' } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: p.when,
      },
    });
  }

  return Math.min(planned.length, MAX_BIRTHDAYS);
}

export async function cancelBirthdays() {
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    pending
      .filter((n) => n.content.data?.kind === BIRTHDAY_KIND)
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

/** True for a reminder this app planned, class or calendar entry alike. */
const isReminder = (kind: unknown) =>
  kind === REMINDER_KIND || kind === EVENT_KIND || kind === STARTED_KIND;

/** Remove only our reminders, leaving any other notification alone. */
export async function cancelClassReminders() {
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    pending
      .filter((n) => isReminder(n.content.data?.kind))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

/** How many reminders are currently queued — shown in the profile screen. */
export async function scheduledReminderCount() {
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  return pending.filter((n) => isReminder(n.content.data?.kind)).length;
}

/**
 * The device's raw FCM/APNs token, for server-sent push.
 *
 * Deliberately NOT `getExpoPushTokenAsync`, which registers with `exp.host`.
 * That host is as likely to be filtered as `supabase.co` was, and a sign-in
 * that hangs on a push registration would be a self-inflicted outage. The raw
 * token comes from Play Services, which is reachable, and the server can talk
 * to FCM directly.
 */
export async function getDevicePushToken(): Promise<string | null> {
  if (!Device.isDevice) return null;
  try {
    const { granted } = await Notifications.getPermissionsAsync();
    if (!granted) return null;
    const token = await Notifications.getDevicePushTokenAsync();
    return typeof token.data === 'string' ? token.data : null;
  } catch {
    // No FCM credentials in the build yet, or Play Services unavailable.
    return null;
  }
}

/**
 * Register this device for server-sent push, and store the token.
 *
 * Called after sign-in and whenever notification permission is granted. Safe to
 * call repeatedly: FCM returns the same token until it rotates, and writing an
 * unchanged value costs one cheap update.
 *
 * Everything here fails soft. A build without FCM credentials, a device without
 * Play Services, a teacher who declined notifications — none of those are
 * errors worth interrupting anyone over, and all of them simply mean no push.
 */
export async function registerForPush(save: (token: string) => Promise<unknown>): Promise<boolean> {
  try {
    const token = await getDevicePushToken();
    if (!token) return false;

    await ensureAndroidChannel();
    await save(token);
    return true;
  } catch (e) {
    console.warn('[classcare] push registration skipped:', e instanceof Error ? e.message : e);
    return false;
  }
}

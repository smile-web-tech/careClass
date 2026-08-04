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

import type { Group } from '@/data/types';
import { at, toKey } from '@/lib/date';
import { sessionsOn } from '@/lib/schedule';

/** How far ahead to schedule. iOS caps an app at 64 pending notifications. */
const HORIZON_DAYS = 14;
const MAX_SCHEDULED = 60;

/** Marks our reminders so we never clear a notification we did not set. */
const REMINDER_KIND = 'class-reminder';

export type ReminderLead = 0 | 5 | 15 | 30 | 60;

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

export async function notificationPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  if (!Device.isDevice) return 'denied';
  const { granted, canAskAgain } = await Notifications.getPermissionsAsync();
  if (granted) return 'granted';
  return canAskAgain ? 'undetermined' : 'denied';
}

/** Android shows nothing without a channel. Safe to call repeatedly. */
export async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('classes', {
    name: 'Class reminders',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#2457E8',
  });
}

/**
 * Rebuild the reminder schedule from the current groups.
 *
 * Cancels and re-creates rather than diffing: the set is small, and a diff that
 * gets it subtly wrong leaves a teacher being reminded about a class they moved
 * last week. Correctness is worth more than the handful of syscalls.
 */
export async function rescheduleClassReminders(groups: Group[], lead: ReminderLead) {
  if (!Device.isDevice) return 0;
  const { granted } = await Notifications.getPermissionsAsync();
  if (!granted) return 0;

  await cancelClassReminders();
  await ensureAndroidChannel();

  const now = Date.now();
  const planned: { when: Date; group: Group; start: string }[] = [];

  for (let d = 0; d < HORIZON_DAYS; d++) {
    const day = new Date();
    day.setDate(day.getDate() + d);
    for (const s of sessionsOn(groups, day)) {
      const group = groups.find((g) => g.id === s.groupId);
      if (!group) continue;
      const fireAt = new Date(at(toKey(day), s.start).getTime() - lead * 60_000);
      // A lead time can push the reminder into the past for today's classes.
      if (fireAt.getTime() <= now + 30_000) continue;
      planned.push({ when: fireAt, group, start: s.start });
    }
  }

  planned.sort((a, b) => a.when.getTime() - b.when.getTime());

  for (const p of planned.slice(0, MAX_SCHEDULED)) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: p.group.name,
        body:
          lead === 0
            ? `Starting now · ${p.group.room}`
            : `Starts in ${lead} min at ${p.start} · ${p.group.room}`,
        data: { kind: REMINDER_KIND, groupId: p.group.id, start: p.start },
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

/** Remove only our reminders, leaving any other notification alone. */
export async function cancelClassReminders() {
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    pending
      .filter((n) => n.content.data?.kind === REMINDER_KIND)
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

/** How many reminders are currently queued — shown in the profile screen. */
export async function scheduledReminderCount() {
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  return pending.filter((n) => n.content.data?.kind === REMINDER_KIND).length;
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

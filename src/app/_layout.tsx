import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DialogHost } from '@/components/Dialog';
import { Intro } from '@/components/Intro';
import { SyncBanner } from '@/components/SyncBanner';
import { updateTeacher } from '@/data/api';
import { loadLocal, startPersistence, wipeLocal } from '@/data/persistence';
import { useGroups, useStore } from '@/data/store';
import { toKey } from '@/lib/date';
import {
  clearQueue,
  flushWrites,
  hydrate,
  installSync,
  refreshInbox,
  restoreQueue,
  watchInbox,
} from '@/data/sync';
import {
  registerForPush,
  rescheduleBirthdays,
  rescheduleReminders,
} from '@/lib/notifications';
import { hasSupabase, supabase } from '@/lib/supabase';
import { ThemeProvider, useTheme } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});
installSync();

/**
 * Keeps the store's `signedIn` flag and its contents in step with the Supabase
 * session. With no project configured this does nothing and the local seed
 * store stays in charge.
 */
function useSupabaseSession() {
  useEffect(() => {
    if (!hasSupabase) return;

    let stopWatching = () => {};

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const signedIn = !!session;
      const userId = session?.user.id ?? null;

      /*
        A different account than the one this device holds data for.

        Everything persisted — groups, students, registers, the outbox — belongs
        to one teacher, and `hydrate()` only overwrites the collections the
        server has rows for. So signing in as somebody else used to show the
        previous teacher's classes until the pull finished, and anything the new
        account had none of stayed on screen indefinitely. Clearing first makes
        the switch clean, and clearing the outbox as well is the important half:
        replaying one teacher's unsent writes under another's token would file
        their students into the wrong account.
      */
      if (signedIn && userId && userId !== useStore.getState().teacherId) {
        useStore.getState().resetAccount();
        void clearQueue();
        // The tables as well as the store. Leaving them would put the previous
        // teacher's students back on screen at the next launch.
        void wipeLocal();
      }

      useStore.setState({
        signedIn,
        ...(userId ? { teacherId: userId } : {}),
        teacherName:
          (session?.user.user_metadata?.full_name as string | undefined) ??
          useStore.getState().teacherName,
      });

      if (signedIn && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        // Bring back what was still unsent when the app last closed, then pull.
        // In that order, always — `hydrate` overwrites local collections, so
        // pulling first would discard a register taken on a dead connection.
        restoreQueue(userId)
          .then(() => hydrate())
          .catch((e) => console.warn('[classcare] hydrate failed:', e));
        // Store this device's push token against the account, so the server can
        // tell them a parent replied. Nothing did this before, which is why
        // `teachers.push_token` was always null however well FCM was set up.
        void registerForPush((pushToken) => updateTeacher({ pushToken }));
        stopWatching();
        stopWatching = watchInbox();
      }
      if (!signedIn) stopWatching();
    });

    return () => {
      data.subscription.unsubscribe();
      stopWatching();
    };
  }, []);
}

/**
 * Push any stalled writes the moment the app comes forward.
 *
 * The queue retries on its own backoff, but the teacher opening the app is the
 * strongest available signal that the phone might have a connection again —
 * they have usually just walked somewhere with signal.
 */
function useFlushOnForeground() {
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void flushWrites();
    });
    return () => sub.remove();
  }, []);
}

/**
 * Keep local reminders true to the calendar.
 *
 * Reminders are scheduled from the groups and the events, so editing either has
 * to re-plan them — otherwise the teacher is reminded about a class that moved
 * or an evening they cancelled. Also re-plans on foreground, because the horizon
 * is finite and a phone left closed for a week would otherwise run dry.
 */
function useClassReminders() {
  const groups = useGroups();
  const events = useStore((s) => s.events);
  const students = useStore((s) => s.students);
  const on = useStore((s) => s.remindersOn);
  const lead = useStore((s) => s.reminderLead);
  // A reminder's text is baked into the OS when it is scheduled, not read when
  // it fires. Without re-planning on a language change, a teacher who switches
  // to Russian keeps getting Turkmen reminders for the next fortnight.
  const language = useStore((s) => s.language);

  useEffect(() => {
    if (!on) return;
    void rescheduleReminders(groups, events, lead);
  }, [groups, events, on, lead, language]);

  /*
    Birthdays follow the roster rather than the reminder switch: a teacher who
    does not want to be told a class is starting may still want to know it is
    somebody's birthday tomorrow, and the two are separate channels on Android
    so they can be muted separately anyway.

    Re-planned whenever the roster changes, which is what stops a student who
    has left wishing themselves many happy returns next March.
  */
  useEffect(() => {
    void rescheduleBirthdays(students);
  }, [students, language]);

  useEffect(() => {
    if (!on) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void rescheduleReminders(groups, events, lead);
    });
    return () => sub.remove();
  }, [groups, events, on, lead, language]);
}

/**
 * Open what the notification was about.
 *
 * Without this, tapping a reminder drops the teacher wherever they last were —
 * which reads as the notification having done nothing. `useLastNotificationResponse`
 * covers the cold-start case too: the tap that launched the app is replayed
 * once the tree mounts.
 *
 * Gated on `signedIn` because a tap can arrive before the session has been
 * restored, and pushing a group route at the sign-in screen would strand them.
 * The effect re-runs when that flips, so nothing is lost by waiting.
 */
function useNotificationRouting() {
  const response = Notifications.useLastNotificationResponse();
  const signedIn = useStore((s) => s.signedIn);

  useEffect(() => {
    if (!response || !signedIn) return;

    const data = response.notification.request.content.data as
      {
        kind?: string;
        groupId?: string;
        replyId?: string;
        studentId?: string;
        eventId?: string;
        start?: string;
      } | undefined;

    if (data?.kind === 'class-reminder' && data.groupId) {
      router.push({ pathname: '/group/[id]', params: { id: data.groupId } });
      return;
    }

    /*
      The one that fires as the lesson begins opens the register, not the group.

      Fifteen minutes early, a teacher wants to know which room. On the hour
      they want the list of names in front of them, and making them find it is
      three taps at the exact moment they have no hands free.
    */
    if (data?.kind === 'class-started' && data.groupId) {
      router.push({
        pathname: '/attendance',
        params: { group: data.groupId, date: toKey(new Date()), start: data.start ?? '' },
      });
      return;
    }

    // A birthday reminder is about one person, so it opens them — the teacher
    // usually wants the phone number that is on that screen.
    if (data?.kind === 'student-birthday' && data.studentId) {
      router.push({ pathname: '/student/[id]', params: { id: data.studentId } });
      return;
    }

    // Their own calendar entry, opened where they can read the note on it.
    if (data?.kind === 'calendar-event' && data.eventId) {
      router.push(`/event/new?id=${data.eventId}`);
      return;
    }

    if (data?.kind !== 'reply') return;
    if (!data.replyId) {
      // An older server build, which sent no id. The inbox is still better
      // than nowhere.
      router.push('/(tabs)/messages');
      return;
    }

    /*
      The reply the notification is about is very often not in the store yet.
      A cold start has loaded nothing, and even a warm app only learns about a
      reply through its subscription, which may well lose the race against the
      teacher's thumb. Opening the detail screen then shows "this message is
      gone", which is both wrong and alarming.

      So: pull the inbox first when it is missing, and fall back to the list
      only if it is still not there afterwards.
    */
    let alive = true;
    const open = async () => {
      if (!useStore.getState().replies.some((r) => r.id === data.replyId)) {
        try {
          await refreshInbox();
        } catch {
          // Offline, most likely. The fallback below covers it.
        }
      }
      if (!alive) return;

      if (useStore.getState().replies.some((r) => r.id === data.replyId)) {
        router.push({
          pathname: '/message/[id]',
          params: { id: data.replyId!, kind: 'reply' },
        });
      } else {
        router.push('/(tabs)/messages');
      }
    };
    void open();

    return () => {
      alive = false;
    };
  }, [response, signedIn]);
}

/** The app proper. Split out so it can consume the theme context above it. */
function RootNavigator() {
  const { color, scheme } = useTheme();
  const [introDone, setIntroDone] = useState(false);
  useClassReminders();
  useNotificationRouting();
  useFlushOnForeground();

  // Paint the window itself, not just our views: without this the OS shows a
  // white flash behind modal transitions and under the Android nav bar.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(color.bg).catch(() => {});
  }, [color.bg]);

  return (
    <>
      {/*
        Explicitly derived from our scheme, not `style="auto"` — auto follows the
        OS, which is wrong the moment the teacher picks a theme that differs from
        it (dark app on a light phone would get dark icons on a dark bar).
      */}
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: color.bg },
        }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="welcome" options={{ animation: 'fade' }} />
        <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
        <Stack.Screen name="forgot-password" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="permissions" options={{ animation: 'fade' }} />
        <Stack.Screen name="group/[id]" />
        <Stack.Screen name="student/[id]" />
        <Stack.Screen name="attendance" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="compose" options={{ presentation: 'modal' }} />
        <Stack.Screen name="assignment" options={{ presentation: 'modal' }} />
        <Stack.Screen name="student/new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="student/edit" options={{ presentation: 'modal' }} />
        <Stack.Screen name="group/new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="group/edit" options={{ presentation: 'modal' }} />
        <Stack.Screen name="group/roster" options={{ presentation: 'modal' }} />
        <Stack.Screen name="event/new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="templates" options={{ presentation: 'modal' }} />
        <Stack.Screen name="about" options={{ presentation: 'modal' }} />
        <Stack.Screen name="message/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="grades/index" />
        <Stack.Screen name="grades/new" options={{ presentation: 'modal' }} />
      </Stack>

      {/*
        Both sit above the navigator so they survive every screen change: a
        dropped connection is not the current screen's problem, and a dialog
        opened from a screen that then navigates away must still resolve.
      */}
      <SyncBanner />
      <DialogHost />

      {/*
        Last, so it paints over everything while the first screen mounts behind
        it. Unmounts itself when the fade finishes and never returns — the app
        is entered once per launch.
      */}
      {!introDone ? <Intro onDone={() => setIntroDone(true)} /> : null}
    </>
  );
}

/** Reads the stored theme, then releases the splash. Renders nothing itself. */
function SplashGate({ fontsReady }: { fontsReady: boolean }) {
  const { ready } = useTheme();

  useEffect(() => {
    if (fontsReady && ready) SplashScreen.hideAsync().catch(() => {});
  }, [fontsReady, ready]);

  return null;
}

/**
 * Read the device's database before the first frame.
 *
 * Rendering from an empty store would send a signed-in teacher to the welcome
 * screen for a moment and then jump them to the tabs, which reads as having
 * been signed out. The splash stays up instead — it is already up for the
 * fonts, so this costs nothing visible.
 */
function useLocalStore() {
  const [localReady, setLocalReady] = useState(false);

  useEffect(() => {
    let alive = true;
    loadLocal()
      .catch((e) => {
        // A database that cannot be read is not a reason to refuse to start.
        // The teacher gets an empty app that syncs itself back from the
        // server, which is bad, and a locked splash screen, which is worse.
        console.warn('[classcare] could not read the local database:', e);
      })
      .finally(() => {
        if (!alive) return;
        startPersistence();
        setLocalReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  return localReady;
}

export default function RootLayout() {
  const localReady = useLocalStore();
  const [fontsLoaded, fontError] = useFonts({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  useSupabaseSession();

  // Holding the splash avoids a flash of system-font text before Space Grotesk
  // and Plus Jakarta are ready — every heading in the app depends on them.
  const fontsReady = fontsLoaded || !!fontError;
  if (!fontsReady || !localReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <SafeAreaProvider>
          <SplashGate fontsReady={fontsReady} />
          <RootNavigator />
        </SafeAreaProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

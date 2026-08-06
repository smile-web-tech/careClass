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
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DialogHost } from '@/components/Dialog';
import { SyncBanner } from '@/components/SyncBanner';
import { updateTeacher } from '@/data/api';
import { useGroups, useStore } from '@/data/store';
import { flushWrites, hydrate, installSync, watchInbox } from '@/data/sync';
import { registerForPush, rescheduleClassReminders } from '@/lib/notifications';
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
      useStore.setState({
        signedIn,
        teacherName:
          (session?.user.user_metadata?.full_name as string | undefined) ??
          useStore.getState().teacherName,
      });

      if (signedIn && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        hydrate().catch((e) => console.warn('[classcare] hydrate failed:', e));
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
 * Keep local class reminders true to the schedule.
 *
 * Reminders are scheduled from the group list, so editing a group's day or time
 * must re-plan them — otherwise the teacher is reminded about a class that
 * moved. Also re-plans on foreground, because the horizon is finite and a phone
 * left closed for a week would otherwise run dry.
 */
function useClassReminders() {
  const groups = useGroups();
  const on = useStore((s) => s.remindersOn);
  const lead = useStore((s) => s.reminderLead);
  // A reminder's text is baked into the OS when it is scheduled, not read when
  // it fires. Without re-planning on a language change, a teacher who switches
  // to Russian keeps getting Turkmen reminders for the next fortnight.
  const language = useStore((s) => s.language);

  useEffect(() => {
    if (!on) return;
    void rescheduleClassReminders(groups, lead);
  }, [groups, on, lead, language]);

  useEffect(() => {
    if (!on) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void rescheduleClassReminders(groups, lead);
    });
    return () => sub.remove();
  }, [groups, on, lead, language]);
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
      | { kind?: string; groupId?: string }
      | undefined;

    if (data?.kind === 'class-reminder' && data.groupId) {
      router.push({ pathname: '/group/[id]', params: { id: data.groupId } });
    } else if (data?.kind === 'reply') {
      router.push('/(tabs)/messages');
    }
  }, [response, signedIn]);
}

/** The app proper. Split out so it can consume the theme context above it. */
function RootNavigator() {
  const { color, scheme } = useTheme();
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
        <Stack.Screen name="group/[id]" />
        <Stack.Screen name="student/[id]" />
        <Stack.Screen name="attendance" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="compose" options={{ presentation: 'modal' }} />
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

export default function RootLayout() {
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
  if (!fontsReady) return null;

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

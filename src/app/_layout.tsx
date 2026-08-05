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
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useGroups, useStore } from '@/data/store';
import { hydrate, installSync, watchInbox } from '@/data/sync';
import { rescheduleClassReminders } from '@/lib/notifications';
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
      // Demo mode is a deliberate local session; the absence of a Supabase one
      // must not sign the user back out.
      if (useStore.getState().demo) return;

      const signedIn = !!session;
      useStore.setState({
        signedIn,
        teacherName:
          (session?.user.user_metadata?.full_name as string | undefined) ??
          useStore.getState().teacherName,
      });

      if (signedIn && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        hydrate().catch((e) => console.warn('[classcare] hydrate failed:', e));
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

  useEffect(() => {
    if (!on) return;
    void rescheduleClassReminders(groups, lead);
  }, [groups, on, lead]);

  useEffect(() => {
    if (!on) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void rescheduleClassReminders(groups, lead);
    });
    return () => sub.remove();
  }, [groups, on, lead]);
}

/** The app proper. Split out so it can consume the theme context above it. */
function RootNavigator() {
  const { color, scheme } = useTheme();
  useClassReminders();

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
        <Stack.Screen name="group/new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="group/edit" options={{ presentation: 'modal' }} />
        <Stack.Screen name="event/new" options={{ presentation: 'modal' }} />
      </Stack>
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

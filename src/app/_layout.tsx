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
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useStore } from '@/data/store';
import { hydrate, installSync, watchInbox } from '@/data/sync';
import { hasSupabase, supabase } from '@/lib/supabase';
import { color } from '@/theme/tokens';

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

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, fontError]);

  // Holding the splash avoids a flash of system-font text before Space Grotesk
  // and Plus Jakarta are ready — every heading in the app depends on them.
  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: color.bg },
          }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="profile" />
          <Stack.Screen name="group/[id]" />
          <Stack.Screen name="student/[id]" />
          <Stack.Screen name="attendance" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="compose" options={{ presentation: 'modal' }} />
          <Stack.Screen name="student/new" options={{ presentation: 'modal' }} />
          <Stack.Screen name="group/new" options={{ presentation: 'modal' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

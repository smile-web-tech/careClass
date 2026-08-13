import { Redirect } from 'expo-router';

import { useStore } from '@/data/store';

/**
 * Entry point.
 *
 * The language question comes before everything, including sign-in: the sign-in
 * screen is itself written in one of the three languages, and showing it in the
 * wrong one is a worse first impression than one extra tap.
 *
 * Gated on `languageChosen`, not on `language` being set — the store defaults to
 * Turkmen, so testing the value itself would skip the screen for everyone.
 */
export default function Index() {
  const signedIn = useStore((s) => s.signedIn);
  const languageChosen = useStore((s) => s.languageChosen);
  const permissionsAsked = useStore((s) => s.permissionsAsked);

  if (!languageChosen) return <Redirect href="/welcome" />;
  if (!signedIn) return <Redirect href="/sign-in" />;
  // Once, on the way in, and only after there is an account to hold the
  // answer. Asking on the sign-in screen would be asking a stranger.
  if (!permissionsAsked) return <Redirect href="/permissions" />;
  return <Redirect href="/(tabs)" />;
}

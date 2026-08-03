import { Redirect } from 'expo-router';

import { useStore } from '@/data/store';

/** Entry point — send the teacher to their groups, or to sign-in. */
export default function Index() {
  const signedIn = useStore((s) => s.signedIn);
  return <Redirect href={signedIn ? '/(tabs)' : '/sign-in'} />;
}

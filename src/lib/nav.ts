import type { useRouter } from 'expo-router';

type Router = ReturnType<typeof useRouter>;

/**
 * Land in the app with the auth screens gone from the back stack.
 *
 * `replace` alone is not enough. Sign-in *pushes* login and registration, so a
 * plain replace swaps only the top entry and leaves sign-in underneath — the
 * Android back button would then walk a signed-in teacher back onto the
 * "Get started" screen. Clearing the stack first is what makes back exit the
 * app, which is what it does everywhere else.
 */
export function enterApp(router: Router) {
  try {
    if (router.canDismiss()) router.dismissAll();
  } catch {
    // `canDismiss` is conservative and `dismissAll` throws on an empty stack in
    // some navigation states. Either way the replace below still gets them in.
  }
  router.replace('/(tabs)');
}

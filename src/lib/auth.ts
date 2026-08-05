import * as AppleAuthentication from 'expo-apple-authentication';
import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';

import { supabase } from '@/lib/supabase';

/**
 * Sign-in flows.
 *
 * Google and Apple both use their native SDKs and hand Supabase an ID token
 * directly. Neither opens a browser, which is what makes them work behind the
 * reverse proxy — see the note on `signInWithGoogle`. Email is a two-step OTP.
 */

// Lets the auth sheet hand control back to the app on Android.
WebBrowser.maybeCompleteAuthSession();

/**
 * Where the OAuth sheet sends the user back to.
 *
 * This exact string must be in Supabase → Authentication → URL Configuration →
 * Redirect URLs. If it isn't, Supabase silently falls back to the Site URL and
 * the browser lands on localhost instead of returning to the app — sign-in
 * appears to fail even though the session was created. Exported so the sign-in
 * screen can show it in dev builds, because a dev client does not always
 * produce the plain `classcare://` form.
 */
export const redirectTo = AuthSession.makeRedirectUri({
  scheme: 'classcare',
  path: 'auth/callback',
});

/**
 * The **Web** OAuth client id from Google Cloud — not the Android one.
 * Supabase validates the ID token's audience against it, so it must match the
 * client id configured on the Google provider in the Supabase dashboard.
 */
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';

export class AuthCancelled extends Error {
  constructor() {
    super('Sign-in cancelled');
  }
}

/**
 * Google sign-in, on the device rather than through a browser.
 *
 * The browser flow cannot work here. `/auth/v1/authorize` hands Google a
 * `redirect_uri` of `https://<ref>.supabase.co/auth/v1/callback`, built from the
 * project's own external URL — a value neither the app nor a reverse proxy can
 * rewrite. Since `*.supabase.co` is unreachable from Turkmen networks, Google
 * would authenticate successfully and then redirect the browser into a black
 * hole. (Supabase's paid Custom Domain add-on is the only way to change that
 * URL.)
 *
 * The native SDK avoids the problem entirely: Google talks to the device, hands
 * back an ID token, and that token is posted to Supabase over ordinary HTTPS —
 * which reaches the proxy fine. No browser hop, and it is faster besides.
 * Apple sign-in has always worked this way; see `signInWithApple` below.
 */
export async function signInWithGoogle() {
  if (Platform.OS === 'web') {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
    return; // The browser navigates away and comes back with a session.
  }

  if (!GOOGLE_WEB_CLIENT_ID) {
    throw new Error(
      'Google sign-in is not configured.\n\nSet EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID to the *Web* OAuth client id from Google Cloud.',
    );
  }

  GoogleSignin.configure({
    // Counter-intuitive but correct: the WEB client id, not the Android one.
    // It is the audience Supabase validates the ID token against. The Android
    // client still has to exist in Google Cloud (matched by package name and
    // SHA-1) or the native call fails — it is simply never named here.
    webClientId: GOOGLE_WEB_CLIENT_ID,
  });

  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();

    // v13+ returns a discriminated union; older shapes put the token at the top
    // level. Accept both so a minor upgrade does not break sign-in.
    const idToken =
      (response as { data?: { idToken?: string | null } }).data?.idToken ??
      (response as { idToken?: string | null }).idToken;

    if (!idToken) throw new AuthCancelled();

    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
    });
    if (error) throw error;
  } catch (e) {
    const code = (e as { code?: string }).code;
    // SIGN_IN_CANCELLED / IN_PROGRESS are the user's doing, not failures.
    if (code === statusCodes.SIGN_IN_CANCELLED || code === statusCodes.IN_PROGRESS) {
      throw new AuthCancelled();
    }
    if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      throw new Error('Google Play Services is required for Google sign-in on this device.');
    }
    throw e;
  }
}

/**
 * Turn the callback URL into a session.
 *
 * Supabase can answer in either of two shapes and the app has to cope with
 * both. PKCE returns `?code=…` to exchange. Implicit returns the tokens
 * directly in the fragment — which older projects and some provider configs
 * still do, and which `exchangeCodeForSession` cannot consume.
 *
 * Note a custom-scheme URL has no origin: `new URL('classcare://x').origin` is
 * the string "null". Never report it to the user as a destination.
 */
async function completeOAuthCallback(callbackUrl: string) {
  const url = new URL(callbackUrl);

  const code = url.searchParams.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return;
  }

  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  const access_token = fragment.get('access_token');
  const refresh_token = fragment.get('refresh_token');
  if (access_token && refresh_token) {
    const { error } = await supabase.auth.setSession({
      access_token,
      refresh_token,
    });
    if (error) throw error;
    return;
  }

  // Providers report failures on the callback rather than the auth page.
  const providerError =
    url.searchParams.get('error_description') ??
    url.searchParams.get('error') ??
    fragment.get('error_description') ??
    fragment.get('error');
  if (providerError) throw new Error(providerError);

  throw new Error(
    `The sign-in callback carried neither a code nor a token.\n\nCallback: ${callbackUrl.slice(0, 200)}`,
  );
}

export const isAppleSignInAvailable = () =>
  Platform.OS === 'ios' ? AppleAuthentication.isAvailableAsync() : Promise.resolve(false);

export async function signInWithApple() {
  // Apple hashes the nonce it echoes back, so send the digest and give
  // Supabase the raw value to verify against.
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') throw new AuthCancelled();
    throw e;
  }

  if (!credential.identityToken) throw new Error('Apple did not return an identity token');

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: rawNonce,
  });
  if (error) throw error;

  // Apple only sends the name on the very first authorization, so capture it
  // now or it is gone for good.
  const full = [credential.fullName?.givenName, credential.fullName?.familyName]
    .filter(Boolean)
    .join(' ');
  if (full) {
    await supabase.auth.updateUser({ data: { full_name: full } });
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      await supabase.from('teachers').update({ name: full }).eq('id', data.user.id);
    }
  }
}

const cleanEmail = (email: string) => email.trim().toLowerCase();

const deviceTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/* -------------------------------------------------------------------------- */
/* Email + password                                                           */
/* -------------------------------------------------------------------------- */

export type RegisterInput = {
  name: string;
  email: string;
  phone?: string;
  password: string;
};

/**
 * `already-registered` means the caller should send the teacher to the login
 * screen instead. It is *not* an error — it is the ordinary outcome of someone
 * forgetting they already have an account.
 */
export type RegisterOutcome = 'code-sent' | 'already-registered';

/**
 * Registration, step 1 — create the account and mail a confirmation code.
 *
 * The user exists in `auth.users` immediately but unconfirmed, and migration
 * 0003 withholds the `teachers` profile until the email is confirmed. So an
 * abandoned signup — app closed at the code screen, code never opened — leaves
 * nothing usable behind, and starting again behaves exactly like a first
 * attempt.
 *
 * On telling the teacher their address is taken: with email confirmation on,
 * GoTrue answers a signup for an already-confirmed address with a decoy — a
 * user-shaped object carrying no identities, and no mail sent — precisely so
 * this endpoint cannot be used to test a list of addresses for accounts. That
 * decoy is the only signal available, and it is used for one thing: routing
 * the person in front of us to the login screen. Nothing is displayed that
 * they did not already type.
 */
export async function registerWithPassword(input: RegisterInput): Promise<RegisterOutcome> {
  const email = cleanEmail(input.email);
  const name = input.name.trim();
  const phone = input.phone?.trim() || null;

  const { data, error } = await supabase.auth.signUp({
    email,
    password: input.password,
    options: {
      // Read by `handle_new_user` when the confirmation lands, so the profile
      // is right even if the app is killed before it can write one itself.
      data: { full_name: name, phone },
      emailRedirectTo: Platform.OS === 'web' ? undefined : redirectTo,
    },
  });

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === 'user_already_exists' || /already\s+(registered|exists)/i.test(error.message)) {
      return 'already-registered';
    }
    throw error;
  }

  if (data.user && (data.user.identities?.length ?? 0) === 0) return 'already-registered';

  return 'code-sent';
}

/**
 * Mail the confirmation code again.
 *
 * `resend` rather than another `signUp`: repeating the signup would rewrite the
 * stored password with whatever is in the form at that moment, which is not
 * what "I didn't get the email" should do.
 */
export async function resendSignupCode(email: string) {
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: cleanEmail(email),
    options: { emailRedirectTo: Platform.OS === 'web' ? undefined : redirectTo },
  });
  if (error) throw error;
}

/**
 * Registration, step 2 — confirm the address and write the profile.
 *
 * Verifying the code confirms the email *and* returns a session, so the profile
 * write below runs as the teacher and RLS scopes it to their own row.
 */
export async function confirmRegistration(input: {
  email: string;
  code: string;
  name: string;
  phone?: string;
}) {
  const email = cleanEmail(input.email);
  const token = input.code.trim();

  // A signup confirmation is minted under type `signup`. Projects created
  // before that split still issue the generic `email` type, and a mismatch is
  // rejected without consuming the token — so trying the other costs nothing.
  let result = await supabase.auth.verifyOtp({ email, token, type: 'signup' });
  if (result.error) result = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (result.error) throw result.error;

  const user = result.data.user;
  if (!user) throw new Error('That code did not produce a session.');

  await writeProfile({
    id: user.id,
    email,
    name: input.name,
    phone: input.phone,
  });
}

/**
 * Upsert rather than update: the trigger normally has the row in place by now,
 * but a project that has not run migration 0003 yet would otherwise silently
 * update nothing and leave a nameless teacher.
 */
async function writeProfile(input: {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
}) {
  const name = input.name.trim();
  const phone = input.phone?.trim() || null;

  const { error } = await supabase.from('teachers').upsert(
    {
      id: input.id,
      email: input.email,
      name,
      phone,
      // Schedules are stored as wall-clock time, so the zone is what turns a
      // slot into a real instant — and only the device knows it.
      timezone: deviceTimezone(),
    },
    { onConflict: 'id' },
  );
  if (error) throw error;

  // Mirrored onto the auth user so the name survives a profile rebuild and is
  // available to the root layout before the first hydrate finishes.
  await supabase.auth.updateUser({ data: { full_name: name } });
}

export async function signInWithPassword(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({
    email: cleanEmail(email),
    password,
  });
  if (error) throw error;
}

/**
 * Abandon a half-finished registration.
 *
 * Signing out drops any session the code step created. The server never made a
 * profile for an unconfirmed user (migration 0003), so nothing is left
 * half-built and the next attempt is a clean one.
 */
export async function abandonRegistration() {
  try {
    await supabase.auth.signOut();
  } catch {
    // Losing the local session is what matters; a failed network call here
    // must not strand the teacher mid-form.
  }
}

/* -------------------------------------------------------------------------- */
/* Password reset                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Mail a recovery code.
 *
 * Always resolves, even for an address with no account: answering differently
 * would turn this screen into the account-existence oracle that registration
 * deliberately avoids being. The caller says "if that address has an account,
 * a code is on its way" either way.
 */
export async function requestPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail(email), {
    redirectTo: Platform.OS === 'web' ? undefined : redirectTo,
  });
  // A rate-limit is worth surfacing; "no such user" is not, and GoTrue does not
  // report it anyway.
  if (error && /rate|too many/i.test(error.message)) throw error;
}

/** Verify the recovery code, then set the new password on the session it opens. */
export async function resetPassword(email: string, code: string, password: string) {
  const { error: verifyError } = await supabase.auth.verifyOtp({
    email: cleanEmail(email),
    token: code.trim(),
    type: 'recovery',
  });
  if (verifyError) throw verifyError;

  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

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

/**
 * Email sign-in, step 1 — mail a 6-digit code.
 *
 * A code rather than a magic link: a link has to bounce out to the mail app and
 * deep-link back into a specific build, which breaks constantly on Android. A
 * code the teacher can read and type works the first time, every time.
 *
 * Requires `{{ .Token }}` in the Magic Link email template
 * (Supabase → Authentication → Email Templates); the stock template only
 * contains the link.
 */
/**
 * Email sign-in, step 1 — send a one-time code.
 *
 * `shouldCreateUser: true` covers both signing in and signing up, and the app
 * deliberately does not check first whether the address is already registered.
 * An endpoint that answers "does this email have an account?" is an account
 * enumeration oracle: anyone could test a list of addresses against it and
 * learn which of your teachers use the app. Instead the same code is sent
 * either way, and whether this is a new account is discovered *after* the code
 * is verified — at which point the person has proved they own the mailbox.
 *
 * A signup abandoned at the code screen leaves only an unconfirmed
 * `auth.users` row and no profile at all (migration 0003), so nothing is
 * half-created and retrying behaves exactly like a first attempt.
 */
export async function sendEmailCode(email: string) {
  const { error } = await supabase.auth.signInWithOtp({
    email: cleanEmail(email),
    options: {
      shouldCreateUser: true,
      // Included so a teacher who taps the link instead of typing the code
      // still lands back in the app.
      emailRedirectTo: Platform.OS === 'web' ? undefined : redirectTo,
    },
  });
  if (error) throw error;
}

/**
 * Email sign-in, step 2 — exchange the code for a session.
 *
 * Returns whether this account still needs a profile. The `teachers` row is
 * created by a trigger the moment the email is confirmed, so a brand-new
 * account has a row with an empty name; an existing one has a real name and
 * goes straight into the app.
 */
export async function verifyEmailCode(
  email: string,
  code: string,
): Promise<{ isNewAccount: boolean }> {
  const { data, error } = await supabase.auth.verifyOtp({
    email: cleanEmail(email),
    token: code.trim(),
    type: 'email',
  });
  if (error) throw error;
  if (!data.user) throw new Error('That code did not produce a session.');

  const { data: profile } = await supabase
    .from('teachers')
    .select('name')
    .eq('id', data.user.id)
    .maybeSingle();

  return { isNewAccount: !profile?.name?.trim() };
}

/**
 * Finish a new registration.
 *
 * Runs only after the code is verified, so the session already exists and RLS
 * scopes the write to this teacher. The name also goes onto the auth user so
 * it survives if the profile row is ever rebuilt.
 */
export async function completeRegistration(input: { name: string; phone?: string }) {
  const name = input.name.trim();
  const phone = input.phone?.trim() || null;
  if (name.length < 2) throw new Error('Please enter your full name.');

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Your session expired. Please sign in again.');

  const { error } = await supabase
    .from('teachers')
    .update({
      name,
      phone,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
    })
    .eq('id', auth.user.id);
  if (error) throw error;

  await supabase.auth.updateUser({ data: { full_name: name } });
}

/**
 * Abandon a half-finished registration.
 *
 * Called when the teacher backs out of the profile step. Signing out drops the
 * session; the unconfirmed-or-nameless profile is cleaned up server-side, and
 * starting again behaves like a fresh signup.
 */
export async function abandonRegistration() {
  try {
    await supabase.auth.signOut();
  } catch {
    // Losing the local session is what matters; a failed network call here
    // must not strand the user on the profile step.
  }
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

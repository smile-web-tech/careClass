import * as AppleAuthentication from 'expo-apple-authentication';
import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

/**
 * Sign-in flows.
 *
 * Google goes through Supabase's OAuth endpoint in a system browser sheet
 * (works in Expo Go and in release builds alike). Apple uses the native sheet
 * and hands Supabase the identity token directly — App Store review requires
 * Sign in with Apple to be offered wherever a third-party login is.
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

export class AuthCancelled extends Error {
  constructor() {
    super('Sign-in cancelled');
  }
}

export async function signInWithGoogle() {
  if (Platform.OS === 'web') {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
    return; // The browser navigates away and comes back with a session.
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data.url) throw new Error('Supabase did not return an authorization URL');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') throw new AuthCancelled();

  await completeOAuthCallback(result.url);
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
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
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
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce,
  );

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

/** Email sign-in, step 2 — exchange the code for a session. */
export async function verifyEmailCode(email: string, code: string) {
  const { error } = await supabase.auth.verifyOtp({
    email: cleanEmail(email),
    token: code.trim(),
    type: 'email',
  });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

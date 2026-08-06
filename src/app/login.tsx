/**
 * Sign in with an email and password.
 *
 * Also the landing place for someone who tried to register with an address that
 * already has an account — `reason=exists` explains why they were moved here
 * rather than silently dropping them on a different screen.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { AuthButton, AuthField, AuthLink, AuthNotice, AuthScreen } from '@/components/AuthForm';
import { useT } from '@/i18n/useT';
import { PasswordField } from '@/components/PasswordField';
import { Press } from '@/components/ui';
import { signInWithPassword } from '@/lib/auth';
import { enterApp } from '@/lib/nav';
import { isOfflineError } from '@/lib/errors';
import {
  clearLoginFailures,
  formatWait,
  loginGate,
  recordLoginFailure,
  type ThrottleState,
} from '@/lib/throttle';
import { useThemedStyles, type Theme } from '@/theme';
import { body } from '@/theme/type';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Failures allowed before the first lockout — mirrors the ladder in `throttle.ts`. */
const WARN_FROM = 2;
const FREE_ATTEMPTS = 3;

export default function Login() {
  const t = useT();
  const router = useRouter();
  const { email: prefill, reason } = useLocalSearchParams<{ email?: string; reason?: string }>();
  const styles = useThemedStyles(makeStyles);

  const [email, setEmail] = useState(prefill ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [gate, setGate] = useState<ThrottleState | null>(null);

  const passwordRef = useRef<TextInput>(null);

  // Read the stored lockout on mount and whenever the address changes — the
  // limit is per address as well as per device, so typing a different email
  // has to re-check rather than inherit the previous one's state.
  useEffect(() => {
    let live = true;
    void loginGate(email).then((s) => {
      if (live) setGate(s);
    });
    return () => {
      live = false;
    };
  }, [email]);

  // Tick the countdown down to zero, then stop. Only runs while locked, so an
  // idle sign-in screen is not waking once a second for nothing.
  useEffect(() => {
    if (!gate?.blocked) return;
    const timer = setInterval(() => {
      setGate((s) => {
        if (!s) return s;
        const msLeft = Math.max(0, s.msLeft - 1000);
        return { ...s, msLeft, blocked: msLeft > 0 };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [gate?.blocked]);

  const locked = !!gate?.blocked;
  const ready = EMAIL_RE.test(email.trim()) && password.length > 0 && !locked;

  const submit = async () => {
    if (!ready || busy) return;

    // Re-check rather than trusting the countdown: the screen may have been
    // sitting in the background, and a stale render must not grant an attempt.
    const current = await loginGate(email);
    if (current.blocked) {
      setGate(current);
      setError(t('auth.tooManyAttempts', { time: formatWait(current.msLeft) }));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await signInWithPassword(email, password);
      await clearLoginFailures(email);
      enterApp(router);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const wrongCredential = /invalid login|invalid credentials/i.test(msg);

      // Only a rejected credential counts. Locking someone out because their
      // connection dropped would punish the failure mode this app is built
      // around — see `isOfflineError`.
      if (wrongCredential && !isOfflineError(e)) {
        const next = await recordLoginFailure(email);
        setGate(next);
        if (next.blocked) {
          setError(t('auth.tooManyAttempts', { time: formatWait(next.msLeft) }));
          setBusy(false);
          return;
        }
      }

      setError(
        // Deliberately the same wording for a wrong password and an address
        // with no account: telling them apart would let anyone test a list of
        // emails for accounts.
        wrongCredential
          ? t('auth.badCredentials')
          : /not confirmed|confirm/i.test(msg)
            ? t('auth.needsConfirm')
            : msg,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen
      title={t('auth.welcomeBack')}
      subtitle={t('auth.signInSubtitle')}
      footer={
        <AuthLink
          prompt={t('auth.newHere')}
          label={t('auth.createAccount')}
          onPress={() => router.replace({ pathname: '/register', params: { email: email.trim() } })}
        />
      }>
      {reason === 'exists' ? (
        <AuthNotice tone="info">{t('auth.alreadyRegistered')}</AuthNotice>
      ) : null}

      {error ? <AuthNotice>{error}</AuthNotice> : null}

      {/* Warn before the door closes rather than after. Someone who has
          mistyped twice can slow down; someone guessing learns nothing they
          could not have measured anyway. */}
      {!locked && gate && gate.fails >= WARN_FROM ? (
        <AuthNotice tone="info">
          {t('auth.attemptsLeft', { count: Math.max(1, FREE_ATTEMPTS - gate.fails) })}
        </AuthNotice>
      ) : null}

      <AuthField
        label={t('auth.email')}
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => passwordRef.current?.focus()}
        autoFocus={!prefill}
      />

      <PasswordField
        ref={passwordRef}
        label={t('auth.password')}
        value={password}
        onChangeText={setPassword}
        placeholder={t('auth.yourPassword')}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        autoFocus={!!prefill}
      />

      <View style={styles.forgotRow}>
        <Press
          onPress={() =>
            router.push({ pathname: '/forgot-password', params: { email: email.trim() } })
          }
          hitSlop={8}>
          <Text style={styles.forgot}>{t('auth.forgotPassword')}</Text>
        </Press>
      </View>

      <AuthButton
        label={locked ? t('auth.lockedButton', { time: formatWait(gate!.msLeft) }) : t('auth.signIn')}
        onPress={() => void submit()}
        disabled={!ready}
        busy={busy}
      />
    </AuthScreen>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    forgotRow: { alignItems: 'flex-end', marginTop: -4, marginBottom: 14 },
    forgot: { fontFamily: body[700], fontSize: 13.5, color: color.primary, paddingVertical: 4 },
  });

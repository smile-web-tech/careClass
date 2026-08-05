/**
 * Sign in with an email and password.
 *
 * Also the landing place for someone who tried to register with an address that
 * already has an account — `reason=exists` explains why they were moved here
 * rather than silently dropping them on a different screen.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { AuthButton, AuthField, AuthLink, AuthNotice, AuthScreen } from '@/components/AuthForm';
import { PasswordField } from '@/components/PasswordField';
import { Press } from '@/components/ui';
import { signInWithPassword } from '@/lib/auth';
import { enterApp } from '@/lib/nav';
import { useThemedStyles, type Theme } from '@/theme';
import { body } from '@/theme/type';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function Login() {
  const router = useRouter();
  const { email: prefill, reason } = useLocalSearchParams<{ email?: string; reason?: string }>();
  const styles = useThemedStyles(makeStyles);

  const [email, setEmail] = useState(prefill ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordRef = useRef<TextInput>(null);

  const ready = EMAIL_RE.test(email.trim()) && password.length > 0;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signInWithPassword(email, password);
      enterApp(router);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        // Deliberately the same wording for a wrong password and an address
        // with no account: telling them apart would let anyone test a list of
        // emails for accounts.
        /invalid login|invalid credentials/i.test(msg)
          ? 'That email and password do not match.'
          : /not confirmed|confirm/i.test(msg)
            ? 'This account still needs confirming. Register again to get a fresh code.'
            : msg,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen
      title="Welcome back"
      subtitle="Sign in to pick up where you left off."
      footer={
        <AuthLink
          prompt="New to ClassCare?"
          label="Create an account"
          onPress={() => router.replace({ pathname: '/register', params: { email: email.trim() } })}
        />
      }>
      {reason === 'exists' ? (
        <AuthNotice tone="info">
          That email already has a ClassCare account. Sign in below, or reset your password if you
          have forgotten it.
        </AuthNotice>
      ) : null}

      {error ? <AuthNotice>{error}</AuthNotice> : null}

      <AuthField
        label="Email"
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
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="Your password"
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
          <Text style={styles.forgot}>Forgot password?</Text>
        </Press>
      </View>

      <AuthButton label="Sign in" onPress={() => void submit()} disabled={!ready} busy={busy} />
    </AuthScreen>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    forgotRow: { alignItems: 'flex-end', marginTop: -4, marginBottom: 14 },
    forgot: { fontFamily: body[700], fontSize: 13.5, color: color.primary, paddingVertical: 4 },
  });

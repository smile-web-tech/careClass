/**
 * Reset a forgotten password: address, code, new password.
 *
 * A password login without this is a trap — the first teacher to forget theirs
 * is locked out of their own class list with no way back in.
 *
 * The first step never says whether the address has an account. It cannot: an
 * honest answer here would undo the care taken everywhere else to keep account
 * existence private.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { AuthButton, AuthField, AuthNotice, AuthScreen } from '@/components/AuthForm';
import { useT } from '@/i18n/useT';
import { OtpInput } from '@/components/OtpInput';
import { PasswordField } from '@/components/PasswordField';
import { Press } from '@/components/ui';
import { requestPasswordReset, resetPassword } from '@/lib/auth';
import { enterApp } from '@/lib/nav';
import { MIN_LENGTH, passwordAcceptable, scorePassword } from '@/lib/password';
import { useTheme, useThemedStyles, type Theme } from '@/theme';
import { body } from '@/theme/type';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Step = 'email' | 'reset';

export default function ForgotPassword() {
  const t = useT();
  const router = useRouter();
  const { email: prefill } = useLocalSearchParams<{ email?: string }>();
  const styles = useThemedStyles(makeStyles);
  const { color } = useTheme();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState(prefill ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const passwordRef = useRef<TextInput>(null);

  const strength = scorePassword(password, [email.split('@')[0] ?? '']);
  const emailOk = EMAIL_RE.test(email.trim());
  const canReset = code.length === 6 && passwordAcceptable(strength);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = async () => {
    if (!emailOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(email);
      setCooldown(45);
      setStep('reset');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!canReset || busy) return;
    setBusy(true);
    setError(null);
    try {
      await resetPassword(email, code, password);
      // `resetPassword` leaves a live session behind, so there is nothing left
      // to sign in to — go straight in.
      enterApp(router);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCode('');
      setError(
        /expired/i.test(msg)
          ? t('auth.codeExpired')
          : /invalid|token|otp/i.test(msg)
            ? t('auth.codeWrong')
            : msg,
      );
    } finally {
      setBusy(false);
    }
  };

  if (step === 'email') {
    return (
      <AuthScreen
        title={t('auth.resetPassword')}
        subtitle={t('auth.resetSubtitle')}>
        {error ? <AuthNotice>{error}</AuthNotice> : null}

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
          returnKeyType="send"
          onSubmitEditing={() => void send()}
          autoFocus
        />

        <AuthButton label={t('auth.sendCode')} onPress={() => void send()} disabled={!emailOk} busy={busy} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title={t('auth.chooseNewPassword')}
      subtitle={`If ${email.trim().toLowerCase()} has an account, a code is on its way.`}
      onBack={() => {
        setStep('email');
        setCode('');
        setError(null);
      }}>
      {error ? <AuthNotice>{error}</AuthNotice> : null}

      <Text style={styles.label}>{t('auth.codeFromEmail')}</Text>
      <View style={styles.otpWrap}>
        <OtpInput
          value={code}
          onChange={(v) => {
            setCode(v);
            if (error) setError(null);
          }}
          invalid={!!error}
          editable={!busy}
          onComplete={() => passwordRef.current?.focus()}
        />
      </View>

      <PasswordField
        ref={passwordRef}
        label={t('auth.newPassword')}
        value={password}
        onChangeText={setPassword}
        meter
        personal={[email.split('@')[0] ?? '']}
        placeholder={`At least ${MIN_LENGTH} characters`}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
      />

      <AuthButton
        label={t('auth.setNewPassword')}
        onPress={() => void submit()}
        disabled={!canReset}
        busy={busy}
      />

      <View style={styles.resendRow}>
        <Press onPress={() => void send()} disabled={cooldown > 0 || busy} hitSlop={8}>
          <Text style={[styles.resend, cooldown > 0 && { color: color.mutedLight }]}>
            {cooldown > 0 ? t('auth.resendIn', { count: cooldown }) : t('auth.resendCode')}
          </Text>
        </Press>
      </View>
    </AuthScreen>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    label: { fontFamily: body[600], fontSize: 13, color: color.inkSoft, marginBottom: 7 },
    otpWrap: { marginBottom: 20 },
    resendRow: { alignItems: 'center', marginTop: 16 },
    resend: { fontFamily: body[700], fontSize: 14, color: color.primary, paddingVertical: 6 },
  });

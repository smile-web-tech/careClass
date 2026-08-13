/**
 * Create an account — name, email, optional phone, password, then a code.
 *
 * Three steps rather than one long form. Each screenful asks for one kind of
 * thing, so the keyboard never covers half the answers and a mistake is
 * corrected where it was made. The progress rail at the top says how much is
 * left, which is the difference between a form people finish and one they
 * abandon.
 *
 * Nothing is created server-side until step 2 is submitted. Abandoning after
 * that leaves an unconfirmed `auth.users` row and no profile at all (migration
 * 0003), so retrying behaves exactly like a first attempt.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet, Text, TextInput, View } from 'react-native';

import { confirm as askConfirm } from '@/components/Dialog';
import { useT } from '@/i18n/useT';
import { AuthButton, AuthField, AuthLink, AuthNotice, AuthScreen } from '@/components/AuthForm';
import { OtpInput } from '@/components/OtpInput';
import { PasswordField } from '@/components/PasswordField';
import { Press } from '@/components/ui';
import {
  abandonRegistration,
  confirmRegistration,
  registerWithPassword,
  resendSignupCode,
} from '@/lib/auth';
import { MAIL_SENDER } from '@/lib/brand';
import { enterApp } from '@/lib/nav';
import { MIN_LENGTH, passwordAcceptable, scorePassword } from '@/lib/password';
import { useTheme, useThemedStyles, type Theme } from '@/theme';
import { body } from '@/theme/type';

/** Rejects `a@b` and trailing-dot addresses without pretending to be RFC 5322. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Digits, spaces and the punctuation people actually type into a phone field. */
const PHONE_RE = /^[+()\d][\d\s()-]{3,31}$/;

type Step = 1 | 2 | 3;

export default function Register() {
  const t = useT();
  const router = useRouter();
  const { email: prefill } = useLocalSearchParams<{ email?: string }>();
  const styles = useThemedStyles(makeStyles);
  const { color } = useTheme();

  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState(prefill ?? '');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');

  /** Field errors appear once a field has been left, not while it is typed in. */
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const emailRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const strength = scorePassword(password, [name, email.split('@')[0] ?? '']);

  const nameOk = name.trim().length >= 2 && /\p{L}/u.test(name);
  const emailOk = EMAIL_RE.test(email.trim());
  const phoneOk = phone.trim() === '' || PHONE_RE.test(phone.trim());
  const passwordOk = passwordAcceptable(strength);
  const confirmOk = confirm.length > 0 && confirm === password;

  const stepOneOk = nameOk && emailOk && phoneOk;
  const stepTwoOk = passwordOk && confirmOk;

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  /**
   * Leaving mid-registration must not strand a half-made account. Step 3 is the
   * only point where one exists, and backing out of it signs the session away.
   */
  const leave = () => {
    if (step === 3) void abandonRegistration();
    router.back();
  };

  const back = () => {
    setFormError(null);
    if (step === 1) return leave();
    if (step === 3) {
      // The account already exists but is unconfirmed; sending them back to the
      // password step would silently re-register with a different one.
      void askConfirm({
        title: t('auth.leaveTitle'),
        message: t('auth.leaveMessage'),
        confirmLabel: t('common.back'),
        cancelLabel: t('common.continue'),
      }).then((yes) => yes && leave());
      return;
    }
    setStep(1);
  };

  // Android's hardware back has to follow the same rules as the on-screen one:
  // step 2 goes back to step 1, step 3 asks before throwing the account away.
  // Re-subscribed whenever the step changes, because that is what `back` reads.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const submitDetails = () => {
    setTouched({ name: true, email: true, phone: true });
    if (!stepOneOk) return;
    setFormError(null);
    setStep(2);
  };

  const createAccount = async () => {
    setTouched((t) => ({ ...t, password: true, confirm: true }));
    if (!stepTwoOk || busy) return;

    setBusy(true);
    setFormError(null);
    try {
      const outcome = await registerWithPassword({ name, email, phone, password });

      if (outcome === 'already-registered') {
        // Their address, their account — send them where they can actually get
        // in, carrying the email so they do not type it twice.
        router.replace({
          pathname: '/login',
          params: { email: email.trim().toLowerCase(), reason: 'exists' },
        });
        return;
      }

      setCode('');
      setCodeError(null);
      setCooldown(45);
      setStep(3);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFormError(
        /password/i.test(msg) && /weak|short|length/i.test(msg)
          ? t('auth.serverRejectedPassword', { count: MIN_LENGTH })
          : msg,
      );
    } finally {
      setBusy(false);
    }
  };

  const verify = async (candidate: string) => {
    if (candidate.length < 6 || busy) return;
    setBusy(true);
    setCodeError(null);
    try {
      await confirmRegistration({ email, code: candidate, name, phone });
      // The root layout's auth listener hydrates from here; this just clears
      // the auth screens out of the back stack on the way in.
      enterApp(router);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCode('');
      setCodeError(
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

  const resend = async () => {
    if (cooldown > 0 || busy) return;
    setBusy(true);
    setCode('');
    setCodeError(null);
    try {
      await resendSignupCode(email);
      setCooldown(45);
    } catch (e) {
      setCodeError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /* ---------------------------------------------------------------------- */

  if (step === 1) {
    return (
      <AuthScreen
        title={t('auth.createYourAccount')}
        subtitle={t('auth.nameShownToStudents')}
        step={1}
        steps={3}
        onBack={back}
        footer={
          <AuthLink
            prompt={t('auth.haveAccount')}
            label={t('auth.signIn')}
            onPress={() => router.replace({ pathname: '/login', params: { email: email.trim() } })}
          />
        }>
        {formError ? <AuthNotice>{formError}</AuthNotice> : null}

        <AuthField
          label={t('auth.fullName')}
          value={name}
          onChangeText={setName}
          onBlur={() => setTouched((t) => ({ ...t, name: true }))}
          error={touched.name && !nameOk ? t('auth.enterFullName') : null}
          placeholder={t('auth.namePlaceholder')}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => emailRef.current?.focus()}
          autoFocus
        />

        <AuthField
          ref={emailRef}
          label={t('auth.email')}
          value={email}
          onChangeText={setEmail}
          onBlur={() => setTouched((t) => ({ ...t, email: true }))}
          error={touched.email && !emailOk ? t('auth.badEmail') : null}
          hint={t('auth.codeSentHere')}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => phoneRef.current?.focus()}
        />

        <AuthField
          ref={phoneRef}
          label={t('auth.phone')}
          optional
          value={phone}
          onChangeText={setPhone}
          onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
          error={touched.phone && !phoneOk ? t('auth.badPhone') : null}
          hint={t('auth.phoneWhy')}
          placeholder="+993 6X XX XX XX"
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          returnKeyType="done"
          onSubmitEditing={submitDetails}
        />

        <AuthButton label={t('common.continue')} onPress={submitDetails} disabled={!stepOneOk} />
      </AuthScreen>
    );
  }

  if (step === 2) {
    return (
      <AuthScreen
        title={t('auth.choosePassword')}
        subtitle={t('auth.signInWithAlongside', { email: email.trim().toLowerCase() })}
        step={2}
        steps={3}
        onBack={back}>
        {formError ? <AuthNotice>{formError}</AuthNotice> : null}

        <PasswordField
          label={t('auth.password')}
          value={password}
          onChangeText={setPassword}
          onBlur={() => setTouched((t) => ({ ...t, password: true }))}
          meter
          personal={[name, email.split('@')[0] ?? '']}
          showProblems={!!touched.password || password.length >= MIN_LENGTH}
          placeholder={t('auth.minChars', { count: MIN_LENGTH })}
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => confirmRef.current?.focus()}
          autoFocus
        />

        <PasswordField
          ref={confirmRef}
          label={t('auth.confirmPassword')}
          value={confirm}
          onChangeText={setConfirm}
          onBlur={() => setTouched((t) => ({ ...t, confirm: true }))}
          error={touched.confirm && !confirmOk ? t('auth.passwordsDiffer') : null}
          placeholder={t('auth.typeOnceMore')}
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="done"
          onSubmitEditing={() => void createAccount()}
        />

        <AuthButton
          label={t('auth.createAccount')}
          onPress={() => void createAccount()}
          disabled={!stepTwoOk}
          busy={busy}
        />

        <Text style={styles.terms}>{t('auth.terms')}</Text>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title={t('auth.confirmEmail')}
      subtitle={t('auth.codeSentTo', { email: email.trim().toLowerCase() })}
      step={3}
      steps={3}
      onBack={back}>
      <View style={styles.otpWrap}>
        <OtpInput
          value={code}
          onChange={(v) => {
            setCode(v);
            if (codeError) setCodeError(null);
          }}
          invalid={!!codeError}
          editable={!busy}
          onComplete={(c) => void verify(c)}
        />
      </View>

      {codeError ? <Text style={styles.codeError}>{codeError}</Text> : null}

      <AuthButton
        label={t('auth.confirmAndFinish')}
        onPress={() => void verify(code)}
        disabled={code.length < 6}
        busy={busy}
      />

      <View style={styles.codeFooter}>
        <Press onPress={() => void resend()} disabled={cooldown > 0 || busy} hitSlop={8}>
          <Text style={[styles.footerLink, cooldown > 0 && { color: color.mutedLight }]}>
            {cooldown > 0 ? t('auth.resendIn', { count: cooldown }) : t('auth.resendCode')}
          </Text>
        </Press>
        <Press onPress={back} hitSlop={8}>
          <Text style={styles.footerLink}>{t('auth.wrongEmail')}</Text>
        </Press>
      </View>

      <Text style={styles.spamHint}>{t('auth.spamHint', { sender: MAIL_SENDER })}</Text>
    </AuthScreen>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    terms: {
      fontFamily: body[400],
      fontSize: 11.5,
      lineHeight: 17.5,
      color: color.mutedLight,
      textAlign: 'center',
      marginTop: 16,
    },
    otpWrap: { marginBottom: 8 },
    codeError: {
      fontFamily: body[600],
      fontSize: 13,
      color: color.dangerDeep,
      textAlign: 'center',
      marginTop: 12,
      marginBottom: 2,
    },
    codeFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 18,
    },
    footerLink: { fontFamily: body[700], fontSize: 14, color: color.primary },
    spamHint: {
      fontFamily: body[400],
      fontSize: 12,
      lineHeight: 18,
      color: color.mutedLight,
      textAlign: 'center',
      marginTop: 20,
    },
  });

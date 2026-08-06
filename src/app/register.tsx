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
        title: 'Leave without confirming?',
        message:
          'Your account is not active until you enter the code. You can start again from scratch.',
        confirmLabel: 'Leave',
        cancelLabel: 'Keep going',
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
          ? `That password was rejected by the server. Use at least ${MIN_LENGTH} characters.`
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
          ? 'That code has expired. Send yourself a new one.'
          : /invalid|token|otp/i.test(msg)
            ? 'That code is not right. Check it and try again.'
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
        title="Create your account"
        subtitle="Your students will see this name on the messages you send."
        step={1}
        steps={3}
        onBack={back}
        footer={
          <AuthLink
            prompt="Already have an account?"
            label="Sign in"
            onPress={() => router.replace({ pathname: '/login', params: { email: email.trim() } })}
          />
        }>
        {formError ? <AuthNotice>{formError}</AuthNotice> : null}

        <AuthField
          label="Full name"
          value={name}
          onChangeText={setName}
          onBlur={() => setTouched((t) => ({ ...t, name: true }))}
          error={touched.name && !nameOk ? 'Please enter your full name.' : null}
          placeholder="Aýgül Berdiýewa"
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
          label="Email"
          value={email}
          onChangeText={setEmail}
          onBlur={() => setTouched((t) => ({ ...t, email: true }))}
          error={touched.email && !emailOk ? 'That does not look like an email address.' : null}
          hint="We send a confirmation code here."
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
          label="Phone"
          optional
          value={phone}
          onChangeText={setPhone}
          onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
          error={touched.phone && !phoneOk ? 'Use digits, spaces and + only.' : null}
          hint="Only so students can reach you. Never shown to anyone else."
          placeholder="+993 6X XX XX XX"
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          returnKeyType="done"
          onSubmitEditing={submitDetails}
        />

        <AuthButton label="Continue" onPress={submitDetails} disabled={!stepOneOk} />
      </AuthScreen>
    );
  }

  if (step === 2) {
    return (
      <AuthScreen
        title="Choose a password"
        subtitle={`This is what you will sign in with, alongside ${email.trim().toLowerCase()}.`}
        step={2}
        steps={3}
        onBack={back}>
        {formError ? <AuthNotice>{formError}</AuthNotice> : null}

        <PasswordField
          label="Password"
          value={password}
          onChangeText={setPassword}
          onBlur={() => setTouched((t) => ({ ...t, password: true }))}
          meter
          personal={[name, email.split('@')[0] ?? '']}
          showProblems={!!touched.password || password.length >= MIN_LENGTH}
          placeholder={`At least ${MIN_LENGTH} characters`}
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => confirmRef.current?.focus()}
          autoFocus
        />

        <PasswordField
          ref={confirmRef}
          label="Confirm password"
          value={confirm}
          onChangeText={setConfirm}
          onBlur={() => setTouched((t) => ({ ...t, confirm: true }))}
          error={touched.confirm && !confirmOk ? 'The two passwords do not match.' : null}
          placeholder="Type it once more"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="done"
          onSubmitEditing={() => void createAccount()}
        />

        <AuthButton
          label="Create account"
          onPress={() => void createAccount()}
          disabled={!stepTwoOk}
          busy={busy}
        />

        <Text style={styles.terms}>
          By creating an account you agree to the Terms and Privacy Policy.
        </Text>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title="Confirm your email"
      subtitle={`We sent a six-digit code to ${email.trim().toLowerCase()}. It expires in 10 minutes.`}
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
        label="Confirm and finish"
        onPress={() => void verify(code)}
        disabled={code.length < 6}
        busy={busy}
      />

      <View style={styles.codeFooter}>
        <Press onPress={() => void resend()} disabled={cooldown > 0 || busy} hitSlop={8}>
          <Text style={[styles.footerLink, cooldown > 0 && { color: color.mutedLight }]}>
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
          </Text>
        </Press>
        <Press onPress={back} hitSlop={8}>
          <Text style={styles.footerLink}>Wrong email?</Text>
        </Press>
      </View>

      <Text style={styles.spamHint}>
        Not there? Check your spam folder — the sender is notifications@smiletech.dev.
      </Text>
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

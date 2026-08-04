import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glow, AngledGradient, Ring } from '@/components/decor';
import { GoogleMark, Icon } from '@/components/Icon';
import { Logo, Press } from '@/components/ui';
import { useStore } from '@/data/store';
import {
  AuthCancelled,
  isAppleSignInAvailable,
  redirectTo,
  sendEmailCode,
  signInWithApple,
  signInWithGoogle,
  verifyEmailCode,
} from '@/lib/auth';
import { hasSupabase } from '@/lib/supabase';
import { radius, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, display, text } from '@/theme/type';

const ON_DARK = 'rgba(234,240,251,';

type Provider = 'google' | 'apple' | 'email';

export default function SignIn() {
  const { color, scheme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const signIn = useStore((s) => s.signIn);
  const enterDemoMode = useStore((s) => s.enterDemoMode);

  const [busy, setBusy] = useState<Provider | null>(null);
  const [appleReady, setAppleReady] = useState(false);

  const [emailOpen, setEmailOpen] = useState(false);
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');

  useEffect(() => {
    isAppleSignInAvailable().then(setAppleReady);
  }, []);

  /**
   * With a project configured this runs the real OAuth flow and the root
   * layout's session listener does the navigating. Without one it flips the
   * local flag so the app is still walkable on seed data.
   */
  const enter = async (provider: Provider) => {
    if (!hasSupabase) {
      signIn();
      router.replace('/(tabs)');
      return;
    }

    // Email is a two-step flow of its own, not a one-shot provider handoff.
    if (provider === 'email') {
      setEmailOpen(true);
      return;
    }

    setBusy(provider);
    try {
      if (provider === 'apple') await signInWithApple();
      else await signInWithGoogle();
      router.replace('/(tabs)');
    } catch (e) {
      if (!(e instanceof AuthCancelled)) {
        Alert.alert('Could not sign in', e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(null);
    }
  };

  /**
   * Straight into the app on seed data — no account, no network. Writes stay
   * local (see `demo` in the store), so nothing here can touch real rows.
   */
  const skipToDemo = () => {
    enterDemoMode();
    router.replace('/(tabs)');
  };

  const sendCode = async () => {
    setBusy('email');
    try {
      await sendEmailCode(email);
      setStep('code');
    } catch (e) {
      Alert.alert('Could not send the code', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const verifyCode = async () => {
    setBusy('email');
    try {
      await verifyEmailCode(email, code);
      setEmailOpen(false);
      router.replace('/(tabs)');
    } catch (e) {
      Alert.alert('That code did not work', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.hero, { paddingTop: insets.top }]}>
        <AngledGradient
          colors={[color.navyGradientTop, color.navy]}
          locations={[0, 0.62]}
          angle={160}
        />
        <Glow size={280} tint={color.primary} style={{ left: -60, top: -40 }} />
        <Ring size={220} tint={`${ON_DARK}0.14)`} style={{ right: -70, top: 120 }} />
        <Ring size={120} tint={`${ON_DARK}0.1)`} style={{ right: -30, top: 170 }} />

        <View style={styles.brandRow}>
          <Logo size={46} />
          <Text style={styles.brandName}>ClassCare</Text>
        </View>

        <Text style={styles.title}>Your classes,{'\n'}all in one place.</Text>
        <Text style={styles.subtitle}>
          Groups, students, attendance and messages — built for teachers, not for schools.
        </Text>

        <View style={styles.chipRow}>
          <Chip label="Bulk SMS & email" />
          <Chip label="Attendance in 30s" />
        </View>
      </View>

      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 18) + 16 }]}>
        <Text style={[text.sheetTitle, styles.ink]}>Get started</Text>
        <Text style={styles.sheetHint}>Your data stays in your own account.</Text>

        <View style={styles.actions}>
          <Press
            onPress={() => enter('google')}
            disabled={busy !== null}
            style={styles.googleButton}>
            {busy === 'google' ? (
              <ActivityIndicator color={color.ink} />
            ) : (
              <>
                <GoogleMark size={19} />
                <Text style={styles.providerLabel}>Continue with Google</Text>
              </>
            )}
          </Press>

          {/* Apple's sheet only exists on iOS; showing a dead button elsewhere
              would be worse than showing nothing. */}
          {appleReady || Platform.OS === 'ios' ? (
            <Press
              onPress={() => enter('apple')}
              disabled={busy !== null}
              style={styles.appleButton}>
              {busy === 'apple' ? (
                <ActivityIndicator color={color.appleInk} />
              ) : (
                <>
                  <Icon name="apple" size={17} color={color.appleInk} />
                  <Text style={[styles.providerLabel, { color: color.appleInk }]}>
                    Continue with Apple
                  </Text>
                </>
              )}
            </Press>
          ) : null}

          <Press onPress={() => enter('email')} disabled={busy !== null} style={styles.emailButton}>
            <Text style={styles.emailLabel}>Use email instead</Text>
          </Press>
        </View>

        <Text style={styles.terms}>By continuing you agree to the Terms and Privacy Policy.</Text>

        {/* Dev builds only — __DEV__ is false in preview and production, so
            this cannot ship as an auth bypass. */}
        {__DEV__ ? (
          <>
            <Press onPress={skipToDemo} style={styles.skip}>
              <Text style={styles.skipLabel}>Skip · explore with demo data</Text>
            </Press>
            {/* The OAuth return URL this build actually generates. It has to be
                on Supabase's redirect allow-list verbatim, and a dev client does
                not always produce the plain `classcare://` form. */}
            <Text style={styles.redirectHint} selectable>
              redirect: {redirectTo}
            </Text>
          </>
        ) : null}
      </View>

      <Modal
        visible={emailOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setEmailOpen(false)}>
        <Press style={styles.scrim} onPress={() => setEmailOpen(false)} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.emailSheet, { paddingBottom: Math.max(insets.bottom, 18) + 16 }]}>
            <View style={styles.grabber} />

            {step === 'email' ? (
              <>
                <Text style={[text.sheetTitle, styles.ink]}>What&rsquo;s your email?</Text>
                <Text style={styles.sheetHint}>
                  We&rsquo;ll send a six-digit code. No password to remember.
                </Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor={color.mutedLight}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                  returnKeyType="send"
                  onSubmitEditing={sendCode}
                  style={styles.emailInput}
                  selectionColor={color.primary}
                  keyboardAppearance={scheme === 'dark' ? 'dark' : 'light'}
                />
                <Press
                  onPress={sendCode}
                  disabled={busy !== null || !email.includes('@')}
                  style={[
                    styles.sheetButton,
                    (busy !== null || !email.includes('@')) && styles.sheetButtonOff,
                  ]}>
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.sheetButtonLabel}>Send code</Text>
                  )}
                </Press>
              </>
            ) : (
              <>
                <Text style={[text.sheetTitle, styles.ink]}>Enter the code</Text>
                <Text style={styles.sheetHint}>Sent to {email.trim().toLowerCase()}</Text>
                <TextInput
                  value={code}
                  onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  placeholderTextColor={color.dashed}
                  keyboardType="number-pad"
                  autoFocus
                  maxLength={6}
                  returnKeyType="done"
                  onSubmitEditing={verifyCode}
                  style={[styles.emailInput, styles.codeInput]}
                  selectionColor={color.primary}
                  keyboardAppearance={scheme === 'dark' ? 'dark' : 'light'}
                />
                <Press
                  onPress={verifyCode}
                  disabled={busy !== null || code.length < 6}
                  style={[
                    styles.sheetButton,
                    (busy !== null || code.length < 6) && styles.sheetButtonOff,
                  ]}>
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.sheetButtonLabel}>Sign in</Text>
                  )}
                </Press>
                <Press
                  onPress={() => {
                    setStep('email');
                    setCode('');
                  }}
                  style={styles.sheetLink}>
                  <Text style={styles.sheetLinkLabel}>Use a different email</Text>
                </Press>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function Chip({ label }: { label: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.chip}>
      <Text style={styles.chipLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    /** Default body ink. Text does not inherit colour from a parent View. */
    ink: { color: color.ink },
    root: { flex: 1, backgroundColor: color.navy },

    hero: {
      flex: 1,
      overflow: 'hidden',
      justifyContent: 'flex-end',
      paddingHorizontal: 26,
      paddingBottom: 34,
    },
    brandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 34,
    },
    brandName: {
      fontFamily: display[600],
      fontSize: 20,
      letterSpacing: -0.2,
      color: color.onDark,
    },
    title: { ...text.hero, color: color.onDark },
    subtitle: {
      fontFamily: body[400],
      fontSize: 15,
      lineHeight: 23.25,
      color: `${ON_DARK}0.6)`,
      marginTop: 14,
      maxWidth: 290,
    },

    chipRow: { flexDirection: 'row', gap: 8, marginTop: 26 },
    chip: {
      backgroundColor: `${ON_DARK}0.1)`,
      borderWidth: 1,
      borderColor: `${ON_DARK}0.14)`,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: radius.md,
    },
    chipLabel: {
      fontFamily: body[600],
      fontSize: 12,
      letterSpacing: 0.24,
      color: `${ON_DARK}0.8)`,
    },

    sheet: {
      backgroundColor: color.sheet,
      borderTopLeftRadius: radius.sheet,
      borderTopRightRadius: radius.sheet,
      paddingHorizontal: 24,
      paddingTop: 26,
    },
    sheetHint: {
      fontFamily: body[400],
      fontSize: 13.5,
      color: color.muted,
      marginTop: 5,
    },

    actions: { gap: 10, marginTop: 20 },
    googleButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 11,
      height: 54,
      borderRadius: radius.button,
      backgroundColor: color.googleBg,
      borderWidth: 1,
      borderColor: color.googleBorder,
    },
    appleButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 11,
      height: 54,
      borderRadius: radius.button,
      backgroundColor: color.appleBg,
    },
    providerLabel: { fontFamily: body[600], fontSize: 15.5, color: color.ink },

    emailButton: {
      height: 50,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.button,
    },
    emailLabel: { fontFamily: body[600], fontSize: 15, color: color.primary },

    terms: {
      fontFamily: body[400],
      fontSize: 11.5,
      lineHeight: 17.25,
      color: color.mutedLight,
      textAlign: 'center',
      marginTop: 12,
    },

    redirectHint: {
      fontFamily: body[400],
      fontSize: 10,
      color: color.faint,
      textAlign: 'center',
      marginTop: 2,
    },
    skip: {
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
    },
    skipLabel: {
      fontFamily: body[600],
      fontSize: 12.5,
      color: color.mutedLight,
      textDecorationLine: 'underline',
    },

    scrim: { flex: 1, backgroundColor: color.scrim },
    emailSheet: {
      backgroundColor: color.sheet,
      borderTopLeftRadius: radius.sheet,
      borderTopRightRadius: radius.sheet,
      paddingHorizontal: 24,
      paddingTop: 10,
    },
    grabber: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: color.dashed,
      marginBottom: 16,
    },
    emailInput: {
      height: 54,
      marginTop: 18,
      paddingHorizontal: 16,
      borderRadius: radius.button,
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: color.border,
      fontFamily: body[600],
      fontSize: 16,
      color: color.ink,
    },
    codeInput: {
      textAlign: 'center',
      fontFamily: display[600],
      fontSize: 26,
      letterSpacing: 8,
    },
    sheetButton: {
      height: 54,
      marginTop: 10,
      borderRadius: radius.button,
      backgroundColor: color.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sheetButtonOff: { backgroundColor: color.borderStrong },
    sheetButtonLabel: { fontFamily: body[700], fontSize: 15.5, color: '#fff' },
    sheetLink: {
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 4,
    },
    sheetLinkLabel: {
      fontFamily: body[600],
      fontSize: 14,
      color: color.primary,
    },
  });

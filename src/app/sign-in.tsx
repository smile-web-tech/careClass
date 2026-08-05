import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AngledGradient, Glow, Ring } from '@/components/decor';
import { GoogleMark, Icon } from '@/components/Icon';
import { Logo, Press } from '@/components/ui';
import { useStore } from '@/data/store';
import {
  AuthCancelled,
  isAppleSignInAvailable,
  redirectTo,
  signInWithApple,
  signInWithGoogle,
} from '@/lib/auth';
import { hasSupabase } from '@/lib/supabase';
import { radius, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, display, text } from '@/theme/type';

const ON_DARK = 'rgba(234,240,251,';

type Provider = 'google' | 'apple';

/**
 * The front door.
 *
 * Providers live here because they are one tap and cannot fail halfway. Email
 * does not: signing in and registering ask for different things and deserve
 * their own screens, so both are links out of this one rather than a sheet that
 * has to be three forms at once.
 */
export default function SignIn() {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const signIn = useStore((s) => s.signIn);
  const enterDemoMode = useStore((s) => s.enterDemoMode);

  const [busy, setBusy] = useState<Provider | null>(null);
  const [appleReady, setAppleReady] = useState(false);

  useEffect(() => {
    isAppleSignInAvailable().then(setAppleReady);
  }, []);

  /**
   * With a project configured this runs the real flow and the root layout's
   * session listener does the navigating. Without one it flips the local flag
   * so the app is still walkable on seed data.
   */
  const enter = async (provider: Provider) => {
    if (!hasSupabase) {
      signIn();
      router.replace('/(tabs)');
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

  /** Email is two screens, and which one depends on whether they have an account. */
  const goEmail = (route: '/login' | '/register') => {
    if (!hasSupabase) {
      signIn();
      router.replace('/(tabs)');
      return;
    }
    router.push(route);
  };

  /**
   * Straight into the app on seed data — no account, no network. Writes stay
   * local (see `demo` in the store), so nothing here can touch real rows.
   */
  const skipToDemo = () => {
    enterDemoMode();
    router.replace('/(tabs)');
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

      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 18) + 12 }]}>
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

          <View style={styles.orRow}>
            <View style={styles.orRule} />
            <Text style={styles.orLabel}>or</Text>
            <View style={styles.orRule} />
          </View>

          <Press
            onPress={() => goEmail('/register')}
            disabled={busy !== null}
            style={styles.emailButton}>
            <Icon name="mail" size={16} color={color.ink} />
            <Text style={styles.providerLabel}>Sign up with email</Text>
          </Press>
        </View>

        <View style={styles.signInRow}>
          <Text style={styles.signInPrompt}>Already have an account? </Text>
          <Press onPress={() => goEmail('/login')} accessibilityRole="link" hitSlop={8}>
            <Text style={styles.signInLabel}>Sign in</Text>
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

    orRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 2 },
    orRule: { flex: 1, height: 1, backgroundColor: color.border },
    orLabel: { fontFamily: body[500], fontSize: 12, color: color.mutedLight },

    emailButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      height: 54,
      borderRadius: radius.button,
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: color.border,
    },

    signInRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 16,
    },
    signInPrompt: { fontFamily: body[400], fontSize: 14, color: color.muted },
    signInLabel: { fontFamily: body[700], fontSize: 14, color: color.primary },

    terms: {
      fontFamily: body[400],
      fontSize: 11.5,
      lineHeight: 17.25,
      color: color.mutedLight,
      textAlign: 'center',
      marginTop: 10,
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
  });

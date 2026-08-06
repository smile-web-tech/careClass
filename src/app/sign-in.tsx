import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showError } from '@/components/Dialog';
import { useT } from '@/i18n/useT';
import { AngledGradient, Glow, Ring } from '@/components/decor';
import { GoogleMark, Icon } from '@/components/Icon';
import { Logo, Press } from '@/components/ui';
import { useStore } from '@/data/store';
import {
  AuthCancelled,
  isAppleSignInAvailable,
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
  const t = useT();
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const signIn = useStore((s) => s.signIn);

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
        showError(e, t('auth.couldNotSignIn'));
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

        <Text style={styles.title}>{t('auth.heroTitle')}</Text>
        <Text style={styles.subtitle}>{t('auth.heroSubtitle')}</Text>

        <View style={styles.chipRow}>
          <Chip label={t('auth.chipSms')} />
          <Chip label={t('auth.chipAttendance')} />
        </View>
      </View>

      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 18) + 12 }]}>
        <Text style={[text.sheetTitle, styles.ink]}>{t('auth.getStarted')}</Text>
        <Text style={styles.sheetHint}>{t('auth.dataStays')}</Text>

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
                <Text style={styles.providerLabel}>{t('auth.continueWithGoogle')}</Text>
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
            <Text style={styles.providerLabel}>{t('auth.signUpWithEmail')}</Text>
          </Press>
        </View>

        <View style={styles.signInRow}>
          <Text style={styles.signInPrompt}>{t('auth.haveAccount')}</Text>
          <Press onPress={() => goEmail('/login')} accessibilityRole="link" hitSlop={8}>
            <Text style={styles.signInLabel}>{t('auth.signIn')}</Text>
          </Press>
        </View>

        <Text style={styles.terms}>{t('auth.terms')}</Text>


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

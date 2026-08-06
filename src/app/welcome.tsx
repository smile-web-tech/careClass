/**
 * First run: pick a language, then go and sign in.
 *
 * Shown once, gated on `languageChosen` rather than on `language` having a
 * value — the store already defaults to Turkmen, so "has a language" would be
 * true before anyone was asked and this screen would never appear.
 *
 * Everything on it is drawn from the catalogue, so the copy changes the instant
 * a card is tapped. That is the point: the teacher sees the language they just
 * chose take effect before committing to it.
 */
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AngledGradient, Glow } from '@/components/decor';
import { LanguagePicker } from '@/components/LanguagePicker';
import { Button, Logo } from '@/components/ui';
import { useStore } from '@/data/store';
import { useT } from '@/i18n/useT';
import { space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, display } from '@/theme/type';

export default function Welcome() {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();

  // Tapping a card already writes the choice, so this only has to record that
  // the question was asked and get out of the way.
  const setLanguage = useStore((s) => s.setLanguage);
  const language = useStore((s) => s.language);

  const done = () => {
    setLanguage(language);
    router.replace('/sign-in');
  };

  return (
    <View style={styles.root}>
      <AngledGradient
        colors={[color.navyGradientTop, color.navy]}
        locations={[0, 0.62]}
        angle={160}
        style={StyleSheet.absoluteFill}
      />
      <Glow size={300} tint={color.primary} style={{ left: -70, top: -50 }} />

      <View style={[styles.content, { paddingTop: insets.top + 56, paddingBottom: insets.bottom + 28 }]}>
        <Logo size={68} />
        <Text style={styles.title}>{t('auth.welcomeTitle')}</Text>
        <Text style={styles.subtitle}>{t('auth.welcomeSubtitle')}</Text>

        <View style={styles.picker}>
          <Text style={styles.pickerLabel}>{t('auth.chooseLanguage')}</Text>
          <LanguagePicker variant="cards" />
        </View>

        <View style={{ flex: 1 }} />

        {/*
          Deliberately not `grow`. That sets `flex: 1`, which in this column
          container made the button stretch to fill every pixel the spacer above
          did not — a button the height of half the screen. `alignSelf` is what
          "full width" means here.
        */}
        <Button label={t('auth.getStarted')} height={50} onPress={done} style={styles.cta} />
      </View>
    </View>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: color.navy },
    content: {
      flex: 1,
      paddingHorizontal: space.gutter,
      alignItems: 'center',
    },
    title: {
      fontFamily: display[700],
      fontSize: 30,
      color: '#fff',
      marginTop: 22,
    },
    subtitle: {
      fontFamily: body[400],
      fontSize: 14.5,
      lineHeight: 22,
      color: 'rgba(255,255,255,0.72)',
      textAlign: 'center',
      marginTop: 8,
      maxWidth: 320,
    },
    picker: { alignSelf: 'stretch', marginTop: 40 },
    cta: { alignSelf: 'stretch' },
    pickerLabel: {
      fontFamily: body[700],
      fontSize: 12,
      letterSpacing: 0.9,
      textTransform: 'uppercase',
      color: 'rgba(255,255,255,0.6)',
      marginBottom: 12,
    },
  });

/**
 * What ClassCare is, who wrote it, and how to reach them.
 *
 * Every word here comes from the catalogue, so the page reads in whichever
 * language the teacher chose — including the feature descriptions, which are
 * the part someone deciding whether to keep the app will actually read.
 *
 * The contact details are constants rather than translations: an email address
 * is not a phrase, and putting it in three catalogues would be three places to
 * get it wrong.
 */
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showAlert } from '@/components/Dialog';
import { Icon, type IconName } from '@/components/Icon';
import { Screen, TopBar } from '@/components/layout';
import { Card, Divider, Logo, Overline, Press } from '@/components/ui';
import type { TranslationKey } from '@/i18n';
import { useT } from '@/i18n/useT';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, display } from '@/theme/type';

const DEVELOPER = 'Ysmayyl Mammetgeldiyev';
const SUPPORT_EMAIL = 'smiletechweb@gmail.com';
const WEBSITE = 'smiletech.dev';

const FEATURES: { icon: IconName; titleKey: TranslationKey; bodyKey: TranslationKey }[] = [
  { icon: 'tabGroups', titleKey: 'about.f1Title', bodyKey: 'about.f1Body' },
  { icon: 'check', titleKey: 'about.f2Title', bodyKey: 'about.f2Body' },
  { icon: 'tabMessages', titleKey: 'about.f3Title', bodyKey: 'about.f3Body' },
  { icon: 'pencil', titleKey: 'about.f4Title', bodyKey: 'about.f4Body' },
];

export default function About() {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const t = useT();

  /**
   * Open something, and say so plainly if the device cannot.
   *
   * Deliberately not gated on `canOpenURL` — see `lib/contact.ts` for why that
   * reports false negatives for `mailto:` on modern Android.
   */
  const open = async (url: string, what: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      void showAlert(t('error.cannotOpen'), t('error.noAppFor', { what }), 'danger');
    }
  };

  const emailSupport = () =>
    open(
      `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(t('about.supportSubject'))}`,
      t('about.contact'),
    );

  return (
    <Screen>
      <TopBar title={t('about.title')} dismiss />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingTop: 20,
          paddingBottom: insets.bottom + 40,
        }}
        showsVerticalScrollIndicator={false}>
        <View style={styles.masthead}>
          <Logo size={64} />
          <Text style={styles.name}>ClassCare</Text>
          <Text style={styles.tagline}>{t('about.tagline')}</Text>
        </View>

        <Card style={styles.introCard}>
          <Text style={styles.intro}>{t('about.intro')}</Text>
        </Card>

        <Card style={styles.group}>
          {FEATURES.map((f, i) => (
            <View key={f.titleKey}>
              {i > 0 ? <Divider inset={62} /> : null}
              <View style={styles.feature}>
                <View style={styles.featureIcon}>
                  <Icon name={f.icon} size={17} color={color.primary} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.featureTitle}>{t(f.titleKey)}</Text>
                  <Text style={styles.featureBody}>{t(f.bodyKey)}</Text>
                </View>
              </View>
            </View>
          ))}
        </Card>

        <View style={styles.privacyRow}>
          <Icon name="info" size={15} color={color.mutedLight} />
          <Text style={styles.privacy}>{t('about.privacy')}</Text>
        </View>

        <Overline style={styles.label}>{t('about.developer')}</Overline>
        <Card style={styles.group}>
          <View style={styles.developerRow}>
            <Text style={styles.developerName}>{DEVELOPER}</Text>
          </View>

          <Divider inset={15} />
          <ContactRow
            icon="mail"
            label={t('about.contact')}
            value={SUPPORT_EMAIL}
            onPress={emailSupport}
          />
          <Divider inset={15} />
          <ContactRow
            icon="disclosure"
            label={t('about.website')}
            value={WEBSITE}
            onPress={() => open(`https://${WEBSITE}`, t('about.website'))}
          />
        </Card>

        <Press onPress={emailSupport} haptic style={styles.support}>
          <Icon name="mail" size={16} color="#fff" />
          <Text style={styles.supportLabel}>{t('about.support')}</Text>
        </Press>
        <Text style={styles.supportHint}>{t('about.supportHint')}</Text>

        <Text style={styles.version}>ClassCare 1.0.0</Text>
      </ScrollView>
    </Screen>
  );
}

function ContactRow({
  icon,
  label,
  value,
  onPress,
}: {
  icon: IconName;
  label: string;
  value: string;
  onPress: () => void;
}) {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Press onPress={onPress} style={styles.contactRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.contactLabel}>{label}</Text>
        <Text style={styles.contactValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
      <Icon name={icon} size={16} color={color.chevron} />
    </Press>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    masthead: { alignItems: 'center', marginBottom: 24 },
    name: { fontFamily: display[700], fontSize: 24, color: color.ink, marginTop: 14 },
    tagline: {
      fontFamily: body[400],
      fontSize: 14,
      color: color.mutedLight,
      marginTop: 4,
      textAlign: 'center',
    },

    introCard: { paddingHorizontal: 16, paddingVertical: 15, marginBottom: 22 },
    intro: { fontFamily: body[400], fontSize: 14.5, lineHeight: 23, color: color.inkSoft },

    group: { overflow: 'hidden', marginBottom: 18 },
    feature: { flexDirection: 'row', gap: 13, paddingHorizontal: 15, paddingVertical: 14 },
    featureIcon: {
      width: 34,
      height: 34,
      borderRadius: radius.md,
      backgroundColor: color.primaryTint,
      alignItems: 'center',
      justifyContent: 'center',
    },
    featureTitle: { fontFamily: body[700], fontSize: 14.5, color: color.ink },
    featureBody: {
      fontFamily: body[400],
      fontSize: 13,
      lineHeight: 20,
      color: color.mutedLight,
      marginTop: 3,
    },

    privacyRow: { flexDirection: 'row', gap: 9, marginBottom: 26, paddingHorizontal: 4 },
    privacy: {
      flex: 1,
      fontFamily: body[400],
      fontSize: 12.5,
      lineHeight: 19,
      color: color.mutedLight,
    },

    label: { marginBottom: 10 },
    developerRow: { paddingHorizontal: 15, paddingVertical: 14 },
    developerName: { fontFamily: body[700], fontSize: 15.5, color: color.ink },

    contactRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 15,
      paddingVertical: 13,
    },
    contactLabel: {
      fontFamily: body[700],
      fontSize: 10.5,
      letterSpacing: 0.84,
      textTransform: 'uppercase',
      color: color.mutedLight,
    },
    contactValue: { fontFamily: body[600], fontSize: 14.5, color: color.ink, marginTop: 2 },

    support: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 9,
      height: 50,
      borderRadius: radius.button,
      backgroundColor: color.primary,
      marginTop: 6,
    },
    supportLabel: { fontFamily: body[700], fontSize: 14.5, color: '#fff' },
    supportHint: {
      fontFamily: body[400],
      fontSize: 12.5,
      color: color.mutedLight,
      textAlign: 'center',
      marginTop: 9,
    },

    version: {
      fontFamily: body[400],
      fontSize: 12,
      color: color.faint,
      textAlign: 'center',
      marginTop: 28,
    },
  });

/**
 * Create a term.
 *
 * Terms used to exist only as a consequence of a group carrying one, which put
 * the two the wrong way round: a teacher plans the autumn intake and *then*
 * decides which courses are in it. A term you cannot make until you have
 * already made a course in it is not something you can plan with.
 *
 * A year and four seasons, and nothing else. There is nothing on a term but its
 * name — no dates, no settings — so a form would be a form with one field, and
 * the four chips are that field.
 */
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Screen, TopBar } from '@/components/layout';
import { IconButton, Press } from '@/components/ui';
import { useStore, useTerms } from '@/data/store';
import { useT } from '@/i18n/useT';
import { SEASONS, formatTerm, parseTerm, termLabel, termOf } from '@/lib/term';
import { toKey } from '@/lib/date';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body } from '@/theme/type';

export default function NewTerm() {
  const t = useT();
  const router = useRouter();
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const existing = useTerms();
  const createTerm = useStore((s) => s.createTerm);

  /*
    Opened on the year the teacher is working in, not on the year of their
    newest term.

    Those are usually the same and, when they are not, it is because the newest
    term is one they set up in advance — landing on next year to make this
    year's term would be the wrong way round.
  */
  const [year, setYear] = useState(() => parseTerm(termOf(toKey(new Date())))?.year ?? 2026);

  const have = useMemo(() => new Set(existing), [existing]);

  const make = (season: (typeof SEASONS)[number]) => {
    createTerm(formatTerm({ year, season }));
    router.back();
  };

  return (
    <Screen>
      <TopBar title={t('term.new')} dismiss />

      <ScrollView contentContainerStyle={{ padding: space.gutter }}>
        <Text style={styles.hint}>{t('term.newHint')}</Text>

        <View style={styles.yearRow}>
          <IconButton
            name="chevronLeft"
            onPress={() => setYear((y) => y - 1)}
            accessibilityLabel={String(year - 1)}
          />
          <Text style={styles.year}>{year}</Text>
          <IconButton
            name="chevronRight"
            onPress={() => setYear((y) => y + 1)}
            accessibilityLabel={String(year + 1)}
          />
        </View>

        <View style={styles.seasons}>
          {SEASONS.map((season) => {
            const key = formatTerm({ year, season });
            const already = have.has(key);
            return (
              <Press
                key={season}
                haptic={!already}
                // A term that exists is shown rather than hidden: a teacher
                // looking for autumn needs to see that autumn is already there,
                // not find a gap where they expected a button.
                disabled={already}
                onPress={() => make(season)}
                accessibilityRole="button"
                accessibilityLabel={termLabel(key, t)}
                style={[styles.season, already && styles.seasonHave]}>
                <Text style={[styles.seasonLabel, already && { color: color.mutedLight }]}>
                  {termLabel(key, t)}
                </Text>
                {already ? (
                  <View style={styles.haveRow}>
                    <Icon name="check" size={13} color={color.mutedLight} strokeWidth={2.4} />
                    <Text style={styles.haveLabel}>{t('term.already')}</Text>
                  </View>
                ) : (
                  <Icon name="plus" size={16} color={color.primary} strokeWidth={2.2} />
                )}
              </Press>
            );
          })}
        </View>
      </ScrollView>
    </Screen>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    hint: {
      fontFamily: body[400],
      fontSize: 13,
      lineHeight: 19,
      color: color.mutedLight,
      marginBottom: 18,
    },

    yearRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 18,
    },
    year: { fontFamily: body[700], fontSize: 22, color: color.ink },

    seasons: { gap: 10 },
    season: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: 58,
      paddingHorizontal: 16,
      borderRadius: radius.tile,
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: color.border,
    },
    seasonHave: { backgroundColor: color.fill, borderColor: color.border },
    seasonLabel: { fontFamily: body[600], fontSize: 15, color: color.ink },

    haveRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    haveLabel: { fontFamily: body[500], fontSize: 12.5, color: color.mutedLight },
  });

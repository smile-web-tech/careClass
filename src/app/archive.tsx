/**
 * Finished courses.
 *
 * The archive exists because the alternative teachers reach for is deleting the
 * group, and a group is where a year of registers and marks are hanging. Every
 * one of those rows survives archiving; the course simply stops appearing in
 * the screens that are about teaching now.
 *
 * Read-only by design, apart from restoring. A finished term is a record, and a
 * screen that let you edit it would invite exactly the tidying-up that loses
 * the record. Tapping a course opens its normal page, where its roster,
 * attendance and marks read as they always did.
 */
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirm } from '@/components/Dialog';
import { Icon } from '@/components/Icon';
import { Screen, TopBar } from '@/components/layout';
import { Card, EmptyState, Press, Txt } from '@/components/ui';
import { useArchivedGroups, useStore, useStudents } from '@/data/store';
import type { Group } from '@/data/types';
import { useT } from '@/i18n/useT';
import { fromKey, shortDate } from '@/lib/date';
import { slotDaysLabel } from '@/lib/schedule';
import { compareTerms, termLabel, termOfGroup } from '@/lib/term';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, text } from '@/theme/type';

export default function Archive() {
  const t = useT();
  const { accents, color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const archived = useArchivedGroups();
  const students = useStudents();
  const restoreGroup = useStore((s) => s.restoreGroup);
  const restoreTerm = useStore((s) => s.restoreTerm);

  /** Terms, newest first, each with the courses filed under it. */
  const terms = useMemo(() => {
    const buckets = new Map<string, Group[]>();
    for (const g of archived) {
      const key = termOfGroup(g);
      const list = buckets.get(key);
      if (list) list.push(g);
      else buckets.set(key, [g]);
    }
    return [...buckets.entries()]
      .sort((a, b) => compareTerms(b[0], a[0]))
      .map(([term, groups]) => ({ term, groups }));
  }, [archived]);

  const askRestoreTerm = async (term: string, count: number) => {
    const ok = await confirm({
      title: t('archive.restoreTermTitle', { term: termLabel(term, t) }),
      message: t('archive.restoreTermBody', { count }),
      confirmLabel: t('archive.restore'),
      tone: 'info',
    });
    if (ok) restoreTerm(term);
  };

  return (
    <Screen>
      <TopBar title={t('archive.title')} dismiss />

      <ScrollView
        contentContainerStyle={{
          padding: space.gutter,
          paddingBottom: insets.bottom + 40,
        }}
        showsVerticalScrollIndicator={false}>
        {terms.length === 0 ? (
          <EmptyState title={t('archive.emptyTitle')} hint={t('archive.emptyHint')} />
        ) : null}

        {terms.map(({ term, groups }) => (
          <View key={term} style={styles.term}>
            <View style={styles.termHead}>
              <Text style={styles.termName}>{termLabel(term, t)}</Text>
              <Press
                onPress={() => void askRestoreTerm(term, groups.length)}
                style={styles.restoreAll}>
                <Icon name="refresh" size={13} color={color.primaryInk} />
                <Text style={styles.restoreAllLabel}>{t('archive.restoreAll')}</Text>
              </Press>
            </View>

            <Card style={styles.card}>
              {groups.map((g, i) => (
                <ArchivedRow
                  key={g.id}
                  group={g}
                  first={i === 0}
                  count={students.filter((s) => s.groupIds.includes(g.id)).length}
                  onOpen={() => router.push(`/group/${g.id}`)}
                  onRestore={() => restoreGroup(g.id)}
                />
              ))}
            </Card>
          </View>
        ))}

        {terms.length ? <Txt style={styles.footnote}>{t('archive.footnote')}</Txt> : null}
      </ScrollView>
    </Screen>
  );
}

function ArchivedRow({
  group,
  first,
  count,
  onOpen,
  onRestore,
}: {
  group: Group;
  first: boolean;
  count: number;
  onOpen: () => void;
  onRestore: () => void;
}) {
  const t = useT();
  const { accents, color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const a = accents[group.accent];

  // What a finished course is worth saying: when it ran, how many were in it,
  // and which days it met. Not the next session, which it does not have.
  const ran = group.endsOn
    ? t('archive.ended', { date: shortDate(fromKey(group.endsOn)) })
    : group.archivedAt
      ? t('archive.filed', { date: shortDate(fromKey(group.archivedAt.slice(0, 10))) })
      : '';

  return (
    <View style={[styles.row, !first && styles.rowDivided]}>
      <Press onPress={onOpen} style={styles.rowMain}>
        <View style={[styles.dot, { backgroundColor: a.dot }]} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[text.rowTitleSm, { color: color.ink }]} numberOfLines={1}>
            {group.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {[t('students.count', { count }), slotDaysLabel(group), ran]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      </Press>

      <Press
        onPress={onRestore}
        accessibilityLabel={t('archive.restore')}
        style={styles.restoreOne}>
        <Icon name="refresh" size={15} color={color.inkSoft} />
      </Press>
    </View>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    term: { marginBottom: 20 },
    termHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 8,
      paddingHorizontal: 2,
    },
    termName: {
      flex: 1,
      fontFamily: body[700],
      fontSize: 13.5,
      color: color.inkSoft,
    },
    restoreAll: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: radius.xs + 2,
      backgroundColor: color.primaryTint,
    },
    restoreAllLabel: { fontFamily: body[700], fontSize: 11.5, color: color.primaryInk },

    card: { paddingVertical: 2 },
    row: { flexDirection: 'row', alignItems: 'center' },
    rowDivided: { borderTopWidth: 1, borderTopColor: color.border },
    rowMain: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      paddingVertical: 12,
      paddingLeft: 14,
      paddingRight: 6,
    },
    dot: { width: 9, height: 9, borderRadius: 4.5 },
    meta: { fontFamily: body[400], fontSize: 12, color: color.mutedLight, marginTop: 3 },
    restoreOne: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 4,
      borderRadius: radius.control,
    },

    footnote: {
      fontFamily: body[400],
      fontSize: 12.5,
      lineHeight: 19,
      color: color.mutedLight,
      marginTop: 4,
      paddingHorizontal: 2,
    },
  });

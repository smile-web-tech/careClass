import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AngledGradient, Ring } from '@/components/decor';
import { Icon } from '@/components/Icon';
import { PageHeading, Screen, useTabInset } from '@/components/layout';
import { Avatar, Card, EmptyState, IconButton, initialsOf, Press, Txt } from '@/components/ui';
import { useGroups, useStore, useStudents } from '@/data/store';
import type { Group, Student } from '@/data/types';
import type { TranslationKey } from '@/i18n';
import { useT } from '@/i18n/useT';
import { smsNumber } from '@/lib/contact';
import { at, countdownTo, longDate, relativeSlot } from '@/lib/date';
import { nextSessionForGroup, nextSessionOverall, roomLabel } from '@/lib/schedule';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, display, text } from '@/theme/type';

export default function Home() {
  const t = useT();
  const { color, scheme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // The FAB floats over the list, so the scroll content needs clearance for
  // both the tab bar and the button itself.
  const bottomInset = useTabInset(24);
  const scrollInset = bottomInset + 62;
  const router = useRouter();

  const groups = useGroups();
  const students = useStudents();
  const teacherName = useStore((s) => s.teacherName);

  const [query, setQuery] = useState('');
  // Re-render on a slow tick so the countdown and "Today 16:00" stay honest
  // without spinning the whole tree every second.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const q = query.trim().toLowerCase();

  const matchedStudents = useMemo(
    () => (q ? students.filter((s) => s.name.toLowerCase().includes(q)) : []),
    [q, students],
  );

  const shown = useMemo(() => {
    if (!q) return groups;
    const viaStudent = new Set(matchedStudents.flatMap((s) => s.groupIds));
    return groups.filter(
      (g) => `${g.name} ${g.subject}`.toLowerCase().includes(q) || viaStudent.has(g.id),
    );
  }, [groups, matchedStudents, q]);

  const upNext = useMemo(() => nextSessionOverall(groups, now), [groups, now]);
  const upNextGroup = groups.find((g) => g.id === upNext?.groupId);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 10,
          paddingBottom: scrollInset,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <PageHeading
          eyebrow={longDate(now)}
          title={`${greetingFor(now, t)}, ${teacherName.split(' ')[0]}`}
          trailing={
            <Press
              onPress={() => router.push('/profile')}
              accessibilityLabel={t('home.yourProfile')}
              style={styles.teacherAvatar}>
              <Text style={styles.teacherInitials}>{initialsOf(teacherName)}</Text>
            </Press>
          }
          style={{ paddingBottom: 16 }}
        />

        <View style={styles.searchWrap}>
          <View style={styles.search}>
            <Icon name="search" size={17} color={color.mutedLight} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('home.searchPlaceholder')}
              placeholderTextColor={color.mutedLight}
              style={styles.searchInput}
              autoCorrect={false}
              returnKeyType="search"
              clearButtonMode="while-editing"
              selectionColor={color.primary}
              keyboardAppearance={scheme === 'dark' ? 'dark' : 'light'}
            />
          </View>
        </View>

        {upNext && upNextGroup ? (
          <UpNextCard
            group={upNextGroup}
            start={upNext.start}
            date={upNext.date}
            now={now}
            studentCount={students.filter((s) => s.groupIds.includes(upNextGroup.id)).length}
            onAttendance={() =>
              router.push({
                pathname: '/attendance',
                params: {
                  group: upNextGroup.id,
                  date: upNext.date,
                  start: upNext.start,
                },
              })
            }
            onNotify={() =>
              router.push({
                pathname: '/compose',
                params: { group: upNextGroup.id },
              })
            }
          />
        ) : null}

        <View style={styles.sectionHead}>
          <Text style={[text.section, styles.ink]}>{t('home.yourGroups')}</Text>
          <Text style={styles.sectionCount}>
            {shown.length === groups.length
              ? `${groups.length} active`
              : `${shown.length} of ${groups.length}`}
          </Text>
        </View>

        <View style={styles.list}>
          {shown.map((g) => (
            <GroupRow
              key={g.id}
              group={g}
              count={students.filter((s) => s.groupIds.includes(g.id)).length}
              now={now}
              onPress={() => router.push(`/group/${g.id}`)}
            />
          ))}

          {shown.length === 0 ? (
            <EmptyState title={t('home.noMatches')} hint={t('home.tryAnother')} />
          ) : null}

          <Press onPress={() => router.push('/group/new')} style={styles.newGroup}>
            <Icon name="plus" size={16} color={color.muted} />
            <Text style={styles.newGroupLabel}>{t('groups.new')}</Text>
          </Press>
        </View>

        {q && matchedStudents.length > 0 ? (
          <View style={styles.matchedWrap}>
            <Text style={styles.matchedLabel}>
              {matchedStudents.length} matching{' '}
              {t('students.count', { count: matchedStudents.length })}
            </Text>
            <View style={styles.matchedRow}>
              {matchedStudents.slice(0, 8).map((s) => (
                <MatchedStudent
                  key={s.id}
                  student={s}
                  onPress={() => router.push(`/student/${s.id}`)}
                />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <Press
        onPress={() => router.push('/student/new')}
        accessibilityLabel={t('home.addStudent')}
        style={[styles.fab, { bottom: bottomInset - 4 }]}>
        <Icon name="plusLarge" size={23} color="#fff" />
      </Press>
    </Screen>
  );
}

/**
 * The greeting, resolved through the caller's `t`.
 *
 * It used to call `translateNow`, which reads the current language but does not
 * subscribe to it — so switching language left the greeting in the old one
 * until something else happened to re-render the screen. Taking `t` puts it on
 * the same subscription as every other string here.
 */
function greetingFor(d: Date, t: (key: TranslationKey) => string) {
  const h = d.getHours();
  if (h < 12) return t('home.goodMorning');
  if (h < 18) return t('home.goodAfternoon');
  return t('home.goodEvening');
}

/* -------------------------------------------------------------------------- */

function UpNextCard({
  group,
  date,
  start,
  now,
  studentCount,
  onAttendance,
  onNotify,
}: {
  group: Group;
  date: string;
  start: string;
  now: Date;
  studentCount: number;
  onAttendance: () => void;
  onNotify: () => void;
}) {
  const t = useT();
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const startsAt = at(date, start);
  const live = startsAt.getTime() <= now.getTime();

  return (
    <View style={styles.heroWrap}>
      <View style={styles.hero}>
        <AngledGradient colors={[color.heroFrom, color.heroTo]} angle={150} />
        <Ring
          size={190}
          width={26}
          tint="rgba(255,255,255,0.09)"
          style={{ right: -50, top: -60 }}
        />

        <View style={styles.heroTopRow}>
          <View style={styles.heroEyebrowRow}>
            <View style={styles.heroDot} />
            <Text style={styles.heroEyebrow}>
              {live ? t('time.now') : `${t('groups.upNext')} · ${countdownTo(startsAt, now)}`}
            </Text>
          </View>
          <Text style={styles.heroRoom}>{roomLabel(group.room, t)}</Text>
        </View>

        <View style={styles.heroMidRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.heroTitle} numberOfLines={1}>
              {group.name}
            </Text>
            <Text style={styles.heroMeta}>
              {group.subject} · {t('students.count', { count: studentCount })}
            </Text>
          </View>
          <Text style={styles.heroClock}>{start}</Text>
        </View>

        <View style={styles.heroActions}>
          <Press onPress={onAttendance} style={styles.heroPrimary}>
            <Icon name="check" size={15} color={color.heroActionInk} />
            <Text style={styles.heroPrimaryLabel}>{t('home.attendance')}</Text>
          </Press>
          <Press onPress={onNotify} style={styles.heroSecondary}>
            <Icon name="chat" size={16} color="#fff" strokeWidth={1.6} />
            <Text style={styles.heroSecondaryLabel}>{t('home.notify')}</Text>
          </Press>
        </View>
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

function GroupRow({
  group,
  count,
  now,
  onPress,
}: {
  group: Group;
  count: number;
  now: Date;
  onPress: () => void;
}) {
  const { accents, color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const a = accents[group.accent];
  const next = nextSessionForGroup(group, now);
  const slot = next ? relativeSlot(at(next.date, next.start), now) : null;


  return (
    <Press onPress={onPress} style={styles.groupRow}>
      <View style={[styles.countTile, { backgroundColor: a.tint }]}>
        <Text style={[styles.countValue, { color: a.ink }]}>{count}</Text>
        <Text style={[styles.countLabel, { color: a.sub }]}>stud</Text>
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[text.rowTitle, styles.ink]} numberOfLines={1}>
          {group.name}
        </Text>
        <View style={styles.groupMetaRow}>
          <Txt style={styles.groupMeta}>{group.subject}</Txt>
          {slot ? (
            <>
              <Text style={styles.dotSep}>·</Text>
              <Text
                style={[
                  styles.groupMeta,
                  slot.imminent && {
                    color: color.primary,
                    fontFamily: body[700],
                  },
                ]}>
                {slot.label}
              </Text>
            </>
          ) : null}
        </View>
      </View>

      {/*
        No call or message button here. A group has no phone number — the call
        dialled whichever student happened to be first in the roster, which is
        nobody's intent — and the message button only repeated what tapping the
        card already does. Messaging a whole group lives inside the group.
      */}
      <Icon name="disclosure" size={16} color={color.chevron} />
    </Press>
  );
}

function MatchedStudent({ student, onPress }: { student: Student; onPress: () => void }) {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Press onPress={onPress}>
      <Card style={styles.matchedCard}>
        <Avatar name={student.name} accent={student.accent} size={34} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.matchedName} numberOfLines={1}>
            {student.name}
          </Text>
        </View>
        <IconButton
          name="chat"
          size={30}
          iconSize={14}
          radius={radius.md}
          tint={color.bg}
          fg={color.inkSoft}
          onPress={() => smsNumber(student.phone)}
        />
      </Card>
    </Press>
  );
}

const makeStyles = ({ color, shadow }: Theme) =>
  StyleSheet.create({
    /** Default body ink. Text does not inherit colour from a parent View. */
    ink: { color: color.ink },
    teacherAvatar: {
      width: 46,
      height: 46,
      borderRadius: radius.tile,
      backgroundColor: color.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    teacherInitials: { fontFamily: display[600], fontSize: 15, color: '#fff' },

    searchWrap: { paddingHorizontal: space.gutter, paddingBottom: 18 },
    search: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      height: 46,
      paddingHorizontal: 14,
      borderRadius: radius.field,
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: color.border,
    },
    searchInput: {
      flex: 1,
      minWidth: 0,
      fontFamily: body[400],
      fontSize: 15,
      color: color.ink,
      padding: 0,
    },

    heroWrap: { paddingHorizontal: space.gutter, paddingBottom: 24 },
    hero: {
      overflow: 'hidden',
      borderRadius: radius.hero,
      paddingHorizontal: 20,
      paddingVertical: 18,
      backgroundColor: color.primary,
    },
    heroTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 14,
    },
    heroEyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    heroDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: color.mint,
    },
    heroEyebrow: {
      fontFamily: body[700],
      fontSize: 11,
      letterSpacing: 1.32,
      textTransform: 'uppercase',
      color: 'rgba(255,255,255,0.82)',
    },
    heroRoom: {
      fontFamily: body[600],
      fontSize: 12,
      color: 'rgba(255,255,255,0.8)',
    },
    heroMidRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 14,
      marginTop: 14,
    },
    heroTitle: { ...text.heroCardTitle, color: '#fff' },
    heroMeta: {
      fontFamily: body[400],
      fontSize: 13.5,
      color: 'rgba(255,255,255,0.72)',
      marginTop: 5,
    },
    heroClock: { ...text.clock, color: '#fff' },
    heroActions: { flexDirection: 'row', gap: 9, marginTop: 18 },
    heroPrimary: {
      flex: 1,
      height: 46,
      borderRadius: radius.field,
      backgroundColor: color.heroActionBg,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    heroPrimaryLabel: {
      fontFamily: body[700],
      fontSize: 14.5,
      color: color.heroActionInk,
    },
    heroSecondary: {
      flex: 1,
      height: 46,
      borderRadius: radius.field,
      backgroundColor: 'rgba(255,255,255,0.16)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.22)',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    heroSecondaryLabel: {
      fontFamily: body[600],
      fontSize: 14.5,
      color: '#fff',
    },

    sectionHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: space.gutter,
      paddingBottom: 12,
    },
    sectionCount: {
      fontFamily: body[600],
      fontSize: 12.5,
      color: color.muted,
      ...text.tabular,
    },

    list: { gap: 10, paddingHorizontal: space.gutter },
    groupRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 13,
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: color.border,
      borderRadius: radius.card,
      paddingVertical: 13,
      paddingLeft: 15,
      paddingRight: 13,
    },
    countTile: {
      width: 44,
      height: 44,
      borderRadius: radius.field,
      alignItems: 'center',
      justifyContent: 'center',
    },
    countValue: { fontFamily: display[600], fontSize: 17, lineHeight: 18 },
    countLabel: {
      fontFamily: body[700],
      fontSize: 8.5,
      letterSpacing: 0.68,
      textTransform: 'uppercase',
      marginTop: 2,
    },
    groupMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 5,
    },
    groupMeta: { fontFamily: body[400], fontSize: 12.5, color: color.muted },
    dotSep: { color: color.dashed, fontSize: 12.5 },
    groupActions: { flexDirection: 'row', gap: 7 },

    newGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      height: 50,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: color.dashed,
      borderRadius: radius.card,
    },
    newGroupLabel: {
      fontFamily: body[600],
      fontSize: 14.5,
      color: color.muted,
    },

    matchedWrap: { paddingHorizontal: space.gutter, paddingTop: 24 },
    matchedLabel: {
      fontFamily: body[700],
      fontSize: 11.5,
      letterSpacing: 1.38,
      textTransform: 'uppercase',
      color: color.mutedLight,
      marginBottom: 10,
    },
    matchedRow: { gap: 8 },
    matchedCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 10,
      borderRadius: radius.tile,
    },
    matchedName: { fontFamily: body[700], fontSize: 14.5, color: color.ink },

    fab: {
      position: 'absolute',
      right: 18,
      width: 54,
      height: 54,
      borderRadius: radius.fab,
      backgroundColor: color.primary,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadow.fab,
    },
  });

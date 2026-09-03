import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AngledGradient, Ring } from '@/components/decor';
import { Icon } from '@/components/Icon';
import { PageHeading, Screen, useTabInset } from '@/components/layout';
import { SyncPill } from '@/components/SyncPill';
import { Avatar, Card, EmptyState, IconButton, initialsOf, Press, Txt } from '@/components/ui';
import { useGroups, useStore, useStudents, useTerms } from '@/data/store';
import type { Group, Student } from '@/data/types';
import type { TranslationKey } from '@/i18n';
import { confirm } from '@/components/Dialog';
import { useT } from '@/i18n/useT';
import { smsNumber } from '@/lib/contact';
import { at, countdownTo, longDate, relativeSlot } from '@/lib/date';
import { nextSessionForGroup, nextSessionOverall, roomLabel } from '@/lib/schedule';
import { compareTerms, termLabel, termOfGroup } from '@/lib/term';
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

  /*
    The list, in terms.

    A tutor who has been running this app for a while has thirty groups, and a
    flat list of thirty is a list nobody reads to the bottom of. They do not
    think of them as thirty either: they think "the autumn lot" and "the spring
    lot", which is what a term is. So the terms are the list, and the groups
    live inside them.

    Newest term first, and only the newest is open to begin with — the courses
    running now are the ones the teacher came here for, and the older terms are
    a tap away rather than a scroll away.
  */
  const allTerms = useTerms();

  const termed = useMemo(() => {
    const buckets = new Map<string, Group[]>();

    /*
      Seeded with every term that exists, so one holding no courses still shows.

      That is the whole point of a term being a thing a teacher makes: they set
      up the autumn intake in August and fill it in over the following week, and
      a term that vanished until its first course was in it would make the
      button they just pressed look broken.

      Not while searching, though. A search is a question about courses, and
      answering it with a column of empty seasons buries the matches.
    */
    if (!q) for (const term of allTerms) buckets.set(term, []);

    for (const g of shown) {
      const key = termOfGroup(g);
      const list = buckets.get(key);
      if (list) list.push(g);
      else buckets.set(key, [g]);
    }
    return [...buckets.entries()]
      .sort((a, b) => compareTerms(b[0], a[0]))
      .map(([term, list]) => ({ term, groups: list }));
  }, [shown, allTerms, q]);

  const [openTerms, setOpenTerms] = useState<Record<string, boolean>>({});

  const archiveTerm = useStore((s) => s.archiveTerm);
  const deleteTerm = useStore((s) => s.deleteTerm);
  // Only a term the teacher declared can be undeclared. One that exists because
  // a course carries its key is not theirs to remove; the course is.
  const declared = useStore((s) => s.terms);

  /*
    Archiving a whole term, from the term's own header.

    This is the action the request was really about: a term ends and every
    course in it is finished at once, and doing that group by group through
    twelve confirmations is how a teacher decides to just delete them instead.
  */
  const askArchiveTerm = async (term: string, count: number) => {
    const ok = await confirm({
      title: t('archive.termTitle', { term: termLabel(term, t) }),
      message: t('archive.termBody', { count }),
      confirmLabel: t('archive.archiveTerm'),
      tone: 'info',
    });
    if (ok) archiveTerm(term);
  };

  /*
    Removing an empty term, which is not a delete of anything.

    Offered only where there is nothing in it, because on a term with courses
    the word would promise something it does not do: the groups keep their own
    `term` and the term goes on being listed because of them. A button that
    appears to delete twelve courses and changes nothing is worse than no
    button.
  */
  const askDeleteTerm = async (term: string) => {
    const ok = await confirm({
      title: t('term.deleteTitle', { term: termLabel(term, t) }),
      message: t('term.deleteBody'),
      confirmLabel: t('term.delete'),
    });
    if (ok) deleteTerm(term);
  };

  /*
    Open by default, and only the first.

    Held as overrides rather than as the state itself, so a term that appears
    later — a group moved into it, a search that surfaces an older one — does
    not need seeding, and a teacher's tap is remembered for exactly as long as
    the screen is.
  */
  const isOpen = (term: string, index: number) =>
    openTerms[term] ?? (index === 0 || Boolean(q));

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
          style={{ paddingBottom: 10 }}
        />

        {/*
          Directly under the greeting, above everything the teacher came here to
          do. Sync state is not worth a screen of its own and it is not worth
          hunting for in Profile — it belongs where the eye already lands.
        */}
        <SyncPill style={styles.syncPill} />

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
              ? t('home.activeCount', { count: groups.length })
              : t('home.shownOf', { count: shown.length, total: groups.length })}
          </Text>
        </View>

        <View style={styles.list}>
          {termed.map(({ term, groups: inTerm }, i) => {
            const open = isOpen(term, i);
            return (
              <View key={term} style={styles.termBlock}>
                <Press
                  onPress={() => setOpenTerms((o) => ({ ...o, [term]: !open }))}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  style={styles.termHead}>
                  <Icon
                    name="disclosure"
                    size={15}
                    color={color.chevron}
                    // The chevron points along the direction the tap goes: right
                    // for "there is more in here", down for "it is open".
                    style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}
                  />
                  <Text style={[styles.termName, open && { color: color.ink }]}>
                    {termLabel(term, t)}
                  </Text>
                  <Text style={styles.termCount}>{inTerm.length}</Text>
                </Press>

                {/*
                  Only on the open term, and only below the fold of the header.
                  A row of archive buttons down a closed list is an invitation
                  to file away the term you are teaching.
                */}
                {open ? (
                  <View style={styles.termActions}>
                    {/*
                      Adding a course from the term it belongs to, which is the
                      order a teacher plans in: the intake first, then what is
                      being taught in it. The term travels with the tap, so the
                      form opens on it and the start date cannot quietly move
                      the course somewhere else.
                    */}
                    <Press
                      onPress={() =>
                        router.push({ pathname: '/group/new', params: { term } })
                      }
                      style={styles.termAction}>
                      <Icon name="plus" size={13} color={color.primary} strokeWidth={2.2} />
                      <Text style={[styles.termActionLabel, { color: color.primary }]}>
                        {t('groups.new')}
                      </Text>
                    </Press>

                    {inTerm.length ? (
                      <Press
                        onPress={() => void askArchiveTerm(term, inTerm.length)}
                        style={styles.termAction}>
                        <Icon name="archive" size={13} color={color.mutedLight} />
                        <Text style={styles.termActionLabel}>{t('archive.archiveTerm')}</Text>
                      </Press>
                    ) : declared.includes(term) ? (
                      <Press onPress={() => void askDeleteTerm(term)} style={styles.termAction}>
                        <Icon name="close" size={13} color={color.mutedLight} />
                        <Text style={styles.termActionLabel}>{t('term.delete')}</Text>
                      </Press>
                    ) : null}
                  </View>
                ) : null}

                {open && !inTerm.length ? (
                  <Text style={styles.termEmpty}>{t('term.empty')}</Text>
                ) : null}

                {open
                  ? inTerm.map((g) => (
                      <GroupRow
                        key={g.id}
                        group={g}
                        count={students.filter((s) => s.groupIds.includes(g.id)).length}
                        now={now}
                        onPress={() => router.push(`/group/${g.id}`)}
                      />
                    ))
                  : null}
              </View>
            );
          })}

          {shown.length === 0 ? (
            <EmptyState title={t('home.noMatches')} hint={t('home.tryAnother')} />
          ) : null}

          <Press onPress={() => router.push('/term/new')} style={styles.newGroup}>
            <Icon name="plus" size={16} color={color.muted} />
            <Text style={styles.newGroupLabel}>{t('term.new')}</Text>
          </Press>

          {/*
            Still here, and still second.

            A course made this way lands in whichever term its start date says,
            which is what it has always done and is right for a tutor adding a
            class in the middle of a week. Making it from inside a term is the
            deliberate version, and it is the one at the top of each term.
          */}
          <Press onPress={() => router.push('/group/new')} style={styles.newGroup}>
            <Icon name="plus" size={16} color={color.muted} />
            <Text style={styles.newGroupLabel}>{t('groups.new')}</Text>
          </Press>
        </View>

        {q && matchedStudents.length > 0 ? (
          <View style={styles.matchedWrap}>
            <Text style={styles.matchedLabel}>
              {t('home.matching', { count: matchedStudents.length })}{' '}
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
        <Avatar name={student.name} accent={student.accent} photoId={student.id} size={34} />
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

    syncPill: { marginLeft: space.gutter - 6, marginBottom: 12 },
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

    /*
      A header, not a button.

      It is the whole width and it is tappable, but it is drawn flat: chips and
      borders here would compete with the group cards underneath, which are the
      thing being looked for. The count on the right is what makes a closed term
      worth reading at all.
    */
    termHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 9,
    },
    // The outer list's gap falls between terms; this one falls between the
    // header and its groups, which are now siblings inside a term rather than
    // children of the list.
    termBlock: { gap: 10 },
    // Two small controls now rather than one, so they share a row and wrap on a
    // narrow screen instead of pushing each other off it.
    termActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: -2 },
    termAction: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 5,
      paddingHorizontal: 9,
      borderRadius: radius.xs + 2,
      backgroundColor: color.bg,
      borderWidth: 1,
      borderColor: color.border,
    },
    termActionLabel: { fontFamily: body[600], fontSize: 11.5, color: color.muted },
    termEmpty: {
      fontFamily: body[400],
      fontSize: 12.5,
      color: color.mutedLight,
      paddingVertical: 2,
    },
    termName: {
      flex: 1,
      fontFamily: body[700],
      fontSize: 13.5,
      color: color.inkSoft,
    },
    termCount: {
      fontFamily: body[600],
      fontSize: 12,
      color: color.mutedLight,
      // Sits over the card edge below it, so the number lines up with the
      // group rows rather than floating past them.
      marginRight: 2,
    },
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

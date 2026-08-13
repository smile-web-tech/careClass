import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Screen, useTabInset } from '@/components/layout';
import type { TranslationKey } from '@/i18n';
import { useT } from '@/i18n/useT';
import { EmptyState, IconButton, Press } from '@/components/ui';
import { useEvents, useGroups, useStudents } from '@/data/store';
import type { CalendarEvent, Group, Session } from '@/data/types';
import {
  addDays,
  dowLong,
  dowShort,
  fromKey,
  isSameDay,
  isSameMonth,
  monthLong,
  monthMatrix,
  monthShort,
  startOfWeek,
  toKey,
  weekDays,
} from '@/lib/date';
import { sessionPhase, sessionsOn, roomLabel } from '@/lib/schedule';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, display, text } from '@/theme/type';

/**
 * Where a class is in its day, as a colour and a word.
 *
 * The word is a key rather than the word itself: these four were written in
 * English and stayed English in every language, so a Turkmen teacher read
 * "Done" and "Now" on an otherwise translated screen.
 */
const phaseBadge = ({ color, status }: Theme) =>
  ({
    done: { label: 'calendar.phaseDone', bg: status.present.tint, fg: status.present.ink },
    live: { label: 'calendar.phaseLive', bg: status.present.tint, fg: status.present.ink },
    next: { label: 'calendar.phaseNext', bg: color.primaryTint, fg: color.primaryInk },
    later: { label: 'calendar.phaseLater', bg: color.fill, fg: color.muted },
  }) as const satisfies Record<string, { label: TranslationKey; bg: string; fg: string }>;

/** Height of one row of day cells. The grid animates between 1 and 6 of these. */
const ROW_H = 62;
const ROWS = 6;

/** A class session or a personal event, ordered together on the day timeline. */
type Entry =
  | { kind: 'session'; at: string; session: Session; group: Group }
  | { kind: 'event'; at: string; event: CalendarEvent }
  | { kind: 'birthday'; at: string; name: string; studentId: string };

export default function Calendar() {
  const t = useT();
  const { accents, color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const bottomInset = useTabInset(20);
  const router = useRouter();

  const groups = useGroups();
  const students = useStudents();
  const events = useEvents();

  const today = useMemo(() => new Date(), []);
  const [selected, setSelected] = useState(today);
  const [monthMode, setMonthMode] = useState(false);

  /* -------- the grid ------------------------------------------------- */

  // Always the full month matrix. Collapsed, it is clipped to the row holding
  // the selected day; expanded, all six rows show. Same nodes either way, so
  // the transition is a genuine unfold rather than a swap.
  const matrix = useMemo(() => monthMatrix(selected), [selected]);
  const selectedRow = useMemo(() => {
    const wk = toKey(startOfWeek(selected));
    const i = matrix.findIndex((row) => toKey(row[0]) === wk);
    return i < 0 ? 0 : i;
  }, [matrix, selected]);

  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(monthMode ? 1 : 0, { duration: 240 });
  }, [monthMode, progress]);

  const gridStyle = useAnimatedStyle(() => ({
    height: ROW_H + (ROWS - 1) * ROW_H * progress.value,
  }));
  const innerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -selectedRow * ROW_H * (1 - progress.value) }],
  }));

  // Drag the strip down to open the month, up to close it. A tap on the
  // grabber does the same, so the gesture is discoverable rather than hidden.
  const pan = Gesture.Pan()
    .activeOffsetY([-12, 12])
    .onEnd((e) => {
      if (e.translationY > 20) runOnJS(setMonthMode)(true);
      else if (e.translationY < -20) runOnJS(setMonthMode)(false);
    });

  /* -------- data ----------------------------------------------------- */

  const sessionsByDay = useMemo(() => {
    const out: Record<string, Session[]> = {};
    for (const row of matrix) {
      for (const d of row) out[toKey(d)] = sessionsOn(groups, d);
    }
    return out;
  }, [matrix, groups]);

  const eventsByDay = useMemo(() => {
    const out: Record<string, CalendarEvent[]> = {};
    for (const e of events) (out[e.date] ??= []).push(e);
    return out;
  }, [events]);

  /**
   * Birthdays, derived rather than stored.
   *
   * A birthday is not an event the teacher created; it is a fact about a
   * student that recurs. Writing one row per student per year would mean
   * hundreds of rows to keep in step with a date the teacher can edit at any
   * time — and a stale one after they correct a typo. Deriving from the roster
   * costs a loop over the visible month and is always right.
   */
  const birthdaysByDay = useMemo(() => {
    const out: Record<string, { name: string; studentId: string }[]> = {};

    for (const student of students) {
      if (!student.birthDate) continue;
      const born = fromKey(student.birthDate);
      if (Number.isNaN(born.getTime())) continue;

      for (const row of matrix) {
        for (const day of row) {
          if (day.getMonth() !== born.getMonth() || day.getDate() !== born.getDate()) continue;
          // The age is deliberately not worked out. It is the teacher's business
          // how they mark the day, and an app that announces a number gets it
          // wrong the moment a birth year was typed to fill a required field.
          (out[toKey(day)] ??= []).push({ name: student.name, studentId: student.id });
        }
      }
    }
    return out;
  }, [students, matrix]);

  const selectedKey = toKey(selected);

  /** Sessions and events for the selected day, in time order; all-day first. */
  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = [];
    for (const s of sessionsByDay[selectedKey] ?? []) {
      const g = groups.find((x) => x.id === s.groupId);
      if (g) list.push({ kind: 'session', at: s.start, session: s, group: g });
    }
    for (const e of eventsByDay[selectedKey] ?? []) {
      list.push({ kind: 'event', at: e.allDay ? '' : (e.start ?? ''), event: e });
    }
    // All-day, so they sort to the top alongside all-day events.
    for (const b of birthdaysByDay[selectedKey] ?? []) {
      list.push({ kind: 'birthday', at: '', name: b.name, studentId: b.studentId });
    }
    return list.sort((a, b) => a.at.localeCompare(b.at));
  }, [sessionsByDay, eventsByDay, birthdaysByDay, selectedKey, groups]);

  const weekTotal = weekDays(selected).reduce(
    (n, d) => n + (sessionsByDay[toKey(d)]?.length ?? 0),
    0,
  );

  const heading = monthMode
    ? `${monthLong(selected)} ${selected.getFullYear()}`
    : (() => {
        const days = weekDays(selected);
        const [a, b] = [days[0], days[6]];
        return a.getMonth() === b.getMonth()
          ? `${monthLong(a)} ${a.getFullYear()}`
          : `${monthShort(a)} – ${monthShort(b)} ${b.getFullYear()}`;
      })();

  const step = (n: number) => setSelected((d) => addDays(d, monthMode ? n * 28 : n * 7));

  return (
    <Screen>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[text.pageTitle, styles.ink]}>{heading}</Text>
            <Text style={styles.weekSummary}>
              {monthMode
                ? t('calendar.dragCollapse')
                : `${weekTotal} session${weekTotal === 1 ? '' : 's'} this week`}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <IconButton
              name="chevronLeft"
              iconSize={17}
              fg={color.inkSoft}
              onPress={() => step(-1)}
            />
            <IconButton
              name="chevronRight"
              iconSize={17}
              fg={color.inkSoft}
              onPress={() => step(1)}
            />
          </View>
        </View>

        <GestureDetector gesture={pan}>
          <View>
            <View style={styles.dowRow}>
              {matrix[0].map((d) => (
                <Text key={toKey(d)} style={styles.dowLabel}>
                  {dowShort(d)}
                </Text>
              ))}
            </View>

            <Animated.View style={[styles.gridClip, gridStyle]}>
              <Animated.View style={innerStyle}>
                {matrix.map((row) => (
                  <View key={toKey(row[0])} style={styles.gridRow}>
                    {row.map((d) => {
                      const key = toKey(d);
                      const on = isSameDay(d, selected);
                      const isToday = isSameDay(d, today);
                      const outside = monthMode && !isSameMonth(d, selected);
                      const marks = [
                        ...(sessionsByDay[key] ?? []).map((s) => {
                          const g = groups.find((x) => x.id === s.groupId);
                          return g ? accents[g.accent].dot : color.dashed;
                        }),
                        ...(eventsByDay[key] ?? []).map((e) => accents[e.accent].dot),
                      ].slice(0, 3);

                      return (
                        <Press
                          key={key}
                          haptic
                          onPress={() => setSelected(d)}
                          accessibilityLabel={`${dowLong(d)} ${d.getDate()}`}
                          accessibilityState={{ selected: on }}
                          style={[styles.day, on && { backgroundColor: color.primary }]}>
                          <Text
                            style={[
                              styles.dayNum,
                              {
                                color: on ? '#fff' : color.inkSoft,
                                opacity: outside ? 0.35 : 1,
                              },
                            ]}>
                            {d.getDate()}
                          </Text>
                          <View style={styles.dotRow}>
                            {marks.map((tint, i) => (
                              <View
                                key={i}
                                style={[
                                  styles.dot,
                                  { backgroundColor: on ? 'rgba(255,255,255,0.85)' : tint },
                                ]}
                              />
                            ))}
                          </View>
                          {isToday && !on ? <View style={styles.todayUnderline} /> : null}
                        </Press>
                      );
                    })}
                  </View>
                ))}
              </Animated.View>
            </Animated.View>

            {/* Tap target as well as a visual affordance — a gesture nobody
                can see is a gesture nobody uses. */}
            <Press
              onPress={() => setMonthMode((v) => !v)}
              style={styles.grabberHit}
              accessibilityRole="button"
              accessibilityLabel={monthMode ? 'Collapse to week' : 'Expand to month'}>
              <View style={styles.grabber} />
            </Press>
          </View>
        </GestureDetector>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingTop: 18,
          paddingBottom: bottomInset + 72,
        }}
        showsVerticalScrollIndicator={false}>
        <View style={styles.dayHead}>
          <Text style={[text.section, styles.ink]}>
            {isSameDay(selected, today)
              ? `Today · ${dowLong(selected)} ${selected.getDate()}`
              : `${dowLong(selected)} ${selected.getDate()}`}
          </Text>
          <Text style={styles.dayCount}>
            {entries.length ? `${entries.length} item${entries.length === 1 ? '' : 's'}` : ''}
          </Text>
        </View>

        {entries.length === 0 ? (
          <EmptyState title={t('calendar.nothingToday')} hint={t('calendar.addYourOwn')} />
        ) : (
          entries.map((entry, i) =>
            entry.kind === 'session' ? (
              <TimelineRow
                key={`s-${entry.session.groupId}-${entry.session.start}`}
                session={entry.session}
                group={entry.group}
                count={students.filter((x) => x.groupIds.includes(entry.group.id)).length}
                last={i === entries.length - 1}
                onAttendance={() =>
                  router.push({
                    pathname: '/attendance',
                    params: {
                      group: entry.group.id,
                      date: entry.session.date,
                      start: entry.session.start,
                    },
                  })
                }
                onNotify={() =>
                  router.push({ pathname: '/compose', params: { group: entry.group.id } })
                }
                onOpen={() => router.push(`/group/${entry.group.id}`)}
              />
            ) : entry.kind === 'event' ? (
              <EventRow
                key={`e-${entry.event.id}`}
                event={entry.event}
                last={i === entries.length - 1}
                onOpen={() => router.push(`/event/new?id=${entry.event.id}`)}
              />
            ) : (
              <BirthdayRow
                key={`b-${entry.studentId}`}
                name={entry.name}
                last={i === entries.length - 1}
                onOpen={() => router.push(`/student/${entry.studentId}`)}
              />
            ),
          )
        )}
      </ScrollView>

      <Press
        haptic
        onPress={() => router.push(`/event/new?date=${selectedKey}`)}
        style={[styles.fab, { bottom: bottomInset + 12 }]}
        accessibilityRole="button"
        accessibilityLabel={t('calendar.addEvent')}>
        <Icon name="plusLarge" size={23} color="#fff" />
      </Press>
    </Screen>
  );
}

/** A personal calendar entry. Visually lighter than a class, and has no actions. */
function EventRow({
  event,
  last,
  onOpen,
}: {
  event: CalendarEvent;
  last: boolean;
  onOpen: () => void;
}) {
  const t = useT();
  const { accents } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const a = accents[event.accent];

  return (
    <View style={styles.timelineRow}>
      <View style={styles.timeCol}>
        {event.allDay ? (
          <Text style={styles.timeEnd}>{t('calendar.allDay')}</Text>
        ) : (
          <>
            <Text style={styles.timeStart}>{event.start}</Text>
            <Text style={styles.timeEnd}>{event.end}</Text>
          </>
        )}
      </View>

      <View style={styles.rail}>
        <View style={[styles.railDot, styles.railDotHollow, { borderColor: a.dot }]} />
        {!last ? <View style={styles.railLine} /> : null}
      </View>

      <View style={{ flex: 1, minWidth: 0, paddingBottom: 12 }}>
        <Press onPress={onOpen} style={[styles.eventCard, { borderLeftColor: a.dot }]}>
          <Text style={styles.sessionName} numberOfLines={1}>
            {event.title}
          </Text>
          {event.note ? (
            <Text style={styles.sessionMeta} numberOfLines={2}>
              {event.note}
            </Text>
          ) : null}
        </Press>
      </View>
    </View>
  );
}

function TimelineRow({
  session,
  group,
  count,
  last,
  onAttendance,
  onNotify,
  onOpen,
}: {
  session: Session;
  group: Group;
  count: number;
  last: boolean;
  onAttendance: () => void;
  onNotify: () => void;
  onOpen: () => void;
}) {
  const t = useT();
  const theme = useTheme();
  const { accents, color } = theme;
  const styles = useThemedStyles(makeStyles);
  const a = accents[group.accent];
  const badge = phaseBadge(theme)[sessionPhase(session)];

  return (
    <View style={styles.timelineRow}>
      <View style={styles.timeCol}>
        <Text style={styles.timeStart}>{session.start}</Text>
        <Text style={styles.timeEnd}>{session.end}</Text>
      </View>

      <View style={styles.rail}>
        <View style={[styles.railDot, { backgroundColor: a.dot }]} />
        {!last ? <View style={styles.railLine} /> : null}
      </View>

      <View style={{ flex: 1, minWidth: 0, paddingBottom: 12 }}>
        <Press onPress={onOpen} style={[styles.sessionCard, { borderLeftColor: a.dot }]}>
          <View style={styles.sessionHead}>
            <Text style={styles.sessionName} numberOfLines={1}>
              {group.name}
            </Text>
            <View style={[styles.badge, { backgroundColor: badge.bg }]}>
              <Text style={[styles.badgeLabel, { color: badge.fg }]}>{t(badge.label)}</Text>
            </View>
          </View>
          <Text style={styles.sessionMeta}>
            {group.subject} · {t('students.count', { count })} · {roomLabel(group.room, t)}
          </Text>
          <View style={styles.sessionActions}>
            <Press onPress={onAttendance} style={styles.sessionAction}>
              <Icon name="check" size={14} color={color.inkSoft} />
              <Text style={styles.sessionActionLabel}>{t('home.attendance')}</Text>
            </Press>
            <Press onPress={onNotify} style={styles.sessionAction}>
              <Icon name="chat" size={14} color={color.inkSoft} />
              <Text style={styles.sessionActionLabel}>{t('home.notify')}</Text>
            </Press>
          </View>
        </Press>
      </View>
    </View>
  );
}

/**
 * A birthday on the day's timeline.
 *
 * Deliberately quieter than a class and than an event the teacher created: it
 * is something to know rather than something to do, and it should not compete
 * with the lesson happening at four.
 */
function BirthdayRow({
  name,
  last,
  onOpen,
}: {
  name: string;
  last: boolean;
  onOpen: () => void;
}) {
  const t = useT();
  const { accents } = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <Press onPress={onOpen} style={[styles.birthdayRow, last && { marginBottom: 6 }]}>
      <View style={[styles.birthdayGlyph, { backgroundColor: accents.pink.tint }]}>
        <Icon name="cake" size={15} color={accents.pink.ink} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.birthdayName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.birthdayNote}>{t('calendar.birthdayOf', { name })}</Text>
      </View>
    </Press>
  );
}

const makeStyles = ({ color, shadow }: Theme) =>
  StyleSheet.create({
    /** Default body ink. Text does not inherit colour from a parent View. */
    ink: { color: color.ink },
    header: {
      backgroundColor: color.surface,
      borderBottomWidth: 1,
      borderBottomColor: color.border,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: space.gutter,
      paddingBottom: 16,
    },
    weekSummary: {
      fontFamily: body[400],
      fontSize: 12.5,
      color: color.mutedLight,
      marginTop: 3,
    },

    dowRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingBottom: 6 },
    dowLabel: {
      flex: 1,
      textAlign: 'center',
      fontFamily: body[700],
      fontSize: 10.5,
      letterSpacing: 0.63,
      textTransform: 'uppercase',
      color: color.mutedLight,
    },

    gridClip: { overflow: 'hidden', paddingHorizontal: 16 },
    gridRow: { flexDirection: 'row', gap: 6, height: ROW_H },
    day: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      borderRadius: radius.button,
    },
    dayNum: { fontFamily: display[600], fontSize: 17, ...text.tabular },
    dotRow: { flexDirection: 'row', gap: 3, height: 5 },
    dot: { width: 5, height: 5, borderRadius: 2.5 },
    todayUnderline: {
      position: 'absolute',
      bottom: 8,
      width: 14,
      height: 2,
      borderRadius: 1,
      backgroundColor: color.primary,
    },

    grabberHit: { alignItems: 'center', paddingTop: 4, paddingBottom: 10 },
    grabber: { width: 38, height: 4, borderRadius: 2, backgroundColor: color.dashed },

    dayHead: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginBottom: 14,
    },
    dayCount: {
      fontFamily: body[600],
      fontSize: 12.5,
      color: color.mutedLight,
    },

    timelineRow: { flexDirection: 'row', gap: 14 },
    timeCol: { width: 52, paddingTop: 14, alignItems: 'flex-end' },
    timeStart: {
      fontFamily: display[600],
      fontSize: 14,
      color: color.ink,
      ...text.tabular,
    },
    timeEnd: {
      fontFamily: body[400],
      fontSize: 11.5,
      color: color.faint,
      marginTop: 2,
      ...text.tabular,
    },

    rail: { width: 12, alignItems: 'center' },
    railDot: { width: 10, height: 10, borderRadius: 5, marginTop: 18 },
    // Hollow marks a personal entry, so a glance separates it from a class.
    railDotHollow: { backgroundColor: 'transparent', borderWidth: 2.5 },
    railLine: { flex: 1, width: 2, backgroundColor: color.border },

    sessionCard: {
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: color.border,
      borderLeftWidth: 4,
      borderRadius: radius.button,
      paddingHorizontal: 14,
      paddingVertical: 13,
    },
    eventCard: {
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: color.border,
      borderLeftWidth: 4,
      borderRadius: radius.button,
      paddingHorizontal: 14,
      paddingVertical: 13,
    },
    sessionHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    sessionName: {
      flex: 1,
      fontFamily: body[700],
      fontSize: 15.5,
      letterSpacing: -0.23,
      color: color.ink,
    },
    badge: {
      paddingHorizontal: 7,
      paddingVertical: 4,
      borderRadius: radius.sm - 1,
    },
    badgeLabel: {
      fontFamily: body[700],
      fontSize: 11,
      letterSpacing: 0.66,
      textTransform: 'uppercase',
    },
    sessionMeta: {
      fontFamily: body[400],
      fontSize: 12.5,
      color: color.muted,
      marginTop: 5,
    },
    sessionActions: { flexDirection: 'row', gap: 7, marginTop: 11 },
    sessionAction: {
      flex: 1,
      height: 38,
      borderRadius: radius.lg,
      backgroundColor: color.fill,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
    },
    sessionActionLabel: {
      fontFamily: body[600],
      fontSize: 12.5,
      color: color.inkSoft,
    },

    birthdayRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 4,
    },
    birthdayGlyph: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
    },
    birthdayName: { fontFamily: body[700], fontSize: 14.5, color: color.ink },
    birthdayNote: { fontFamily: body[400], fontSize: 12.5, color: color.mutedLight, marginTop: 2 },

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

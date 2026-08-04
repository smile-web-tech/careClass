import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Screen, useTabInset } from '@/components/layout';
import { EmptyState, IconButton, Press } from '@/components/ui';
import { useGroups, useStudents } from '@/data/store';
import type { Group, Session } from '@/data/types';
import {
  addDays,
  dowLong,
  dowShort,
  isSameDay,
  monthLong,
  monthShort,
  toKey,
  weekDays,
} from '@/lib/date';
import { sessionPhase, sessionsOn } from '@/lib/schedule';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, display, text } from '@/theme/type';

const phaseBadge = ({ color, status }: Theme) =>
  ({
    done: { label: 'Done', bg: status.present.tint, fg: status.present.ink },
    live: { label: 'Now', bg: status.present.tint, fg: status.present.ink },
    next: { label: 'Next', bg: color.primaryTint, fg: color.primaryInk },
    later: { label: 'Later', bg: color.fill, fg: color.muted },
  }) as const;

export default function Calendar() {
  const { accents, color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const bottomInset = useTabInset(20);
  const router = useRouter();

  const groups = useGroups();
  const students = useStudents();

  const today = useMemo(() => new Date(), []);
  const [selected, setSelected] = useState(today);

  const days = useMemo(() => weekDays(selected), [selected]);
  const perDay = useMemo(
    () => Object.fromEntries(days.map((d) => [toKey(d), sessionsOn(groups, d)])),
    [days, groups],
  );
  const weekTotal = Object.values(perDay).reduce((n, s) => n + s.length, 0);
  const daySessions = perDay[toKey(selected)] ?? [];

  const first = days[0];
  const last = days[6];
  const heading =
    first.getMonth() === last.getMonth()
      ? `${monthLong(first)} ${first.getFullYear()}`
      : `${monthShort(first)} – ${monthShort(last)} ${last.getFullYear()}`;

  return (
    <Screen>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[text.pageTitle, styles.ink]}>{heading}</Text>
            <Text style={styles.weekSummary}>
              {weekTotal} session{weekTotal === 1 ? '' : 's'} this week
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <IconButton
              name="chevronLeft"
              iconSize={17}
              fg={color.inkSoft}
              onPress={() => setSelected((d) => addDays(d, -7))}
            />
            <IconButton
              name="chevronRight"
              iconSize={17}
              fg={color.inkSoft}
              onPress={() => setSelected((d) => addDays(d, 7))}
            />
          </View>
        </View>

        <View style={styles.weekStrip}>
          {days.map((d) => {
            const on = isSameDay(d, selected);
            const isToday = isSameDay(d, today);
            const dots = (perDay[toKey(d)] ?? []).slice(0, 3);
            return (
              <Press
                key={toKey(d)}
                haptic
                onPress={() => setSelected(d)}
                style={[styles.day, on && { backgroundColor: color.primary }]}>
                <Text
                  style={[
                    styles.dayName,
                    {
                      color: on ? '#fff' : color.inkSoft,
                      opacity: on ? 0.75 : 0.7,
                    },
                  ]}>
                  {dowShort(d)}
                </Text>
                <Text style={[styles.dayNum, { color: on ? '#fff' : color.inkSoft }]}>
                  {d.getDate()}
                </Text>
                <View style={styles.dotRow}>
                  {dots.map((s, i) => {
                    const g = groups.find((x) => x.id === s.groupId);
                    return (
                      <View
                        key={i}
                        style={[
                          styles.dot,
                          {
                            backgroundColor: on
                              ? 'rgba(255,255,255,0.85)'
                              : g
                                ? accents[g.accent].dot
                                : color.dashed,
                          },
                        ]}
                      />
                    );
                  })}
                </View>
                {isToday && !on ? <View style={styles.todayUnderline} /> : null}
              </Press>
            );
          })}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingTop: 18,
          paddingBottom: bottomInset,
        }}
        showsVerticalScrollIndicator={false}>
        <View style={styles.dayHead}>
          <Text style={[text.section, styles.ink]}>
            {isSameDay(selected, today)
              ? `Today · ${dowLong(selected)} ${selected.getDate()}`
              : `${dowLong(selected)} ${selected.getDate()}`}
          </Text>
          <Text style={styles.dayCount}>
            {daySessions.length
              ? `${daySessions.length} class${daySessions.length === 1 ? '' : 'es'}`
              : ''}
          </Text>
        </View>

        {daySessions.length === 0 ? (
          <EmptyState title="No classes" hint="Enjoy the day off" />
        ) : (
          daySessions.map((s, i) => {
            const g = groups.find((x) => x.id === s.groupId);
            if (!g) return null;
            return (
              <TimelineRow
                key={`${s.groupId}-${s.start}`}
                session={s}
                group={g}
                count={students.filter((x) => x.groupIds.includes(g.id)).length}
                last={i === daySessions.length - 1}
                onAttendance={() =>
                  router.push({
                    pathname: '/attendance',
                    params: { group: g.id, date: s.date, start: s.start },
                  })
                }
                onNotify={() => router.push({ pathname: '/compose', params: { group: g.id } })}
                onOpen={() => router.push(`/group/${g.id}`)}
              />
            );
          })
        )}
      </ScrollView>
    </Screen>
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
              <Text style={[styles.badgeLabel, { color: badge.fg }]}>{badge.label}</Text>
            </View>
          </View>
          <Text style={styles.sessionMeta}>
            {group.subject} · {count} students · {group.room}
          </Text>
          <View style={styles.sessionActions}>
            <Press onPress={onAttendance} style={styles.sessionAction}>
              <Icon name="check" size={14} color={color.inkSoft} />
              <Text style={styles.sessionActionLabel}>Attendance</Text>
            </Press>
            <Press onPress={onNotify} style={styles.sessionAction}>
              <Icon name="chat" size={14} color={color.inkSoft} />
              <Text style={styles.sessionActionLabel}>Notify</Text>
            </Press>
          </View>
        </Press>
      </View>
    </View>
  );
}

const makeStyles = ({ color }: Theme) =>
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

    weekStrip: {
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: 16,
      paddingBottom: 14,
    },
    day: {
      flex: 1,
      alignItems: 'center',
      gap: 6,
      paddingTop: 9,
      paddingBottom: 8,
      borderRadius: radius.button,
    },
    dayName: {
      fontFamily: body[700],
      fontSize: 10.5,
      letterSpacing: 0.63,
      textTransform: 'uppercase',
    },
    dayNum: { fontFamily: display[600], fontSize: 17, ...text.tabular },
    dotRow: { flexDirection: 'row', gap: 3, height: 5 },
    dot: { width: 5, height: 5, borderRadius: 2.5 },
    todayUnderline: {
      position: 'absolute',
      bottom: 3,
      width: 14,
      height: 2,
      borderRadius: 1,
      backgroundColor: color.primary,
    },

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
  });

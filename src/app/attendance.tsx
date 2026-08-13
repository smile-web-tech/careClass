import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FooterSummary, Screen, StickyFooter, TopBar } from '@/components/layout';
import { Avatar, Button, Press, Txt } from '@/components/ui';
import { attendanceFor, useGroup, useRoster, useStore } from '@/data/store';
import type { AttendanceRecord, Student } from '@/data/types';
import { at, shortDate, fromKey } from '@/lib/date';
import {
  radius,
  space,
  statusCycle,
  statusMeta,
  useTheme,
  useThemedStyles,
  type AttendanceStatus,
  type Theme,
} from '@/theme';
import { body, display, text } from '@/theme/type';
import type { TranslationKey } from '@/i18n';
import { useT } from '@/i18n/useT';

/** Attendance status labels live in the catalogue, not in the theme tokens. */
export const STATUS_KEY: Record<AttendanceStatus, TranslationKey> = {
  present: 'attendance.present',
  late: 'attendance.late',
  absent: 'attendance.absent',
};

const GRID_GAP = 12;
const COLUMNS = 3;

export default function Attendance() {
  const t = useT();
  const styles = useThemedStyles(makeStyles);
  const params = useLocalSearchParams<{
    group: string;
    date: string;
    start: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const group = useGroup(params.group);
  const roster = useRoster(params.group);
  const saved = useStore((s) => s.attendance);
  const saveAttendance = useStore((s) => s.saveAttendance);

  const key = `${params.group}@${params.date}#${params.start}`;
  const sessionEnd = useMemo(() => {
    const slot = group?.slots.find((s) => s.start === params.start);
    return slot ? at(params.date, slot.end) : undefined;
  }, [group, params.date, params.start]);

  const [marks, setMarks] = useState<AttendanceRecord>(() =>
    attendanceFor(key, roster, saved, sessionEnd),
  );

  const counts = useMemo(() => {
    const c = { present: 0, late: 0, absent: 0 };
    for (const s of roster) c[marks[s.id] ?? 'present']++;
    return c;
  }, [marks, roster]);

  if (!group) {
    return (
      <Screen>
        <TopBar title={t('attendance.title')} />
        <Txt style={styles.missing}>{t('groups.gone')}</Txt>
      </Screen>
    );
  }

  const cellWidth = (width - space.gutter * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS;

  const cycle = (id: string) =>
    setMarks((m) => {
      const current = m[id] ?? 'present';
      const next = statusCycle[(statusCycle.indexOf(current) + 1) % statusCycle.length];
      return { ...m, [id]: next };
    });

  const markAllPresent = () => {
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    setMarks(Object.fromEntries(roster.map((s) => [s.id, 'present' as const])));
  };

  const save = () => {
    saveAttendance(key, marks);
    const absentees = roster.filter((s) => marks[s.id] === 'absent');
    if (absentees.length > 0) {
      // The parent notification is the whole point of the flow — take the
      // teacher straight to a pre-filled message rather than sending blind.
      router.replace({
        pathname: '/compose',
        params: {
          group: group.id,
          audience: 'parents',
          students: absentees.map((s) => s.id).join(','),
          template: 'absence',
        },
      });
      return;
    }
    router.back();
  };

  return (
    <Screen>
      <TopBar
        title={group.name}
        subtitle={`${shortDate(fromKey(params.date))} · ${params.start}`}
        trailing={
          <Press onPress={markAllPresent} style={styles.allIn}>
            <Text style={styles.allInLabel}>{t('attendance.allIn')}</Text>
          </Press>
        }>
        <View style={styles.tallyRow}>
          <Tally kind="present" value={counts.present} />
          <Tally kind="late" value={counts.late} />
          <Tally kind="absent" value={counts.absent} />
        </View>
      </TopBar>

      <ScrollView
        contentContainerStyle={{
          padding: space.gutter,
          paddingTop: 18,
          paddingBottom: insets.bottom + 130,
        }}
        showsVerticalScrollIndicator={false}>
        <Text style={styles.hint}>{t('attendance.cycleHint')}</Text>

        <View style={styles.grid}>
          {roster.map((s) => (
            <FaceCell
              key={s.id}
              student={s}
              mark={marks[s.id] ?? 'present'}
              width={cellWidth}
              onPress={() => cycle(s.id)}
            />
          ))}
        </View>

        {roster.length === 0 ? (
          <Txt style={styles.missing}>{t('attendance.addStudentsFirst')}</Txt>
        ) : null}
      </ScrollView>

      <StickyFooter>
        <FooterSummary
          title={t('attendance.summary', { present: counts.present, total: roster.length })}
          hint={
            counts.absent > 0
              ? `Parents of ${counts.absent} absentee${counts.absent > 1 ? 's' : ''} will be notified`
              : t('attendance.fullAttendance')
          }
        />
        <Button label={t('common.save')} onPress={save} style={styles.saveButton} />
      </StickyFooter>
    </Screen>
  );
}

function Tally({ kind, value }: { kind: AttendanceStatus; value: number }) {
  const t = useT();
  const { status } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const s = status[kind];
  return (
    <View style={[styles.tally, { backgroundColor: s.tint }]}>
      <View style={[styles.tallyDot, { backgroundColor: s.dot }]} />
      <Text style={[styles.tallyValue, { color: s.ink }]}>{value}</Text>
      <Text style={[styles.tallyLabel, { color: s.sub }]}>{t(STATUS_KEY[kind])}</Text>
    </View>
  );
}

function FaceCell({
  student,
  mark,
  width,
  onPress,
}: {
  student: Student;
  mark: AttendanceStatus;
  width: number;
  onPress: () => void;
}) {
  const t = useT();
  const { status } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const s = status[mark];

  return (
    <Press
      haptic
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${student.name}, ${t(STATUS_KEY[mark])}`}
      style={[styles.cell, { width, borderColor: s.border, boxShadow: s.glow }]}>
      <View>
        {/* The face, where there is one. This grid drew initials and nothing
            else, which is the one screen where a photo earns its keep: a
            teacher marking a register they took over mid-term knows the faces
            long before they know which Aýgül is which on paper. */}
        <Avatar
          name={student.name}
          accent={student.accent}
          photoId={student.id}
          size={56}
          radius={radius.hero}
          fontSize={18}
        />
        <View style={[styles.statusDot, { backgroundColor: s.dot }]}>
          <Text style={styles.statusMark}>{statusMeta[mark].mark}</Text>
        </View>
      </View>
      <Text style={styles.cellName} numberOfLines={2}>
        {student.name}
      </Text>
    </Press>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    missing: { textAlign: 'center', color: color.mutedLight, padding: 40 },

    allIn: {
      height: 40,
      paddingHorizontal: 12,
      borderRadius: radius.control,
      backgroundColor: color.primaryTint,
      alignItems: 'center',
      justifyContent: 'center',
    },
    allInLabel: { fontFamily: body[700], fontSize: 12.5, color: color.primary },

    tallyRow: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: space.gutter,
      paddingBottom: 14,
    },
    tally: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderRadius: radius.control,
      paddingHorizontal: 12,
      paddingVertical: 9,
    },
    tallyDot: { width: 9, height: 9, borderRadius: 4.5 },
    tallyValue: { fontFamily: display[600], fontSize: 17, ...text.tabular },
    tallyLabel: { fontFamily: body[600], fontSize: 11.5 },

    hint: {
      fontFamily: body[600],
      fontSize: 12,
      color: color.mutedLight,
      marginBottom: 14,
    },

    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
    cell: {
      alignItems: 'center',
      gap: 8,
      backgroundColor: color.surface,
      borderWidth: 1.5,
      borderRadius: radius.card,
      paddingTop: 14,
      paddingBottom: 11,
      paddingHorizontal: 8,
    },
    statusDot: {
      position: 'absolute',
      right: -4,
      bottom: -4,
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2.5,
      borderColor: color.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    statusMark: {
      fontFamily: body[700],
      fontSize: 11,
      lineHeight: 13,
      color: color.onStatus,
      includeFontPadding: false,
    },
    cellName: {
      fontFamily: body[600],
      fontSize: 12,
      lineHeight: 15,
      textAlign: 'center',
      letterSpacing: -0.12,
      color: color.ink,
    },

    saveButton: { paddingHorizontal: 22 },
  });

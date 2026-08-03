import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AngledGradient, Ring } from '@/components/decor';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/layout';
import {
  Avatar,
  Badge,
  Button,
  IconButton,
  Press,
  StatTile,
  Txt,
} from '@/components/ui';
import { absenceCount, attendanceRate, useGroup, useRoster } from '@/data/store';
import type { Student } from '@/data/types';
import { callNumber, smsNumber } from '@/lib/contact';
import { toKey } from '@/lib/date';
import { nextSessionForGroup, slotDaysLabel, slotTimeLabel } from '@/lib/schedule';
import { accents, color, radius, space } from '@/theme/tokens';
import { body, display, text } from '@/theme/type';

const PAGE = 4;

export default function GroupDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const group = useGroup(id);
  const roster = useRoster(id);
  const [expanded, setExpanded] = useState(false);

  const stats = useMemo(() => {
    if (!group) return null;
    const ids = roster.map((s) => s.id);
    const { rate } = attendanceRate(ids, [group.id]);
    const scored = roster.filter((s) => s.avgScore != null);
    const avg = scored.length
      ? scored.reduce((n, s) => n + (s.avgScore ?? 0), 0) / scored.length
      : null;
    return { rate, avg };
  }, [group, roster]);

  if (!group) {
    return (
      <Screen>
        <View style={styles.missing}>
          <Txt>That group no longer exists.</Txt>
          <Button label="Go back" variant="ghost" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  const a = accents[group.accent];
  const visible = expanded ? roster : roster.slice(0, PAGE);
  const hidden = roster.length - visible.length;

  const openAttendance = () => {
    const next = nextSessionForGroup(group);
    router.push({
      pathname: '/attendance',
      params: {
        group: group.id,
        date: next?.date ?? toKey(new Date()),
        start: next?.start ?? group.slots[0]?.start ?? '09:00',
      },
    });
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}>
        <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
          <AngledGradient colors={[a.headerFrom, color.navy]} angle={155} />
          <Ring
            size={210}
            width={28}
            tint="rgba(255,255,255,0.07)"
            style={{ right: -60, top: -30 }}
          />

          <View style={styles.headerBar}>
            <IconButton
              name="chevronLeft"
              tint="rgba(255,255,255,0.14)"
              fg="#fff"
              onPress={() => router.back()}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <IconButton
                name="pencil"
                iconSize={18}
                tint="rgba(255,255,255,0.14)"
                fg="#fff"
              />
              <IconButton
                name="more"
                iconSize={18}
                tint="rgba(255,255,255,0.14)"
                fg="#fff"
              />
            </View>
          </View>

          <View style={{ marginTop: 20 }}>
            <View style={styles.subjectRow}>
              <View style={[styles.subjectDot, { backgroundColor: a.dotDark }]} />
              <Text style={[styles.subjectLabel, { color: a.inkDark }]}>{group.subject}</Text>
            </View>
            <Text style={styles.title}>{group.name}</Text>
            <View style={styles.metaChips}>
              <MetaChip label={slotDaysLabel(group)} />
              <MetaChip label={slotTimeLabel(group)} />
              <MetaChip label={group.room} />
            </View>
          </View>
        </View>

        <View style={styles.statRow}>
          <StatTile value={String(roster.length)} label="Students" />
          <StatTile
            value={stats?.rate != null ? `${stats.rate}%` : '—'}
            label="Attendance"
            tone={stats?.rate != null ? color.success : color.mutedLight}
          />
          <StatTile
            value={stats?.avg != null ? stats.avg.toFixed(1) : '—'}
            label="Avg. score"
          />
        </View>

        <View style={styles.actionRow}>
          <Button
            grow
            icon="chat"
            label="Message all"
            onPress={() =>
              router.push({ pathname: '/compose', params: { group: group.id } })
            }
          />
          <Button grow variant="outline" icon="check" label="Attendance" onPress={openAttendance} />
        </View>

        <View style={styles.rosterHead}>
          <Text style={text.section}>Students</Text>
          <Press
            onPress={() => router.push({ pathname: '/student/new', params: { group: group.id } })}
            style={styles.addLink}>
            <Icon name="plus" size={14} color={color.primary} strokeWidth={2} />
            <Text style={styles.addLabel}>Add</Text>
          </Press>
        </View>

        <View style={styles.roster}>
          {visible.map((s) => (
            <RosterRow
              key={s.id}
              student={s}
              groupId={group.id}
              onPress={() => router.push(`/student/${s.id}`)}
            />
          ))}

          {hidden > 0 || expanded ? (
            <Press onPress={() => setExpanded((v) => !v)} style={styles.showMore}>
              <Text style={styles.showMoreLabel}>
                {expanded ? 'Show less' : `Show ${hidden} more`}
              </Text>
            </Press>
          ) : null}

          {roster.length === 0 ? (
            <Txt style={styles.emptyRoster}>No students in this group yet.</Txt>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

function MetaChip({ label }: { label: string }) {
  return (
    <View style={styles.metaChip}>
      <Text style={styles.metaChipLabel}>{label}</Text>
    </View>
  );
}

function RosterRow({
  student,
  groupId,
  onPress,
}: {
  student: Student;
  groupId: string;
  onPress: () => void;
}) {
  const absences = absenceCount(student.id, groupId);

  return (
    <Press onPress={onPress} style={styles.rosterRow}>
      <Avatar name={student.name} accent={student.accent} size={42} radius={radius.button} />

      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.nameRow}>
          <Text style={[text.rowTitleSm, { flexShrink: 1 }]} numberOfLines={1}>
            {student.name}
          </Text>
          {absences >= 2 ? (
            <Badge
              label={`${absences} absences`}
              bg={accents.amber.tint}
              fg="#B4610A"
              style={styles.absenceBadge}
              textStyle={styles.absenceBadgeText}
            />
          ) : null}
        </View>
        <Text style={styles.phone}>{student.phone}</Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 6 }}>
        <IconButton
          name="phone"
          size={40}
          iconSize={15}
          radius={radius.control}
          tint="#EAF6F1"
          fg={color.success}
          onPress={() => callNumber(student.phone)}
        />
        <IconButton
          name="chat"
          size={40}
          iconSize={15}
          radius={radius.control}
          tint={color.bg}
          fg={color.inkSoft}
          onPress={() => smsNumber(student.phone)}
        />
      </View>
    </Press>
  );
}

const styles = StyleSheet.create({
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },

  header: {
    overflow: 'hidden',
    backgroundColor: color.navy,
    paddingHorizontal: space.gutter,
    paddingBottom: 22,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  subjectRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  subjectDot: { width: 7, height: 7, borderRadius: 2 },
  subjectLabel: {
    fontFamily: body[700],
    fontSize: 11,
    letterSpacing: 1.32,
    textTransform: 'uppercase',
  },
  title: { ...text.screenTitle, color: '#fff', marginTop: 9 },
  metaChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  metaChip: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radius.md,
  },
  metaChipLabel: {
    fontFamily: body[600],
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.85)',
  },

  statRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: space.gutter,
    paddingTop: 16,
    paddingBottom: 6,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 9,
    paddingHorizontal: space.gutter,
    paddingTop: 12,
    paddingBottom: 20,
  },

  rosterHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.gutter,
    paddingBottom: 12,
  },
  addLink: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  addLabel: { fontFamily: body[700], fontSize: 13, color: color.primary },

  roster: { gap: 8, paddingHorizontal: space.gutter },
  rosterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.tile,
    paddingVertical: 11,
    paddingLeft: 13,
    paddingRight: 12,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  absenceBadge: {
    flexShrink: 0,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: radius.xs,
  },
  absenceBadgeText: {
    fontFamily: body[700],
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  phone: {
    fontFamily: body[400],
    fontSize: 12.5,
    color: color.muted,
    marginTop: 3,
    ...text.tabular,
  },

  showMore: { height: 46, alignItems: 'center', justifyContent: 'center' },
  showMoreLabel: { fontFamily: body[600], fontSize: 14, color: color.muted },
  emptyRoster: { fontSize: 13.5, color: color.mutedLight, paddingVertical: 12 },
});

import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Screen, StickyFooter, TopBar } from '@/components/layout';
import { Button, Card, Divider, FieldRow, Overline, Press } from '@/components/ui';
import { useStore } from '@/data/store';
import type { Weekday } from '@/data/types';
import { accentNames, accents, color, radius, space } from '@/theme/tokens';
import { body, display } from '@/theme/type';

const DAYS: { day: Weekday; label: string }[] = [
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
  { day: 0, label: 'Sun' },
];

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Creating a group is the one flow the mockups leave to the "New group" affordance
 * on Home. It reuses the add-student form language: grouped card, labelled rows,
 * chip pickers, sticky save.
 */
export default function NewGroup() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const addGroup = useStore((s) => s.addGroup);
  const existing = useStore((s) => s.groups.length);

  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [room, setRoom] = useState('');
  const [start, setStart] = useState('16:00');
  const [end, setEnd] = useState('17:30');
  const [days, setDays] = useState<Record<number, boolean>>({});
  const [accent, setAccent] = useState(accentNames[existing % accentNames.length]);

  const chosenDays = DAYS.filter((d) => days[d.day]);
  const ready =
    name.trim().length > 1 &&
    subject.trim().length > 1 &&
    chosenDays.length > 0 &&
    TIME.test(start) &&
    TIME.test(end) &&
    start < end;

  const save = () => {
    const id = addGroup({
      name: name.trim(),
      subject: subject.trim(),
      room: room.trim() || 'No room',
      accent,
      slots: chosenDays.map((d) => ({ day: d.day, start, end })),
    });
    router.replace(`/group/${id}`);
  };

  return (
    <Screen>
      <TopBar title="New group" dismiss />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 60}>
        <ScrollView
          contentContainerStyle={{
            padding: space.gutter,
            paddingBottom: insets.bottom + 130,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Overline style={styles.label}>Group</Overline>
          <Card style={styles.group}>
            <FieldRow
              label="Name"
              placeholder="e.g. IELTS Advanced"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
            />
            <Divider inset={15} />
            <FieldRow
              label="Subject"
              placeholder="e.g. English"
              value={subject}
              onChangeText={setSubject}
              autoCapitalize="words"
            />
            <Divider inset={15} />
            <FieldRow
              label="Room"
              placeholder="Optional"
              value={room}
              onChangeText={setRoom}
            />
          </Card>

          <Overline style={styles.label}>Meets on</Overline>
          <View style={styles.dayRow}>
            {DAYS.map((d) => {
              const on = !!days[d.day];
              return (
                <Press
                  key={d.day}
                  haptic
                  onPress={() => setDays((x) => ({ ...x, [d.day]: !x[d.day] }))}
                  style={[
                    styles.dayChip,
                    {
                      backgroundColor: on ? color.primary : color.surface,
                      borderColor: on ? color.primary : color.border,
                    },
                  ]}>
                  <Text
                    style={[styles.dayLabel, { color: on ? '#fff' : color.inkSoft }]}>
                    {d.label}
                  </Text>
                </Press>
              );
            })}
          </View>

          <Overline style={styles.label}>Time</Overline>
          <Card style={styles.group}>
            <FieldRow
              label="Starts"
              placeholder="16:00"
              value={start}
              onChangeText={setStart}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
            />
            <Divider inset={15} />
            <FieldRow
              label="Ends"
              placeholder="17:30"
              value={end}
              onChangeText={setEnd}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
            />
          </Card>

          <Overline style={styles.label}>Colour</Overline>
          <View style={styles.accentRow}>
            {accentNames.map((a) => {
              const on = a === accent;
              return (
                <Press
                  key={a}
                  haptic
                  onPress={() => setAccent(a)}
                  style={[
                    styles.accentSwatch,
                    {
                      backgroundColor: accents[a].tint,
                      borderColor: on ? accents[a].dot : 'transparent',
                    },
                  ]}>
                  <View style={[styles.accentDot, { backgroundColor: accents[a].dot }]} />
                  <Text style={[styles.accentLabel, { color: accents[a].inkDeep }]}>{a}</Text>
                </Press>
              );
            })}
          </View>

          {!TIME.test(start) || !TIME.test(end) ? (
            <Text style={styles.validation}>Use 24-hour times, like 16:00.</Text>
          ) : start >= end ? (
            <Text style={styles.validation}>The end time must be after the start.</Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <StickyFooter>
        <Button grow label="Create group" height={50} onPress={save} disabled={!ready} />
      </StickyFooter>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { marginBottom: 10 },
  group: { overflow: 'hidden', marginBottom: 22 },

  dayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 22 },
  dayChip: {
    width: 46,
    height: 42,
    borderRadius: radius.field,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayLabel: { fontFamily: body[600], fontSize: 12.5 },

  accentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  accentSwatch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 42,
    paddingHorizontal: 14,
    borderRadius: radius.field,
    borderWidth: 2,
  },
  accentDot: { width: 10, height: 10, borderRadius: 3 },
  accentLabel: { fontFamily: display[600], fontSize: 13, textTransform: 'capitalize' },

  validation: { fontFamily: body[600], fontSize: 12.5, color: color.dangerDeep, marginTop: 4 },
});

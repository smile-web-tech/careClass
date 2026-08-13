/**
 * The group form, shared by "New group" and "Edit group".
 *
 * One component rather than two screens so the two can never drift — an edit
 * screen that offers fewer fields than the create screen is a trap, because the
 * teacher can set something they then cannot change.
 */
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Screen, StickyFooter, TopBar } from '@/components/layout';
import { useT } from '@/i18n/useT';
import { TimeField, TimePicker } from '@/components/TimePicker';
import { Button, Card, Divider, FieldRow, Overline, Press } from '@/components/ui';
import type { Group, Slot, Weekday } from '@/data/types';
import { accentNames, radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
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

export type GroupDraft = Omit<Group, 'id'>;

export function GroupForm({
  title,
  submitLabel,
  initial,
  /** Rendered under the form — the danger zone on the edit screen. */
  footer,
  /** Blocks the submit while the caller is working — e.g. the online check. */
  busy,
  onSubmit,
}: {
  title: string;
  submitLabel: string;
  initial?: Group;
  footer?: React.ReactNode;
  busy?: boolean;
  onSubmit: (draft: GroupDraft) => void;
}) {
  const { accents, color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState(initial?.name ?? '');
  const [subject, setSubject] = useState(initial?.subject ?? '');
  const [room, setRoom] = useState(initial?.room && initial.room !== 'No room' ? initial.room : '');
  const [accent, setAccent] = useState(initial?.accent ?? accentNames[0]);

  // Every slot of an existing group shares one time pair in this form, so seed
  // from the first. Per-day times would need a different UI; the mockups treat
  // a group as one weekly time across the days it meets.
  const [start, setStart] = useState(initial?.slots[0]?.start ?? '16:00');
  const [end, setEnd] = useState(initial?.slots[0]?.end ?? '17:30');

  const [days, setDays] = useState<Record<number, boolean>>(() => {
    const out: Record<number, boolean> = {};
    for (const s of initial?.slots ?? []) out[s.day] = true;
    return out;
  });

  const [picking, setPicking] = useState<'start' | 'end' | null>(null);

  const chosenDays = useMemo(() => DAYS.filter((d) => days[d.day]), [days]);
  // The wheel cannot produce a malformed time, so the only thing left to check
  // is that the teacher picked at least one day and named the thing.
  const ready =
    name.trim().length > 1 && subject.trim().length > 1 && chosenDays.length > 0 && start < end;

  const submit = () => {
    const slots: Slot[] = chosenDays.map((d) => ({ day: d.day, start, end }));
    onSubmit({
      name: name.trim(),
      subject: subject.trim(),
      // Empty, not the words "No room": that string was being written into the
      // database and then shown verbatim, so it stayed English in every
      // language. Absence is a state, not a value.
      room: room.trim(),
      accent,
      slots,
    });
  };

  return (
    <Screen>
      <TopBar title={title} dismiss />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 60}>
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{
            padding: space.gutter,
            paddingBottom: insets.bottom + 130,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Overline style={styles.label}>{t('grades.group')}</Overline>
          <Card style={styles.group}>
            <FieldRow
              label={t('groups.name')}
              placeholder={t('groups.namePlaceholder')}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
            />
            <Divider inset={15} />
            <FieldRow
              label={t('groups.subject')}
              placeholder={t('groups.subjectPlaceholder')}
              value={subject}
              onChangeText={setSubject}
              autoCapitalize="words"
            />
            <Divider inset={15} />
            <FieldRow
              label={t('groups.room')}
              placeholder={t('common.optional')}
              value={room}
              onChangeText={setRoom}
            />
          </Card>

          <Overline style={styles.label}>{t('groups.meetsOn')}</Overline>
          <View style={styles.dayRow}>
            {DAYS.map((d) => {
              const on = !!days[d.day];
              return (
                <Press
                  key={d.day}
                  haptic
                  onPress={() => setDays((x) => ({ ...x, [d.day]: !x[d.day] }))}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={[
                    styles.dayChip,
                    {
                      backgroundColor: on ? color.primary : color.surface,
                      borderColor: on ? color.primary : color.border,
                    },
                  ]}>
                  <Text style={[styles.dayLabel, { color: on ? '#fff' : color.inkSoft }]}>
                    {d.label}
                  </Text>
                </Press>
              );
            })}
          </View>

          <Overline style={styles.label}>{t('calendar.when')}</Overline>
          <Card style={styles.group}>
            <TimeField
              label={t('groups.starts')}
              value={start}
              onPress={() => setPicking('start')}
            />
            <Divider inset={15} />
            <TimeField label={t('groups.ends')} value={end} onPress={() => setPicking('end')} />
          </Card>

          <Overline style={styles.label}>{t('groups.colour')}</Overline>
          <View style={styles.accentRow}>
            {accentNames.map((a) => {
              const on = a === accent;
              return (
                <Press
                  key={a}
                  haptic
                  onPress={() => setAccent(a)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${a} colour`}
                  style={[
                    styles.swatch,
                    {
                      backgroundColor: accents[a].tint,
                      borderColor: on ? accents[a].dot : 'transparent',
                    },
                  ]}>
                  <View style={[styles.swatchDot, { backgroundColor: accents[a].dot }]} />
                  {on ? (
                    <View style={[styles.swatchRing, { borderColor: accents[a].dot }]} />
                  ) : null}
                </Press>
              );
            })}
          </View>
          <Text style={styles.accentName}>{accent}</Text>

          {footer}
        </ScrollView>
      </KeyboardAvoidingView>

      <StickyFooter>
        <Button grow label={submitLabel} height={50} onPress={submit} disabled={!ready || busy} />
      </StickyFooter>

      <TimePicker
        visible={picking !== null}
        title={t(picking === 'end' ? 'groups.endsAt' : 'groups.startsAt')}
        value={picking === 'end' ? end : start}
        // An end before its start is the one impossible combination; block it
        // in the picker rather than rejecting it after the fact.
        min={picking === 'end' ? start : undefined}
        onCancel={() => setPicking(null)}
        onConfirm={(v) => {
          if (picking === 'end') {
            setEnd(v);
          } else {
            setStart(v);
            // Keep the pair coherent: dragging the start past the end pushes
            // the end along rather than leaving an invalid range on screen.
            if (v >= end) {
              const [h, m] = v.split(':').map(Number);
              const later = new Date(2000, 0, 1, h, m + 90);
              setEnd(
                `${String(later.getHours()).padStart(2, '0')}:${String(later.getMinutes()).padStart(2, '0')}`,
              );
            }
          }
          setPicking(null);
        }}
      />
    </Screen>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
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

    // Twelve colours would make a row of labelled pills far too tall, so the
    // picker is a swatch grid and the chosen name is spelled out beneath it.
    accentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    swatch: {
      width: 46,
      height: 42,
      borderRadius: radius.field,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    swatchDot: { width: 16, height: 16, borderRadius: 5 },
    swatchRing: {
      position: 'absolute',
      width: 26,
      height: 26,
      borderRadius: 9,
      borderWidth: 1.5,
      opacity: 0.5,
    },
    accentName: {
      fontFamily: display[600],
      fontSize: 13,
      color: color.muted,
      textTransform: 'capitalize',
      marginTop: 10,
      marginBottom: 8,
    },
  });

/**
 * Add or edit a personal calendar entry — a parent meeting, an exam, a day off.
 *
 * Deliberately separate from a group: these do not recur, have no roster and no
 * attendance. Passing an `id` puts the screen in edit mode.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirm } from '@/components/Dialog';
import { useT } from '@/i18n/useT';
import { Icon } from '@/components/Icon';
import { Screen, StickyFooter, TopBar } from '@/components/layout';
import { TimeField, TimePicker } from '@/components/TimePicker';
import { Button, Card, Divider, FieldRow, Overline, Press, Toggle } from '@/components/ui';
import { useStore } from '@/data/store';
import { addDays, dowLong, fromKey, monthLong, toKey } from '@/lib/date';
import { accentNames, radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, display } from '@/theme/type';

export default function EventForm() {
  const t = useT();
  const { id, date: dateParam } = useLocalSearchParams<{ id?: string; date?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { accents, color } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const existing = useStore((s) => s.events.find((e) => e.id === id));
  const addEvent = useStore((s) => s.addEvent);
  const updateEvent = useStore((s) => s.updateEvent);
  const removeEvent = useStore((s) => s.removeEvent);

  const [title, setTitle] = useState(existing?.title ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [dateKey, setDateKey] = useState(existing?.date ?? dateParam ?? toKey(new Date()));
  const [allDay, setAllDay] = useState(existing?.allDay ?? false);
  const [start, setStart] = useState(existing?.start ?? '09:00');
  const [end, setEnd] = useState(existing?.end ?? '10:00');
  const [accent, setAccent] = useState(existing?.accent ?? 'slate');
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);

  const date = useMemo(() => fromKey(dateKey), [dateKey]);
  const ready = title.trim().length > 1 && (allDay || start < end);

  const submit = () => {
    const draft = {
      title: title.trim(),
      note: note.trim() || undefined,
      date: dateKey,
      allDay,
      start: allDay ? undefined : start,
      end: allDay ? undefined : end,
      accent,
    };
    if (existing) updateEvent(existing.id, draft);
    else addEvent(draft);
    router.back();
  };

  const confirmDelete = async () => {
    if (!existing) return;
    const yes = await confirm({
      title: t('calendar.deleteTitle', { title: existing.title }),
      message: t('calendar.cannotUndo'),
      confirmLabel: t('common.delete'),
    });
    if (!yes) return;
    removeEvent(existing.id);
    router.back();
  };

  return (
    <Screen>
      <TopBar title={t(existing ? 'calendar.editEvent' : 'calendar.newEvent')} dismiss />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 60}>
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ padding: space.gutter, paddingBottom: insets.bottom + 130 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Overline style={styles.label}>{t('calendar.event')}</Overline>
          <Card style={styles.group}>
            <FieldRow
              label={t('calendar.eventTitle')}
              placeholder={t('calendar.eventTitleHint')}
              value={title}
              onChangeText={setTitle}
              autoCapitalize="sentences"
            />
            <Divider inset={15} />
            <FieldRow
              label={t('calendar.note')}
              placeholder={t('common.optional')}
              value={note}
              onChangeText={setNote}
              autoCapitalize="sentences"
            />
          </Card>

          <Overline style={styles.label}>{t('calendar.when')}</Overline>
          <Card style={styles.group}>
            <View style={styles.dateRow}>
              <Press
                onPress={() => setDateKey(toKey(addDays(date, -1)))}
                style={styles.stepper}
                accessibilityLabel={t('calendar.prevDay')}>
                <Icon name="chevronLeft" size={16} color={color.inkSoft} />
              </Press>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={styles.dateDow}>{dowLong(date)}</Text>
                <Text style={styles.dateFull}>
                  {date.getDate()} {monthLong(date)} {date.getFullYear()}
                </Text>
              </View>
              <Press
                onPress={() => setDateKey(toKey(addDays(date, 1)))}
                style={styles.stepper}
                accessibilityLabel={t('calendar.nextDay')}>
                <Icon name="chevronRight" size={16} color={color.inkSoft} />
              </Press>
            </View>

            <Divider inset={15} />
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>{t('calendar.allDay')}</Text>
              <Toggle value={allDay} onChange={setAllDay} />
            </View>

            {!allDay ? (
              <>
                <Divider inset={15} />
                <TimeField
                  label={t('groups.starts')}
                  value={start}
                  onPress={() => setPicking('start')}
                />
                <Divider inset={15} />
                <TimeField label={t('groups.ends')} value={end} onPress={() => setPicking('end')} />
              </>
            ) : null}
          </Card>

          {/* Said here because it is not obvious that writing something in the
              calendar also arranges to be told about it. All-day entries have no
              start time for a lead to count back from, so they say when they
              actually arrive. */}
          <Text style={styles.reminderNote}>
            {allDay ? t('calendar.remindMorning') : t('calendar.remindBefore')}
          </Text>

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
                </Press>
              );
            })}
          </View>
          <Text style={styles.accentName}>{accent}</Text>

          {existing ? (
            <Card style={[styles.group, { marginTop: 14 }]}>
              <Press onPress={confirmDelete} style={styles.deleteRow}>
                <Icon name="close" size={15} color={color.dangerDeep} />
                <Text style={[styles.deleteLabel, { color: color.dangerDeep }]}>
                  {t('calendar.deleteEvent')}
                </Text>
              </Press>
            </Card>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <StickyFooter>
        <Button
          grow
          label={t(existing ? 'common.saveChanges' : 'calendar.addToCalendar')}
          height={50}
          onPress={submit}
          disabled={!ready}
        />
      </StickyFooter>

      <TimePicker
        visible={picking !== null}
        title={t(picking === 'end' ? 'groups.endsAt' : 'groups.startsAt')}
        value={picking === 'end' ? end : start}
        min={picking === 'end' ? start : undefined}
        onCancel={() => setPicking(null)}
        onConfirm={(v) => {
          if (picking === 'end') setEnd(v);
          else {
            setStart(v);
            // Keep the pair coherent rather than leaving an invalid range.
            if (v >= end) {
              const [h, m] = v.split(':').map(Number);
              const later = new Date(2000, 0, 1, h + 1, m);
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

    dateRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
    stepper: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dateDow: { fontFamily: body[600], fontSize: 12, color: color.mutedLight },
    dateFull: { fontFamily: display[600], fontSize: 17, color: color.ink, marginTop: 2 },

    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 15,
      paddingVertical: 11,
    },
    toggleLabel: { fontFamily: body[600], fontSize: 14.5, color: color.inkSoft },

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
    reminderNote: {
      fontFamily: body[400],
      fontSize: 12.5,
      lineHeight: 18,
      color: color.mutedLight,
      marginTop: 12,
    },

    accentName: {
      fontFamily: display[600],
      fontSize: 13,
      color: color.muted,
      textTransform: 'capitalize',
      marginTop: 10,
    },

    deleteRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 15,
      paddingVertical: 14,
    },
    deleteLabel: { fontFamily: body[700], fontSize: 14.5 },
  });

/**
 * A month calendar for picking a date.
 *
 * Written rather than pulled in. `@react-native-community/datetimepicker` opens
 * the platform dialog, which on Android means a spinner that starts at today
 * and has to be scrolled back fifteen years to reach a child's birthday. That
 * is a poor way to enter the one date this app asks for.
 *
 * So: a month grid, with the year and month directly tappable. Three taps to
 * any birthday — year, month, day — and the whole thing is already in the
 * app's own visual language rather than the OS's.
 *
 * Weeks start on Monday, as they do everywhere else in ClassCare and as they do
 * in Turkmenistan.
 */
import { useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Button, Press } from '@/components/ui';
import { useT } from '@/i18n/useT';
import { fromKey, monthLong, toKey, weekdayInitials } from '@/lib/date';
import { radius, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, display, text } from '@/theme/type';

/** How far back the year list goes. A teacher's oldest student, generously. */
const YEARS_BACK = 90;

type Mode = 'day' | 'month' | 'year';

export function DatePicker({
  visible,
  value,
  title,
  onClose,
  onPick,
}: {
  visible: boolean;
  /** `YYYY-MM-DD`, or undefined for nothing chosen yet. */
  value?: string;
  title: string;
  onClose: () => void;
  onPick: (dateKey: string) => void;
}) {
  const t = useT();
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  /*
    Where the grid is looking, which is not the same as what is selected: a
    teacher paging through months has selected nothing yet, and the selection
    must not jump around underneath them.

    Opening on the selected date when there is one, and on a sensible birthday
    year when there is not — starting at today would put a fifteen-year-old
    fifteen years of paging away.
  */
  const [cursor, setCursor] = useState(() => (value ? fromKey(value) : defaultView()));
  const [mode, setMode] = useState<Mode>('day');

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const days = useMemo(() => monthGrid(year, month), [year, month]);
  const years = useMemo(() => {
    const thisYear = new Date().getFullYear();
    return Array.from({ length: YEARS_BACK }, (_, i) => thisYear - i);
  }, []);

  const step = (months: number) => {
    const next = new Date(cursor);
    // Day 1 first: stepping from the 31st into a 30-day month would otherwise
    // roll forward into the month after.
    next.setDate(1);
    next.setMonth(next.getMonth() + months);
    setCursor(next);
  };

  const choose = (day: Date) => {
    onPick(toKey(day));
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Press style={styles.scrim} onPress={onClose} />

      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 10 }]}>
        <View style={styles.grabber} />
        <Text style={[text.sheetTitle, styles.ink]}>{title}</Text>

        <View style={styles.head}>
          <Press
            onPress={() => setMode(mode === 'day' ? 'month' : 'day')}
            hitSlop={8}
            style={styles.headLabel}>
            <Text style={styles.monthLabel}>{`${monthLong(cursor)} ${year}`}</Text>
            <Icon name="disclosure" size={13} color={color.mutedLight} />
          </Press>

          {mode === 'day' ? (
            <View style={styles.steppers}>
              <Press onPress={() => step(-1)} hitSlop={10} style={styles.stepper}>
                <Icon name="chevronLeft" size={15} color={color.inkSoft} />
              </Press>
              <Press onPress={() => step(1)} hitSlop={10} style={styles.stepper}>
                <Icon name="chevronRight" size={15} color={color.inkSoft} />
              </Press>
            </View>
          ) : null}
        </View>

        {mode === 'day' ? (
          <>
            <View style={styles.weekRow}>
              {weekdayInitials().map((initial: string, i: number) => (
                <Text key={i} style={styles.weekday}>
                  {initial}
                </Text>
              ))}
            </View>

            <View style={styles.grid}>
              {days.map((day, i) =>
                day === null ? (
                  <View key={`gap-${i}`} style={styles.cell} />
                ) : (
                  <Press key={toKey(day)} onPress={() => choose(day)} style={styles.cell}>
                    <View
                      style={[
                        styles.dayBubble,
                        value === toKey(day) && { backgroundColor: color.primary },
                      ]}>
                      <Text
                        style={[
                          styles.dayLabel,
                          value === toKey(day) && { color: '#ffffff', fontFamily: body[700] },
                        ]}>
                        {day.getDate()}
                      </Text>
                    </View>
                  </Press>
                ),
              )}
            </View>
          </>
        ) : mode === 'month' ? (
          <View style={styles.pickGrid}>
            {Array.from({ length: 12 }, (_, m) => (
              <Press
                key={m}
                onPress={() => {
                  const next = new Date(cursor);
                  next.setDate(1);
                  next.setMonth(m);
                  setCursor(next);
                  setMode('year');
                }}
                style={[styles.pickCell, m === month && { backgroundColor: color.primaryTint }]}>
                <Text style={styles.pickLabel}>{monthLong(new Date(2000, m, 1))}</Text>
              </Press>
            ))}
          </View>
        ) : (
          <ScrollView style={styles.yearScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.pickGrid}>
              {years.map((y) => (
                <Press
                  key={y}
                  onPress={() => {
                    const next = new Date(cursor);
                    next.setDate(1);
                    next.setFullYear(y);
                    setCursor(next);
                    setMode('day');
                  }}
                  style={[styles.pickCell, y === year && { backgroundColor: color.primaryTint }]}>
                  <Text style={styles.pickLabel}>{y}</Text>
                </Press>
              ))}
            </View>
          </ScrollView>
        )}

        <Button
          grow
          variant="ghost"
          height={48}
          label={t('common.cancel')}
          onPress={onClose}
          style={{ marginTop: 6 }}
        />
      </View>
    </Modal>
  );
}

/** Sixteen years ago, which is the middle of a tutor's roster. */
function defaultView() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 16);
  d.setDate(1);
  return d;
}

/** The month laid out in weeks, with leading blanks so the columns line up. */
function monthGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  // `getDay()` is Sunday-based; the app's weeks start on Monday.
  const lead = (first.getDay() + 6) % 7;
  const length = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = Array(lead).fill(null);
  for (let day = 1; day <= length; day++) cells.push(new Date(year, month, day));
  return cells;
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    ink: { color: color.ink },
    scrim: { flex: 1, backgroundColor: color.scrim },
    sheet: {
      backgroundColor: color.sheet,
      borderTopLeftRadius: radius.sheet,
      borderTopRightRadius: radius.sheet,
      paddingHorizontal: 18,
      paddingTop: 10,
    },
    grabber: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: color.dashed,
      marginBottom: 14,
    },

    head: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 14,
      marginBottom: 10,
    },
    headLabel: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    monthLabel: { fontFamily: display[600], fontSize: 17, color: color.ink },
    steppers: { flexDirection: 'row', gap: 6 },
    stepper: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: color.fill,
    },

    weekRow: { flexDirection: 'row', marginBottom: 4 },
    weekday: {
      width: `${100 / 7}%`,
      textAlign: 'center',
      fontFamily: body[600],
      fontSize: 11,
      color: color.mutedLight,
    },

    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 3 },
    dayBubble: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayLabel: { fontFamily: body[500], fontSize: 14.5, color: color.ink },

    pickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    pickCell: {
      width: '31%',
      paddingVertical: 12,
      borderRadius: radius.control,
      alignItems: 'center',
      backgroundColor: color.fill,
    },
    pickLabel: { fontFamily: body[600], fontSize: 13.5, color: color.ink },
    yearScroll: { maxHeight: 320 },
  });

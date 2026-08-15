/**
 * A month calendar for picking a date.
 *
 * Written rather than pulled in. `@react-native-community/datetimepicker` opens
 * the platform dialog, which on Android means a spinner that starts at today
 * and has to be scrolled back fifteen years to reach a child's birthday. That
 * is a poor way to enter the one date this app asks for.
 *
 * ## What the first version got wrong
 *
 * The month and the year shared one label, so changing the year meant tapping
 * through to a month grid and then a year grid — two screens deep for the field
 * that actually matters when the answer is 2011. They are two controls now,
 * side by side, each with its own arrows and each tappable to jump straight to
 * a grid of the twelve months or of the years.
 *
 * Everything is also a fixed size. The header used to be laid out around the
 * month's name, so the arrows moved when September followed May, and the grid
 * drew only the weeks the month occupied, so the whole sheet grew and shrank by
 * a row as the teacher paged. Both make a calendar feel unsteady under the
 * thumb. The month name now sits in a fixed box and the grid always draws six
 * weeks, which is the most any month can span.
 *
 * Weeks start on Monday, as they do everywhere else in ClassCare and as they do
 * in Turkmenistan.
 */
import { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Button, Press } from '@/components/ui';
import { useT } from '@/i18n/useT';
import { fromKey, monthLong, toKey, weekdayInitials } from '@/lib/date';
import { radius, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, display, text } from '@/theme/type';

/**
 * How far back the year list goes by default. A teacher's oldest student,
 * generously — this picker was written for birthdays and that is still its
 * commonest use.
 */
const YEARS_BACK = 90;

/**
 * Years ahead, for a date that has not happened yet.
 *
 * A course start date is the other thing this picker is asked for, and a list
 * running only backwards cannot express next September. Kept as a prop rather
 * than simply widening the default: offering 2031 while somebody enters a
 * child's birthday is noise in the one list where scrolling is the whole cost.
 */
const YEARS_FORWARD = 0;

/** Six weeks. The most any month can span, and the height the grid always is. */
const GRID_CELLS = 42;

type Mode = 'day' | 'month' | 'year';

export function DatePicker({
  visible,
  value,
  title,
  yearsBack = YEARS_BACK,
  yearsForward = YEARS_FORWARD,
  opensOn,
  onClose,
  onPick,
}: {
  visible: boolean;
  /** `YYYY-MM-DD`, or undefined for nothing chosen yet. */
  value?: string;
  title: string;
  /** How many years before this one to offer. */
  yearsBack?: number;
  /** How many after. Zero for a date that cannot be in the future. */
  yearsForward?: number;
  /**
   * Which month to open on when nothing is chosen yet.
   *
   * Defaults to sixteen years ago, which is a sensible guess for a birthday and
   * a terrible one for a course starting next month — so a caller asking for a
   * date in the future passes today.
   */
  opensOn?: Date;
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
  const [cursor, setCursor] = useState(() => (value ? fromKey(value) : (opensOn ?? defaultView())));
  const [mode, setMode] = useState<Mode>('day');

  // Reopening should show the date on the field, not wherever the teacher had
  // paged to before they cancelled.
  useEffect(() => {
    if (!visible) return;
    setCursor(value ? fromKey(value) : (opensOn ?? defaultView()));
    setMode('day');
  }, [visible, value, opensOn]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const days = useMemo(() => monthGrid(year, month), [year, month]);
  const years = useMemo(() => {
    const thisYear = new Date().getFullYear();
    // Newest first, so a birthday list still opens on recent years and a
    // schedule list still opens near today rather than at the far end.
    return Array.from(
      { length: yearsBack + yearsForward },
      (_, i) => thisYear + yearsForward - i,
    );
  }, [yearsBack, yearsForward]);

  const stepMonth = (by: number) => {
    const next = new Date(cursor);
    // Day 1 first: stepping from the 31st into a 30-day month would otherwise
    // roll forward into the month after.
    next.setDate(1);
    next.setMonth(next.getMonth() + by);
    setCursor(next);
  };

  const stepYear = (by: number) => {
    const next = new Date(cursor);
    next.setDate(1);
    next.setFullYear(next.getFullYear() + by);
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

        {/*
          Two controls, not one. The month is the wider of them because its
          name is a word; the year is a fixed four digits and needs no more
          room than that. Both keep their width whatever is written in them.
        */}
        <View style={styles.head}>
          <View style={[styles.pill, { flex: 1 }]}>
            <Press onPress={() => stepMonth(-1)} hitSlop={8} style={styles.arrow}>
              <Icon name="chevronLeft" size={14} color={color.inkSoft} />
            </Press>
            <Press
              onPress={() => setMode(mode === 'month' ? 'day' : 'month')}
              style={styles.pillLabelBox}>
              <Text
                style={[styles.pillLabel, mode === 'month' && { color: color.primary }]}
                numberOfLines={1}
                // A long month name in Turkmen or Russian shrinks to fit rather
                // than pushing the arrows out of place.
                adjustsFontSizeToFit
                minimumFontScale={0.75}>
                {monthLong(cursor)}
              </Text>
            </Press>
            <Press onPress={() => stepMonth(1)} hitSlop={8} style={styles.arrow}>
              <Icon name="chevronRight" size={14} color={color.inkSoft} />
            </Press>
          </View>

          <View style={[styles.pill, { width: 128 }]}>
            <Press onPress={() => stepYear(-1)} hitSlop={8} style={styles.arrow}>
              <Icon name="chevronLeft" size={14} color={color.inkSoft} />
            </Press>
            <Press
              onPress={() => setMode(mode === 'year' ? 'day' : 'year')}
              style={styles.pillLabelBox}>
              <Text style={[styles.pillLabel, mode === 'year' && { color: color.primary }]}>
                {year}
              </Text>
            </Press>
            <Press onPress={() => stepYear(1)} hitSlop={8} style={styles.arrow}>
              <Icon name="chevronRight" size={14} color={color.inkSoft} />
            </Press>
          </View>
        </View>

        {/* Fixed height for every mode, so the sheet does not jump as the
            teacher moves between the grid, the months and the years. */}
        <View style={styles.stage}>
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
                    // Straight back to the days. Chaining on to the year list
                    // was the old behaviour and it meant a teacher who only
                    // wanted to change the month had to answer a question they
                    // had not asked.
                    setMode('day');
                  }}
                  style={[styles.pickCell, m === month && { backgroundColor: color.primaryTint }]}>
                  <Text
                    style={[styles.pickLabel, m === month && { color: color.primaryInk }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}>
                    {monthLong(new Date(2000, m, 1))}
                  </Text>
                </Press>
              ))}
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
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
                    <Text style={[styles.pickLabel, y === year && { color: color.primaryInk }]}>
                      {y}
                    </Text>
                  </Press>
                ))}
              </View>
            </ScrollView>
          )}
        </View>

        <View style={styles.foot}>
          <Button
            grow
            variant="ghost"
            height={48}
            label={t('common.cancel')}
            onPress={onClose}
          />
          {/* Today is one tap from anywhere, which matters on the other dates
              this picker is used for as much as it does on a birthday. */}
          <Button
            grow
            variant="outline"
            height={48}
            label={t('time.today')}
            onPress={() => choose(new Date())}
          />
        </View>
      </View>
    </Modal>
  );
}

/** Sixteen years ago, which is the middle of a tutor's roster. */
/**
 * A tappable row showing a chosen date, matching `TimeField` exactly.
 *
 * Deliberately the same shape as its time counterpart: a form that asks for a
 * date and a time in one card should not have them look like two different
 * kinds of control.
 */
export function DateField({
  label,
  value,
  muted,
  onPress,
}: {
  label: string;
  value: string;
  /** Greys the value, for "ongoing" and other absences that are not a date. */
  muted?: boolean;
  onPress: () => void;
}) {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Press onPress={onPress} style={styles.field} accessibilityRole="button">
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldValueWrap}>
        <Text style={[styles.fieldValue, muted && { color: color.mutedLight }]}>{value}</Text>
        <View style={[styles.fieldChevron, { borderColor: color.chevron }]} />
      </View>
    </Press>
  );
}

function defaultView() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 16);
  d.setDate(1);
  return d;
}

/**
 * The month laid out in weeks, always six of them.
 *
 * Padded rather than trimmed to length: a February starting on a Monday fills
 * four rows and a May starting on a Sunday spans six, and letting the grid
 * follow that makes the sheet grow and shrink underneath the thumb that is
 * paging it.
 */
function monthGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  // `getDay()` is Sunday-based; the app's weeks start on Monday.
  const lead = (first.getDay() + 6) % 7;
  const length = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = Array(lead).fill(null);
  for (let day = 1; day <= length; day++) cells.push(new Date(year, month, day));
  while (cells.length < GRID_CELLS) cells.push(null);
  return cells;
}

const makeStyles = ({ color, shadow }: Theme) =>
  StyleSheet.create({
    // Mirrors `TimeField` exactly — see `DateField`.
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 15,
      paddingVertical: 13,
    },
    fieldLabel: { fontFamily: body[600], fontSize: 14.5, color: color.inkSoft },
    fieldValueWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    fieldValue: {
      fontFamily: display[600],
      fontSize: 16,
      color: color.ink,
      ...text.tabular,
      ...shadow.segment,
      backgroundColor: color.fill,
      overflow: 'hidden',
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    fieldChevron: {
      width: 7,
      height: 7,
      borderRightWidth: 1.8,
      borderBottomWidth: 1.8,
      transform: [{ rotate: '45deg' }],
      marginTop: -3,
    },
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

    head: { flexDirection: 'row', gap: 10, marginTop: 14, marginBottom: 12 },
    pill: {
      height: 44,
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: radius.control,
      backgroundColor: color.fill,
      paddingHorizontal: 4,
    },
    arrow: { width: 34, height: 36, alignItems: 'center', justifyContent: 'center' },
    pillLabelBox: { flex: 1, height: 36, alignItems: 'center', justifyContent: 'center' },
    pillLabel: {
      fontFamily: display[600],
      fontSize: 15.5,
      color: color.ink,
      textAlign: 'center',
    },

    // Six rows of cells plus the weekday header, held constant so that every
    // mode occupies exactly the same space.
    stage: { height: 6 * 44 + 22 },

    weekRow: { flexDirection: 'row', marginBottom: 4 },
    weekday: {
      width: `${100 / 7}%`,
      textAlign: 'center',
      fontFamily: body[600],
      fontSize: 11,
      color: color.mutedLight,
    },

    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    cell: { width: `${100 / 7}%`, height: 44, alignItems: 'center', justifyContent: 'center' },
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
      width: '31.5%',
      height: 48,
      borderRadius: radius.control,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 6,
      backgroundColor: color.fill,
    },
    pickLabel: { fontFamily: body[600], fontSize: 13.5, color: color.ink, textAlign: 'center' },

    foot: { flexDirection: 'row', gap: 10, marginTop: 8 },
  });

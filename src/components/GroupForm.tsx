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

import { DateField, DatePicker } from '@/components/DatePicker';
import { Screen, StickyFooter, TopBar, useKeyboardLift } from '@/components/layout';
import type { TranslationKey } from '@/i18n';
import { useT } from '@/i18n/useT';
import { fromKey, longDate, toKey, weekdayInitials } from '@/lib/date';
import { compareTerms, termLabel, termOf } from '@/lib/term';
import { TimeField, TimePicker } from '@/components/TimePicker';
import { Button, Card, Divider, FieldRow, Overline, Press } from '@/components/ui';
import { useTerms } from '@/data/store';
import type { Group, Slot, Weekday } from '@/data/types';
import { accentNames, radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, display } from '@/theme/type';

/**
 * Monday first, and labelled by the phone's own language.
 *
 * A slot stores its day as a `Date#getDay` number, where Sunday is 0 and lands
 * at the front. Nobody here reads a week that way, so this is the order the
 * chips are laid out in and the stored numbers are what they carry.
 *
 * `weekdayInitials` is *already* in this order — it does the same rotation
 * internally and hands back seven labels running Monday to Sunday. So the two
 * are walked together by position. Indexing the labels by the day number
 * instead, which is what this used to do, read every chip off by one and gave
 * a row headed Tu We Th Fr Sa Su Mo above buttons that meant Mon to Sun.
 */
const DAY_NUMBERS: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

/**
 * How long a course runs, offered as the lengths people actually book.
 *
 * Stored as an end date rather than as a length. A length is only meaningful
 * beside a start, and the moment the teacher moves the start you have to guess
 * whether they meant to move the end with it — so the picker computes a date
 * and the date is what is kept. Choosing a duration again recomputes it.
 */
const DURATIONS: { key: string; labelKey: TranslationKey; days?: number; months?: number }[] = [
  { key: '1w', labelKey: 'groups.oneWeek', days: 7 },
  { key: '2w', labelKey: 'groups.twoWeeks', days: 14 },
  { key: '1m', labelKey: 'groups.oneMonth', months: 1 },
  { key: '3m', labelKey: 'groups.threeMonths', months: 3 },
  { key: '6m', labelKey: 'groups.sixMonths', months: 6 },
  { key: '1y', labelKey: 'groups.oneYear', months: 12 },
];

/**
 * The last day a course of this length covers, counting from its first.
 *
 * Inclusive at both ends, which is how people say it: a one-week course
 * starting Monday finishes on Sunday, not on the Monday after. Months are
 * added as calendar months and then backed off a day, so "three months from
 * 15 January" is 14 April however many days those months hold.
 */
function endOfCourse(startKey: string, spec: { days?: number; months?: number }): string {
  const end = fromKey(startKey);
  if (spec.days) end.setDate(end.getDate() + spec.days - 1);
  if (spec.months) {
    const day = end.getDate();
    end.setDate(1);
    end.setMonth(end.getMonth() + spec.months);
    // Clamped, so 31 January plus one month is 28 February rather than 3 March.
    end.setDate(Math.min(day, daysInMonth(end.getFullYear(), end.getMonth())));
    end.setDate(end.getDate() - 1);
  }
  return toKey(end);
}

const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

export type GroupDraft = Omit<Group, 'id'>;

export function GroupForm({
  title,
  submitLabel,
  initial,
  /**
   * The term this course is being created in, when the teacher said so by
   * tapping "add a course" on that term rather than "new group" on its own.
   */
  initialTerm,
  /** Rendered under the form — the danger zone on the edit screen. */
  footer,
  /** Blocks the submit while the caller is working — e.g. the online check. */
  busy,
  onSubmit,
}: {
  title: string;
  submitLabel: string;
  initial?: Group;
  initialTerm?: string;
  footer?: React.ReactNode;
  busy?: boolean;
  onSubmit: (draft: GroupDraft) => void;
}) {
  const { accents, color } = useTheme();
  const terms = useTerms();
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const insets = useSafeAreaInsets();
  const lift = useKeyboardLift();

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

  /*
    When the course runs.

    `startsOn` defaults to today for a new group, because a course a teacher is
    entering has almost always either just begun or is about to. `endsOn` starts
    empty, which means ongoing — the behaviour every group had before there were
    dates at all, and still the right answer for a tutor whose classes simply
    continue.
  */
  const [startsOn, setStartsOn] = useState(initial?.startsOn ?? toKey(new Date()));
  const [endsOn, setEndsOn] = useState<string | undefined>(initial?.endsOn);
  const [pickingDate, setPickingDate] = useState<'startsOn' | 'endsOn' | null>(null);

  /*
    Which intake this is.

    Held as a canonical `YYYY-season` key. Three sources, in order.

    A term the caller gave — which is what arriving from a term's own "add a
    course" does — is the answer, full stop. The teacher said which term by
    where they tapped, and having the start date quietly move the course into a
    different one would undo the thing they just did.

    A term already on the group is the same: their earlier answer, kept.

    Otherwise it follows the start date, because for a course entered on its own
    the season is simply the season the first class falls in, and asking would be
    asking them to repeat themselves. `touchedTerm` stops that default fighting
    them: until they pick by hand the date moves the term, and the moment they
    choose one it stays chosen.
  */
  const given = initial?.term ?? initialTerm;
  const [term, setTerm] = useState<string | undefined>(given ?? termOf(startsOn));
  const [touchedTerm, setTouchedTerm] = useState(!!given);
  const effectiveTerm = touchedTerm ? term : termOf(startsOn);

  /*
    Every term the teacher has, plus wherever this group currently sits.

    The list used to be four seasons around the start date, which was right when
    a term was only ever a by-product of a group. Now that terms are made on
    purpose, the ones they made are the ones to offer — otherwise a teacher who
    set up next autumn in advance could not put a course into it without first
    moving the start date there.

    `effectiveTerm` is folded in because it may be a term nobody has declared:
    the date-derived default on a new group, or the term an old group has been
    carrying since before any of this. A chip row that does not contain the
    selected chip reads as nothing being selected.
  */
  const termOptions = useMemo(
    () => [...new Set([...terms, ...(effectiveTerm ? [effectiveTerm] : [])])]
      .sort((a, b) => compareTerms(b, a)),
    [terms, effectiveTerm],
  );

  const dayLabels = weekdayInitials();
  const chosenDays = useMemo(() => DAY_NUMBERS.filter((d) => days[d]), [days]);

  /** Which duration chip, if any, matches the dates as they stand. */
  const activeDuration = useMemo(
    () => DURATIONS.find((d) => endsOn && endOfCourse(startsOn, d) === endsOn)?.key ?? null,
    [startsOn, endsOn],
  );
  // The wheel cannot produce a malformed time, so the only thing left to check
  // is that the teacher picked at least one day and named the thing.
  const ready =
    name.trim().length > 1 &&
    subject.trim().length > 1 &&
    chosenDays.length > 0 &&
    start < end &&
    // A course that ends before it begins is the one impossible pair. The end
    // picker refuses it too; this is the belt to that pair of braces.
    (!endsOn || endsOn >= startsOn);

  const submit = () => {
    const slots: Slot[] = chosenDays.map((d) => ({ day: d, start, end }));
    onSubmit({
      name: name.trim(),
      subject: subject.trim(),
      // Empty, not the words "No room": that string was being written into the
      // database and then shown verbatim, so it stayed English in every
      // language. Absence is a state, not a value.
      room: room.trim(),
      accent,
      slots,
      startsOn,
      endsOn,
      term: effectiveTerm,
    });
  };

  /** How many classes the course actually contains, once its dates are known. */
  const sessionCount = useMemo(() => {
    if (!endsOn || !chosenDays.length) return null;
    let n = 0;
    for (let d = fromKey(startsOn); toKey(d) <= endsOn; d.setDate(d.getDate() + 1)) {
      if (chosenDays.includes(d.getDay() as Weekday)) n += 1;
      // A mistyped year could otherwise walk a century a day at a time.
      if (n > 999) return null;
    }
    return n;
  }, [startsOn, endsOn, chosenDays]);

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
            // Plus whatever the keyboard is covering, so the bottom of the form
            // can still be scrolled to while it is up. Zero when it is down, and
            // zero on a window that resizes itself. See `useKeyboardLift`.
            paddingBottom: insets.bottom + 130 + lift,
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
            {DAY_NUMBERS.map((day, i) => {
              const on = !!days[day];
              return (
                <Press
                  key={day}
                  haptic
                  onPress={() => setDays((x) => ({ ...x, [day]: !x[day] }))}
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
                    {dayLabels[i]}
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

          <Overline style={styles.label}>{t('groups.term')}</Overline>
          {/*
            The intake this course belongs to, and the way it is moved to
            another one.

            Chips rather than a year-and-season wheel: the answer is nearly
            always already on screen, and two taps of a wheel to reach something
            you can see is two taps too many.
          */}
          <View style={styles.durationRow}>
            {termOptions.map((key) => {
              const on = effectiveTerm === key;
              return (
                <Press
                  key={key}
                  haptic
                  onPress={() => {
                    setTouchedTerm(true);
                    setTerm(key);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={[
                    styles.durationChip,
                    {
                      backgroundColor: on ? color.primaryTint : color.surface,
                      borderColor: on ? color.primary : color.border,
                    },
                  ]}>
                  <Text
                    style={[styles.durationLabel, { color: on ? color.primaryInk : color.inkSoft }]}>
                    {termLabel(key, t)}
                  </Text>
                </Press>
              );
            })}
          </View>

          <Overline style={styles.label}>{t('groups.runs')}</Overline>
          <Card style={styles.group}>
            <DateField
              label={t('groups.firstClass')}
              value={longDate(fromKey(startsOn))}
              onPress={() => setPickingDate('startsOn')}
            />
            <Divider inset={15} />
            <DateField
              label={t('groups.lastClass')}
              value={endsOn ? longDate(fromKey(endsOn)) : t('groups.ongoing')}
              muted={!endsOn}
              onPress={() => setPickingDate('endsOn')}
            />
          </Card>

          {/*
            Durations as shortcuts, not as the model.

            Tapping one sets the end date and the chip lights up because the
            dates happen to match it — so moving either date afterwards simply
            un-highlights the chip rather than leaving the form claiming a
            length it no longer has. "Ongoing" is the same control saying there
            is no end, which is a real answer and not a missing one.
          */}
          <View style={styles.durationRow}>
            {DURATIONS.map((d) => {
              const on = activeDuration === d.key;
              return (
                <Press
                  key={d.key}
                  haptic
                  onPress={() => setEndsOn(endOfCourse(startsOn, d))}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={[
                    styles.durationChip,
                    {
                      backgroundColor: on ? color.primaryTint : color.surface,
                      borderColor: on ? color.primary : color.border,
                    },
                  ]}>
                  <Text
                    style={[styles.durationLabel, { color: on ? color.primaryInk : color.inkSoft }]}>
                    {t(d.labelKey)}
                  </Text>
                </Press>
              );
            })}
            <Press
              haptic
              onPress={() => setEndsOn(undefined)}
              accessibilityRole="radio"
              accessibilityState={{ selected: !endsOn }}
              style={[
                styles.durationChip,
                {
                  backgroundColor: !endsOn ? color.primaryTint : color.surface,
                  borderColor: !endsOn ? color.primary : color.border,
                },
              ]}>
              <Text
                style={[styles.durationLabel, { color: !endsOn ? color.primaryInk : color.inkSoft }]}>
                {t('groups.ongoing')}
              </Text>
            </Press>
          </View>

          {/* The number the teacher is really deciding: how many lessons. */}
          <Text style={styles.runsHint}>
            {sessionCount !== null
              ? t('groups.classesInCourse', { count: sessionCount })
              : t('groups.ongoingHint')}
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

      <DatePicker
        visible={pickingDate !== null}
        title={t(pickingDate === 'endsOn' ? 'groups.lastClass' : 'groups.firstClass')}
        value={pickingDate === 'endsOn' ? endsOn : startsOn}
        // A course runs now or soon, so the year list has to reach forwards —
        // the default is a birthday's, ninety years of the past and none ahead.
        yearsBack={4}
        yearsForward={6}
        opensOn={new Date()}
        onClose={() => setPickingDate(null)}
        onPick={(key) => {
          if (pickingDate === 'endsOn') {
            // An end before the start is not a date the teacher can have meant.
            setEndsOn(key < startsOn ? startsOn : key);
          } else {
            setStartsOn(key);
            // Drag the end along rather than leave an impossible pair on screen,
            // matching what the time fields above already do.
            if (endsOn && endsOn < key) setEndsOn(key);
          }
          setPickingDate(null);
        }}
      />

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

    /*
      One row, always.

      Seven chips at a fixed 46 wide plus six 8pt gaps came to 370, which is
      more than the gutters leave on any phone this app runs on — so the week
      wrapped, and Sunday sat alone on a second line looking like a different
      control. The chips share the row instead: no wrapping, and they narrow to
      fit whatever the screen gives them.
    */
    dayRow: { flexDirection: 'row', flexWrap: 'nowrap', gap: 6, marginBottom: 22 },
    dayChip: {
      flex: 1,
      minWidth: 0,
      height: 42,
      borderRadius: radius.field,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayLabel: { fontFamily: body[600], fontSize: 12.5 },

    durationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    durationChip: {
      paddingHorizontal: 14,
      height: 38,
      borderRadius: radius.field,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    durationLabel: { fontFamily: body[700], fontSize: 12.5 },
    runsHint: {
      fontFamily: body[400],
      fontSize: 12.5,
      color: color.mutedLight,
      marginTop: 10,
      marginBottom: 22,
    },

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

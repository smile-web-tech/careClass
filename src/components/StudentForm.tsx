/**
 * The student form, shared by "New student" and "Edit student".
 *
 * One component rather than two screens so the two can never drift — an edit
 * screen that offers fewer fields than the create screen is a trap, because the
 * teacher can set something they then cannot change. That trap is exactly how
 * the parent email field would have been useless on day one: every student
 * already on the roster was created before it existed.
 */
import { useState } from 'react';
import * as Crypto from 'expo-crypto';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showError } from '@/components/Dialog';
import { DatePicker } from '@/components/DatePicker';
import { StudentPhotoPicker } from '@/components/StudentPhotoPicker';
import { useT } from '@/i18n/useT';
import { pickContact, pickPhoneNumber } from '@/lib/contactPicker';
import { Icon } from '@/components/Icon';
import { Screen, StickyFooter, TopBar } from '@/components/layout';
import { Button, Card, Divider, FieldRow, Overline, Press, SelectChip } from '@/components/ui';
import { useAllGroups, useGroups } from '@/data/store';
import type { Gender, Group, Student } from '@/data/types';
import { baseForLevel, levelOf } from '@/lib/courses';
import { genderFromSurname, givenOf, joinName, splitName } from '@/lib/names';
import { ageFrom, fromKey, longDate } from '@/lib/date';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body } from '@/theme/type';

export type StudentDraft = {
  /**
   * Minted by the form rather than by the store.
   *
   * A photo can be taken before the student is saved, and it is stored under
   * this id — so the id has to exist first, and has to be the one the row ends
   * up with.
   */
  id: string;
  name: string;
  surname?: string;
  phone: string;
  email?: string;
  birthDate?: string;
  address?: string;
  school?: string;
  /** The stored base, not the level. See `lib/courses.ts`. */
  levelBase?: number;
  gender?: Gender;
  documentId?: string;
  parentName?: string;
  parentPhone?: string;
  parentEmail?: string;
  parentWork?: string;
  parent2Name?: string;
  parent2Phone?: string;
  parent2Email?: string;
  parent2Work?: string;
  groupIds: string[];
};

const blank = {
  given: '',
  surname: '',
  phone: '',
  email: '',
  address: '',
  school: '',
  level: '',
  documentId: '',
  parentName: '',
  parentPhone: '',
  parentEmail: '',
  parentWork: '',
  parent2Name: '',
  parent2Phone: '',
  parent2Email: '',
  parent2Work: '',
};

const fieldsOf = (initial: Student | undefined, allGroups: Group[]) => ({
  // Seeded by splitting the stored full name for anyone entered before the
  // surname field existed, which is the same split `surnameOf` reads.
  given: initial ? (initial.surname ? givenOf(initial) : splitName(initial.name).given) : '',
  surname: initial?.surname ?? (initial ? splitName(initial.name).surname : ''),
  phone: initial?.phone ?? '',
  email: initial?.email ?? '',
  address: initial?.address ?? '',
  school: initial?.school ?? '',
  // The number a teacher means by "level", not what is stored behind it. Blank
  // for a new student, who has no history for it to be counted from.
  level: initial ? String(levelOf(initial, allGroups)) : '',
  documentId: initial?.documentId ?? '',
  parentName: initial?.parentName ?? '',
  parentPhone: initial?.parentPhone ?? '',
  parentEmail: initial?.parentEmail ?? '',
  parentWork: initial?.parentWork ?? '',
  parent2Name: initial?.parent2Name ?? '',
  parent2Phone: initial?.parent2Phone ?? '',
  parent2Email: initial?.parent2Email ?? '',
  parent2Work: initial?.parent2Work ?? '',
});

export function StudentForm({
  title,
  submitLabel,
  initial,
  /** Groups ticked before the teacher touches anything — "add to this group". */
  preselectGroups = [],
  /** Rendered under the form: the welcome toggle on create, danger zone on edit. */
  extra,
  secondary,
  /** Blocks the submit while the caller is working — e.g. the online check. */
  busy,
  onSubmit,
}: {
  title: string;
  submitLabel: string;
  initial?: Student;
  preselectGroups?: string[];
  extra?: React.ReactNode;
  /**
   * "Save & add another". The form clears itself only if this resolves truthy,
   * so a save refused for being offline leaves the typed details in place.
   */
  secondary?: { label: string; onPress: (draft: StudentDraft) => boolean | Promise<boolean> };
  busy?: boolean;
  onSubmit: (draft: StudentDraft) => void;
}) {
  const { accents, color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const insets = useSafeAreaInsets();

  const groups = useGroups();
  // Every group for the level, active ones for the picker: a finished course
  // still counts towards how many they have done, but you do not enrol anyone
  // into it.
  const allGroups = useAllGroups();

  const [form, setForm] = useState(() => fieldsOf(initial, allGroups));
  const [draftId] = useState(() => initial?.id ?? Crypto.randomUUID());
  /** Held apart from `form`: it is a date, not typed text. */
  const [birthDate, setBirthDate] = useState(initial?.birthDate ?? '');
  /** Also apart, and also not typed: two chips, either of which can be off. */
  const [gender, setGender] = useState<Gender | undefined>(initial?.gender);
  const [pickingDate, setPickingDate] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    for (const id of initial?.groupIds ?? preselectGroups) out[id] = true;
    return out;
  });

  const set = (k: keyof typeof blank) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  /*
    A name, and that is all.

    This used to demand a phone number of more than five characters as well,
    and the Save button simply sat there greyed out saying nothing — which
    reads as a broken button, not as a validation message. Plenty of students
    have no phone of their own and are reached through a parent, and plenty are
    added mid-lesson to be filled in later. Nothing downstream needs a number:
    the composer skips recipients without one and says how many it skipped.
  */
  const ready = joinName(form.given, form.surname).trim().length > 1;
  const groupIds = groups.filter((g) => picked[g.id]).map((g) => g.id);

  const trimmed = (v: string) => v.trim() || undefined;
  const draft = (): StudentDraft => ({
    id: draftId,
    name: joinName(form.given, form.surname),
    surname: trimmed(form.surname),
    phone: form.phone.trim(),
    email: trimmed(form.email),
    // Undefined rather than '' when cleared, so the column goes back to null
    // instead of holding an empty string that reads as "set to nothing".
    birthDate: birthDate || undefined,
    address: trimmed(form.address),
    school: trimmed(form.school),
    /*
      What the teacher chose, or what the surname says when they chose nothing.

      Never the other way round: a chip that has been tapped is a fact and the
      ending is a guess, and the endings do not cover every name. Inferring at
      save rather than while typing means the guess appears once, on a complete
      surname, instead of flickering through male and female as the letters go
      in.
    */
    gender: gender ?? genderFromSurname(form.surname),
    documentId: trimmed(form.documentId),
    /*
      Stored as the base, not as the number typed.

      `baseForLevel` subtracts the courses this app can already count, so the
      level reads as typed today and still climbs when their next course ends.
      A blank field means "do not correct anything", which is a base of zero and
      a level that is purely counted.
    */
    levelBase: form.level.trim() ? baseForLevel(Number(form.level), { groupIds }, allGroups) : 0,
    parentName: trimmed(form.parentName),
    parentPhone: trimmed(form.parentPhone),
    parentEmail: trimmed(form.parentEmail),
    parentWork: trimmed(form.parentWork),
    parent2Name: trimmed(form.parent2Name),
    parent2Phone: trimmed(form.parent2Phone),
    parent2Email: trimmed(form.parent2Email),
    parent2Work: trimmed(form.parent2Work),
    groupIds,
  });

  /*
    Fill the whole form from one contact.

    Rewritten off `presentContactPickerAsync`, which is not merely deprecated in
    SDK 57 — it throws the moment it is called, so this button had been dead for
    as long as the app has been on this SDK. `Contact.presentPicker` is the
    replacement, and it needs no permission of its own: the teacher picks the
    one contact, which is the whole consent.

    Each field fills only where there is nothing better already — a name the
    teacher has typed is not overwritten by whatever the address book calls
    that person.
  */
  const importFromContacts = async () => {
    try {
      const picked = await pickContact();
      if (!picked) return;

      setForm((f) => {
        // A contact arrives as one string, so it is split the same way a name
        // typed before the two fields existed is — last word to the surname.
        const split = picked.name ? splitName(picked.name) : null;
        return {
          ...f,
          given: split ? split.given : f.given,
          surname: split && split.surname ? split.surname : f.surname,
          phone: picked.phone ?? f.phone,
          email: picked.email ?? f.email,
        };
      });
    } catch (e) {
      showError(e, t('students.contactsNeeded'));
    }
  };

  /**
   * Put one number into one field, and touch nothing else.
   *
   * Parameterised by field because the form has three phone rows — the
   * student's and both parents' — and every one of them wants this. The name
   * attached to the number is deliberately discarded: the teacher is standing
   * on the mother's row and already knows whose number they are fetching.
   */
  const numberAction = (field: 'phone' | 'parentPhone' | 'parent2Phone') => ({
    icon: 'contacts' as const,
    label: t('contacts.pickNumber'),
    onPress: () => {
      void (async () => {
        try {
          const number = await pickPhoneNumber();
          if (number) setForm((f) => ({ ...f, [field]: number }));
        } catch (e) {
          showError(e, t('students.contactsNeeded'));
        }
      })();
    },
  });

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
            paddingBottom: insets.bottom + 140,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <StudentPhotoPicker studentId={draftId} name={joinName(form.given, form.surname)} />

          <Press onPress={importFromContacts}>
            <Card style={styles.importCard}>
              <View style={styles.importIcon}>
                <Icon name="contacts" size={19} color={color.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.importTitle}>{t('students.importContacts')}</Text>
                <Text style={styles.importHint}>{t('students.importHint')}</Text>
              </View>
              <Icon name="disclosure" size={16} color={color.chevron} />
            </Card>
          </Press>

          <Overline style={styles.label}>{t('nav.students')}</Overline>
          <Card style={styles.group}>
            {/*
              Given name and surname apart, because the surname is doing a job.

              A Turkmen surname carries the gender in its ending, and reading
              that off the last word of a single free-text field guesses wrong
              on anyone with two given names. Two fields make the same typing
              produce a fact the app can use.
            */}
            <FieldRow
              label={t('students.givenName')}
              placeholder={t('students.givenNamePlaceholder')}
              value={form.given}
              onChangeText={set('given')}
              autoCapitalize="words"
              autoCorrect={false}
            />
            <Divider inset={15} />
            <FieldRow
              label={t('students.surname')}
              placeholder={t('students.surnamePlaceholder')}
              value={form.surname}
              onChangeText={set('surname')}
              autoCapitalize="words"
              autoCorrect={false}
            />
            <Divider inset={15} />
            <FieldRow
              label={t('students.phone')}
              placeholder="+993 65 000000"
              value={form.phone}
              onChangeText={set('phone')}
              keyboardType="phone-pad"
              action={numberAction('phone')}
            />
            <Divider inset={15} />
            <FieldRow
              label={t('students.email')}
              placeholder={t('students.studentEmailHint')}
              value={form.email}
              onChangeText={set('email')}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Card>

          {/*
            Everything a tutor keeps that is not a way to contact somebody. The
            birthday is first because it is the one the app does something with
            on its own.
          */}
          <Overline style={styles.label}>{t('student.details')}</Overline>
          <Card style={styles.group}>
            <Press onPress={() => setPickingDate(true)} style={styles.dateRow}>
              <Text style={styles.dateLabel}>{t('student.birthDate')}</Text>
              <View style={styles.dateValueWrap}>
                <Text style={[styles.dateValue, !birthDate && { color: color.mutedLight }]}>
                  {birthDate ? longDate(fromKey(birthDate)) : t('student.noBirthDate')}
                </Text>
                <Icon name="tabCalendar" size={15} color={color.mutedLight} />
              </View>
            </Press>
            {birthDate ? (
              <>
                <Divider inset={15} />
                <View style={styles.hintRow}>
                  <Text style={styles.hintText}>
                    {`${t('student.age', { age: ageFrom(birthDate) })} · ${t('student.birthdayReminder')}`}
                  </Text>
                </View>
              </>
            ) : null}
            <Divider inset={15} />
            {/*
              Two chips, and tapping the chosen one again clears it.

              A toggle would force one of the two on every student, and plenty
              arrive from a spreadsheet that never carried it. Absent has to
              stay reachable, or the filter's "not recorded" bucket becomes a
              list of children the teacher was made to guess about.
            */}
            <View style={styles.genderRow}>
              <Text style={styles.dateLabel}>{t('student.gender')}</Text>
              <View style={styles.genderChips}>
                {(['female', 'male'] as const).map((g) => (
                  <SelectChip
                    key={g}
                    height={34}
                    label={t(g === 'male' ? 'students.male' : 'students.female')}
                    selected={gender === g}
                    onPress={() => setGender((cur) => (cur === g ? undefined : g))}
                  />
                ))}
              </View>
            </View>
            <Divider inset={15} />
            <FieldRow
              label={t('student.school')}
              placeholder={t('common.optional')}
              value={form.school}
              onChangeText={set('school')}
              autoCapitalize="words"
            />
            <Divider inset={15} />
            <FieldRow
              label={t('student.address')}
              placeholder={t('common.optional')}
              value={form.address}
              onChangeText={set('address')}
              autoCapitalize="sentences"
            />
            <Divider inset={15} />
            {/*
              Editable, because a student who did two courses at another tutor's
              is a level 2 on the day they arrive and nothing in this app can
              know that. What is typed here is the level itself; the app works
              out what to store so the number keeps climbing on its own.
            */}
            <FieldRow
              label={t('student.level')}
              placeholder={t('student.levelPlaceholder')}
              value={form.level}
              onChangeText={(v) => set('level')(v.replace(/[^0-9]/g, '').slice(0, 2))}
              keyboardType="number-pad"
              autoCorrect={false}
            />
            <Divider inset={15} />
            <FieldRow
              label={t('student.documentId')}
              placeholder={t('common.optional')}
              value={form.documentId}
              onChangeText={set('documentId')}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </Card>

          <Overline style={styles.label}>{t('student.mother')}</Overline>
          <Card style={styles.group}>
            <FieldRow
              label={t('students.name')}
              placeholder={t('common.optional')}
              value={form.parentName}
              onChangeText={set('parentName')}
              autoCapitalize="words"
            />
            <Divider inset={15} />
            <FieldRow
              label={t('students.phone')}
              placeholder="+993 65 000000"
              value={form.parentPhone}
              onChangeText={set('parentPhone')}
              keyboardType="phone-pad"
              action={numberAction('parentPhone')}
            />
            <Divider inset={15} />
            <FieldRow
              label={t('students.email')}
              placeholder={t('students.parentEmailHint')}
              value={form.parentEmail}
              onChangeText={set('parentEmail')}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Divider inset={15} />
            <FieldRow
              label={t('student.work')}
              placeholder={t('common.optional')}
              value={form.parentWork}
              onChangeText={set('parentWork')}
              autoCapitalize="sentences"
            />
          </Card>

          <Overline style={styles.label}>{t('student.father')}</Overline>
          <Card style={styles.group}>
            <FieldRow
              label={t('students.name')}
              placeholder={t('common.optional')}
              value={form.parent2Name}
              onChangeText={set('parent2Name')}
              autoCapitalize="words"
            />
            <Divider inset={15} />
            <FieldRow
              label={t('students.phone')}
              placeholder="+993 65 000000"
              value={form.parent2Phone}
              onChangeText={set('parent2Phone')}
              keyboardType="phone-pad"
              action={numberAction('parent2Phone')}
            />
            <Divider inset={15} />
            <FieldRow
              label={t('students.email')}
              placeholder={t('students.parentEmailHint')}
              value={form.parent2Email}
              onChangeText={set('parent2Email')}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Divider inset={15} />
            <FieldRow
              label={t('student.work')}
              placeholder={t('common.optional')}
              value={form.parent2Work}
              onChangeText={set('parent2Work')}
              autoCapitalize="sentences"
            />
          </Card>

          <Overline style={styles.label}>{t('students.addToGroups')}</Overline>
          <View style={styles.chipWrap}>
            {groups.map((g) => (
              <SelectChip
                key={g.id}
                label={g.name}
                dot={accents[g.accent].dot}
                height={42}
                selected={!!picked[g.id]}
                onPress={() => setPicked((p) => ({ ...p, [g.id]: !p[g.id] }))}
              />
            ))}
          </View>

          {extra}
        </ScrollView>
      </KeyboardAvoidingView>

      <DatePicker
        visible={pickingDate}
        value={birthDate || undefined}
        title={t('student.birthDatePick')}
        onClose={() => setPickingDate(false)}
        onPick={setBirthDate}
      />

      <StickyFooter style={{ gap: 10 }}>
        {/* Say why the button is off. A disabled control with no explanation is
            indistinguishable from one that does not work. */}
        {!ready ? <Text style={styles.blocker}>{t('students.needName')}</Text> : null}
        {secondary ? (
          <Press
            onPress={async () => {
              if (!(await secondary.onPress(draft()))) return;
              setForm(blank);
              setPicked({});
            }}
            disabled={!ready || busy}
            style={styles.secondarySave}>
            <Text style={styles.secondarySaveLabel}>{secondary.label}</Text>
          </Press>
        ) : null}
        <Button
          grow
          label={submitLabel}
          height={50}
          onPress={() => onSubmit(draft())}
          disabled={!ready || busy}
        />
      </StickyFooter>
    </Screen>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    label: { marginBottom: 10 },

    importCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: 15,
      paddingVertical: 13,
      marginBottom: 22,
    },
    importIcon: {
      width: 44,
      height: 44,
      borderRadius: radius.button,
      backgroundColor: color.primaryTint,
      alignItems: 'center',
      justifyContent: 'center',
    },
    importTitle: { fontFamily: body[700], fontSize: 14.5, color: color.ink },
    importHint: {
      fontFamily: body[400],
      fontSize: 12.5,
      color: color.mutedLight,
      marginTop: 2,
    },

    group: { overflow: 'hidden', marginBottom: 22 },
    chipWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 22,
    },

    dateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 15,
      paddingVertical: 14,
      gap: 12,
    },
    dateLabel: { fontFamily: body[600], fontSize: 14, color: color.inkSoft },

    genderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 15,
      paddingVertical: 10,
      gap: 12,
    },
    genderChips: { flexDirection: 'row', gap: 8 },
    dateValueWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
    dateValue: { fontFamily: body[600], fontSize: 14, color: color.ink },

    hintRow: { paddingHorizontal: 15, paddingVertical: 10 },
    hintText: { fontFamily: body[400], fontSize: 12, lineHeight: 17, color: color.mutedLight },

    secondarySave: {
      height: 50,
      paddingHorizontal: 20,
      borderRadius: radius.button,
      backgroundColor: color.fill,
      borderWidth: 1,
      borderColor: color.border,
      justifyContent: 'center',
    },
    secondarySaveLabel: {
      fontFamily: body[600],
      fontSize: 14.5,
      color: color.inkSoft,
    },
    blocker: {
      fontFamily: body[600],
      fontSize: 12.5,
      color: color.mutedLight,
      textAlign: 'center',
    },
  });

/**
 * The student form, shared by "New student" and "Edit student".
 *
 * One component rather than two screens so the two can never drift — an edit
 * screen that offers fewer fields than the create screen is a trap, because the
 * teacher can set something they then cannot change. That trap is exactly how
 * the parent email field would have been useless on day one: every student
 * already on the roster was created before it existed.
 */
import * as Contacts from 'expo-contacts';
import { useState } from 'react';
import * as Crypto from 'expo-crypto';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showAlert } from '@/components/Dialog';
import { DatePicker } from '@/components/DatePicker';
import { StudentPhotoPicker } from '@/components/StudentPhotoPicker';
import { useT } from '@/i18n/useT';
import { Icon } from '@/components/Icon';
import { Screen, StickyFooter, TopBar } from '@/components/layout';
import { Button, Card, Divider, FieldRow, Overline, Press, SelectChip } from '@/components/ui';
import { useGroups } from '@/data/store';
import type { Student } from '@/data/types';
import { fromKey, longDate } from '@/lib/date';
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
  phone: string;
  email?: string;
  birthDate?: string;
  address?: string;
  school?: string;
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
  name: '',
  phone: '',
  email: '',
  address: '',
  school: '',
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

/** Whole years, counting the birthday that has not happened yet as not counted. */
function ageFrom(birthDate: string): number {
  const born = fromKey(birthDate);
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const beforeBirthday =
    now.getMonth() < born.getMonth() ||
    (now.getMonth() === born.getMonth() && now.getDate() < born.getDate());
  if (beforeBirthday) age -= 1;
  return Math.max(0, age);
}

const fieldsOf = (initial?: Student) => ({
  name: initial?.name ?? '',
  phone: initial?.phone ?? '',
  email: initial?.email ?? '',
  address: initial?.address ?? '',
  school: initial?.school ?? '',
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

  const [form, setForm] = useState(() => fieldsOf(initial));
  const [draftId] = useState(() => initial?.id ?? Crypto.randomUUID());
  /** Held apart from `form`: it is a date, not typed text. */
  const [birthDate, setBirthDate] = useState(initial?.birthDate ?? '');
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
  const ready = form.name.trim().length > 1;
  const groupIds = groups.filter((g) => picked[g.id]).map((g) => g.id);

  const trimmed = (v: string) => v.trim() || undefined;
  const draft = (): StudentDraft => ({
    id: draftId,
    name: form.name.trim(),
    phone: form.phone.trim(),
    email: trimmed(form.email),
    // Undefined rather than '' when cleared, so the column goes back to null
    // instead of holding an empty string that reads as "set to nothing".
    birthDate: birthDate || undefined,
    address: trimmed(form.address),
    school: trimmed(form.school),
    documentId: trimmed(form.documentId),
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

  const importFromContacts = async () => {
    const { granted } = await Contacts.requestPermissionsAsync();
    if (!granted) {
      showAlert(t('students.contactsNeeded'), t('students.contactsNeededMessage'));
      return;
    }

    const contact = await Contacts.presentContactPickerAsync();
    if (!contact) return;

    setForm((f) => ({
      ...f,
      name: contact.name ?? f.name,
      phone: contact.phoneNumbers?.[0]?.number?.trim() ?? f.phone,
      email: contact.emails?.[0]?.email ?? f.email,
    }));
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
            paddingBottom: insets.bottom + 140,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <StudentPhotoPicker studentId={draftId} name={form.name} />

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
            <FieldRow
              label={t('students.name')}
              placeholder={t('auth.fullName')}
              value={form.name}
              onChangeText={set('name')}
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
            <FieldRow
              label={t('student.documentId')}
              placeholder={t('common.optional')}
              value={form.documentId}
              onChangeText={set('documentId')}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </Card>

          <Overline style={styles.label}>{t('student.parent1')}</Overline>
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

          <Overline style={styles.label}>{t('student.parent2')}</Overline>
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

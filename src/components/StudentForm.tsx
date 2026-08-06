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
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showAlert } from '@/components/Dialog';
import { useT } from '@/i18n/useT';
import { Icon } from '@/components/Icon';
import { Screen, StickyFooter, TopBar } from '@/components/layout';
import { Button, Card, Divider, FieldRow, Overline, Press, SelectChip } from '@/components/ui';
import { useGroups } from '@/data/store';
import type { Student } from '@/data/types';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body } from '@/theme/type';

export type StudentDraft = {
  name: string;
  phone: string;
  email?: string;
  parentName?: string;
  parentPhone?: string;
  parentEmail?: string;
  groupIds: string[];
};

const blank = {
  name: '',
  phone: '',
  email: '',
  parentName: '',
  parentPhone: '',
  parentEmail: '',
};

const fieldsOf = (initial?: Student) => ({
  name: initial?.name ?? '',
  phone: initial?.phone ?? '',
  email: initial?.email ?? '',
  parentName: initial?.parentName ?? '',
  parentPhone: initial?.parentPhone ?? '',
  parentEmail: initial?.parentEmail ?? '',
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
  const [picked, setPicked] = useState<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    for (const id of initial?.groupIds ?? preselectGroups) out[id] = true;
    return out;
  });

  const set = (k: keyof typeof blank) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const ready = form.name.trim().length > 1 && form.phone.trim().length > 5;
  const groupIds = groups.filter((g) => picked[g.id]).map((g) => g.id);

  const trimmed = (v: string) => v.trim() || undefined;
  const draft = (): StudentDraft => ({
    name: form.name.trim(),
    phone: form.phone.trim(),
    email: trimmed(form.email),
    parentName: trimmed(form.parentName),
    parentPhone: trimmed(form.parentPhone),
    parentEmail: trimmed(form.parentEmail),
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

          <Overline style={styles.label}>{t('students.parentSection')}</Overline>
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

      <StickyFooter style={{ gap: 10 }}>
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
  });

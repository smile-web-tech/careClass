/**
 * Record marks for one assessment.
 *
 * The whole class on one screen, because that is how a teacher works from a
 * pile of papers — down the list, one number each. Nothing is required: a blank
 * box means "did not sit it", which is a real state and must not become a zero.
 *
 * Passing `id` reopens an existing assessment, which is how a mis-typed mark
 * gets corrected. The server upserts on (assessment, student), so re-saving is
 * a correction rather than a duplicate.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirm, showAlert } from '@/components/Dialog';
import { Icon } from '@/components/Icon';
import { Screen, StickyFooter, TopBar } from '@/components/layout';
import {
  Avatar,
  Button,
  Card,
  Divider,
  FieldRow,
  Overline,
  Press,
  SelectChip,
} from '@/components/ui';
import { useStore, useStudents } from '@/data/store';
import type { Assessment } from '@/data/types';
import { useT } from '@/i18n/useT';
import { assessmentKindLabel, starterTypeNames } from '@/lib/assessmentKind';
import { toKey } from '@/lib/date';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, text } from '@/theme/type';
import * as Crypto from 'expo-crypto';

export default function RecordGrades() {
  const t = useT();
  const { color, scheme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ group?: string; id?: string }>();

  const students = useStudents();
  const groups = useStore((s) => s.groups);
  const assessments = useStore((s) => s.assessments);
  const grades = useStore((s) => s.grades);
  const saveAssessment = useStore((s) => s.saveAssessment);

  const existing = assessments.find((a) => a.id === params.id);
  const groupId = existing?.groupId ?? params.group ?? '';
  const group = groups.find((g) => g.id === groupId);

  const roster = useMemo(
    () => students.filter((s) => s.groupIds.includes(groupId)),
    [groupId, students],
  );

  /*
    The kinds this group uses, in the teacher's own order.

    A group with none of its own falls back to the three the app used to
    hardcode, offered as suggestions rather than seeded rows: a group nobody
    ever assesses should not accumulate three types nobody asked for, and a
    teacher who changes language would otherwise be stuck with the old one's
    words.
  */
  const types = useStore((s) => s.assessmentTypes);
  const addAssessmentType = useStore((s) => s.addAssessmentType);
  const removeAssessmentType = useStore((s) => s.removeAssessmentType);

  const groupTypes = useMemo(
    () => types.filter((x) => x.groupId === groupId).sort((a, b) => a.position - b.position),
    [groupId, types],
  );
  const starters = useMemo(() => (groupTypes.length ? [] : starterTypeNames(t)), [groupTypes, t]);
  const choices = groupTypes.length ? groupTypes.map((x) => x.name) : starters;

  const [kindLabel, setKindLabel] = useState(
    () => existing?.kindLabel ?? (existing ? assessmentKindLabel(existing, t) : ''),
  );
  /** Open only while a new type is being typed. */
  const [newType, setNewType] = useState<string | null>(null);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [maxScore, setMaxScore] = useState(String(existing?.maxScore ?? 100));
  const [saving, setSaving] = useState(false);

  // Kept as strings while typing: "" is "no mark", and a number cannot hold
  // that distinction. Parsed once, at save.
  const [scores, setScores] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    if (existing) {
      for (const g of grades.filter((x) => x.assessmentId === existing.id)) {
        out[g.studentId] = String(g.score);
      }
    }
    return out;
  });

  const max = Number(maxScore);
  const maxValid = Number.isFinite(max) && max > 0;

  const entered = Object.entries(scores).filter(([, v]) => v.trim() !== '');
  const invalid = entered.filter(([, v]) => {
    const n = Number(v);
    return !Number.isFinite(n) || n < 0 || (maxValid && n > max);
  });

  /** Falls back to the first choice so a teacher who ignores the row is fine. */
  const chosenKind = kindLabel.trim() || choices[0] || '';

  const ready = title.trim().length > 1 && maxValid && entered.length > 0 && invalid.length === 0;

  /**
   * Add a type to this group.
   *
   * Written the moment it is named rather than when the assessment is saved:
   * the teacher is setting up how they mark this class, and that should survive
   * them backing out of a paper they decided not to enter after all.
   */
  const commitNewType = () => {
    const name = (newType ?? '').trim();
    if (name.length < 1) {
      setNewType(null);
      return;
    }
    if (groupTypes.some((x) => x.name.toLowerCase() === name.toLowerCase())) {
      setKindLabel(name);
      setNewType(null);
      return;
    }

    // The first custom type on a group that was showing the starters has to
    // bring them with it, or naming "Test 1" would silently delete Quiz, Exam
    // and Final from the picker.
    if (!groupTypes.length) {
      for (const starter of starters) addAssessmentType(groupId, starter);
    }
    addAssessmentType(groupId, name);
    setKindLabel(name);
    setNewType(null);
  };

  const removeType = async (name: string) => {
    const type = groupTypes.find((x) => x.name === name);
    if (!type) return;

    const yes = await confirm({
      title: t('grades.typeDeleteTitle', { name }),
      // Past papers keep their label, so this is not the alarming delete it
      // looks like. Say so.
      message: t('grades.typeDeleteHint'),
      confirmLabel: t('common.delete'),
    });
    if (!yes) return;

    removeAssessmentType(type.id);
    if (kindLabel === name) setKindLabel('');
  };

  const save = async () => {
    if (!ready || !groupId) return;

    const assessment: Assessment = {
      id: existing?.id ?? Crypto.randomUUID(),
      groupId,
      // The enum is only kept so rows written before custom types still read
      // correctly. Nothing new is filed under it.
      kind: null,
      kindLabel: chosenKind,
      title: title.trim(),
      maxScore: max,
      takenOn: existing?.takenOn ?? toKey(new Date()),
    };

    saveAssessment(
      assessment,
      entered.map(([studentId, v]) => ({ studentId, score: Number(v) })),
    );
    router.back();
  };

  if (!group) {
    return (
      <Screen>
        <TopBar title={t('grades.recordMarks')} dismiss />
        <View style={styles.missing}>
          <Text style={styles.missingText}>{t('groups.gone')}</Text>
          <Button label={t('common.goBack')} variant="ghost" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar title={t(existing ? 'grades.editMarks' : 'grades.recordMarks')} dismiss />

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
          <Overline style={styles.label}>{t('grades.assessment')}</Overline>
          {/*
            Chips rather than a segmented control: the set is the teacher's own
            and has no fixed length, and five tests plus a final does not fit in
            three equal slots. Long-press removes one, which keeps the row clean
            for the common case of just picking.
          */}
          <View style={styles.typeRow}>
            {choices.map((name) => (
              <SelectChip
                key={name}
                label={name}
                height={40}
                selected={chosenKind === name}
                onPress={() => setKindLabel(name)}
                onLongPress={groupTypes.length ? () => void removeType(name) : undefined}
              />
            ))}

            {newType === null ? (
              <Press onPress={() => setNewType('')} style={styles.addType}>
                <Icon name="plus" size={14} color={color.primary} />
                <Text style={styles.addTypeLabel}>{t('grades.typeAdd')}</Text>
              </Press>
            ) : (
              <View style={styles.newTypeRow}>
                <TextInput
                  value={newType}
                  onChangeText={setNewType}
                  autoFocus
                  placeholder={t('grades.typeNameHint')}
                  placeholderTextColor={color.mutedLight}
                  style={styles.newTypeInput}
                  returnKeyType="done"
                  onSubmitEditing={commitNewType}
                  onBlur={commitNewType}
                  selectionColor={color.primary}
                  keyboardAppearance={scheme === 'dark' ? 'dark' : 'light'}
                />
              </View>
            )}
          </View>
          {groupTypes.length ? (
            <Text style={styles.typeHint}>{t('grades.typeLongPress')}</Text>
          ) : null}

          <Card style={styles.group}>
            <FieldRow
              label={t('grades.assessmentTitle')}
              placeholder={t('grades.assessmentTitleHint')}
              value={title}
              onChangeText={setTitle}
              autoCapitalize="sentences"
            />
            <Divider inset={15} />
            <FieldRow
              label={t('grades.outOf')}
              placeholder="100"
              value={maxScore}
              onChangeText={setMaxScore}
              keyboardType="numeric"
            />
          </Card>
          {!maxValid ? <Text style={styles.error}>{t('grades.maxScoreError')}</Text> : null}

          <View style={styles.rosterHead}>
            <Overline>{group.name}</Overline>
            <Text style={styles.rosterCount}>
              {t('grades.marked', { count: entered.length, total: roster.length })}
            </Text>
          </View>

          <Card style={{ overflow: 'hidden' }}>
            {roster.map((s, i) => {
              const value = scores[s.id] ?? '';
              const n = Number(value);
              const bad =
                value.trim() !== '' && (!Number.isFinite(n) || n < 0 || (maxValid && n > max));

              return (
                <View key={s.id}>
                  {i > 0 ? <Divider inset={62} /> : null}
                  <View style={styles.scoreRow}>
                    <Avatar
                      name={s.name}
                      accent={s.accent}
                      size={38}
                      radius={radius.control}
                      fontSize={13}
                    />
                    <Text style={styles.studentName} numberOfLines={1}>
                      {s.name}
                    </Text>
                    <TextInput
                      value={value}
                      onChangeText={(v) => setScores((prev) => ({ ...prev, [s.id]: v }))}
                      placeholder="·"
                      placeholderTextColor={color.faint}
                      keyboardType="numeric"
                      selectionColor={color.primary}
                      keyboardAppearance={scheme === 'dark' ? 'dark' : 'light'}
                      style={[
                        styles.scoreInput,
                        {
                          borderColor: bad ? color.danger : color.border,
                          color: bad ? color.dangerDeep : color.ink,
                        },
                      ]}
                    />
                    <Text style={styles.outOf}>/ {maxValid ? max : '·'}</Text>
                  </View>
                </View>
              );
            })}
          </Card>

          {invalid.length ? (
            <Text style={styles.error}>
              {t('grades.outsideRange', { count: invalid.length, max: maxValid ? max : '?' })}
            </Text>
          ) : null}

          <Text style={styles.footnote}>{t('grades.emptyIsNotZero')}</Text>
        </ScrollView>
      </KeyboardAvoidingView>

      <StickyFooter>
        <Button
          grow
          label={saving ? t('common.checking') : t(existing ? 'common.saveChanges' : 'common.save')}
          height={50}
          onPress={save}
          disabled={!ready || saving}
        />
      </StickyFooter>
    </Screen>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    missing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
    missingText: { fontFamily: body[600], fontSize: 14.5, color: color.inkSoft },

    label: { marginBottom: 10 },
    group: { overflow: 'hidden' },

    rosterHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 24,
      marginBottom: 10,
    },
    rosterCount: { fontFamily: body[600], fontSize: 12, color: color.mutedLight },

    scoreRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 15,
      paddingVertical: 10,
    },
    studentName: { flex: 1, fontFamily: body[600], fontSize: 14.5, color: color.ink },
    scoreInput: {
      width: 66,
      height: 40,
      borderWidth: 1,
      borderRadius: radius.control,
      backgroundColor: color.bg,
      textAlign: 'center',
      fontFamily: body[700],
      fontSize: 15,
      ...text.tabular,
    },
    outOf: { fontFamily: body[400], fontSize: 12.5, color: color.mutedLight, width: 40 },

    error: {
      fontFamily: body[600],
      fontSize: 12.5,
      color: color.dangerDeep,
      marginTop: 10,
    },
    typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
    addType: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: 40,
      paddingHorizontal: 14,
      borderRadius: radius.control,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: color.dashed,
    },
    addTypeLabel: { fontFamily: body[600], fontSize: 13.5, color: color.primary },
    newTypeRow: {
      height: 40,
      minWidth: 140,
      paddingHorizontal: 12,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: color.primary,
      backgroundColor: color.surface,
      justifyContent: 'center',
    },
    newTypeInput: { fontFamily: body[600], fontSize: 13.5, color: color.ink, padding: 0 },
    typeHint: {
      fontFamily: body[400],
      fontSize: 11.5,
      color: color.mutedLight,
      marginBottom: 16,
    },

    footnote: {
      fontFamily: body[400],
      fontSize: 12,
      lineHeight: 17,
      color: color.mutedLight,
      marginTop: 14,
    },
  });

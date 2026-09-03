/**
 * The teacher's own message templates: add, edit, delete.
 *
 * The built-in starters are listed too, and can now be rewritten or taken off
 * the list. They are translations rather than rows, so an edit is stored as an
 * override against the starter's id — which keeps the register's link to the
 * absence wording working, and keeps "put it back" to one tap. An untouched
 * starter still follows the teacher's language; an edited one is their words
 * and stays put.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  BackHandler,
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
import { Button, Card, Divider, EmptyState, FieldRow, Overline, Press } from '@/components/ui';
import { useStore, useTemplates } from '@/data/store';
import type { MessageTemplate } from '@/data/types';
import { useT } from '@/i18n/useT';
import {
  defaultFailTemplate,
  defaultGradeTemplate,
  GRADE_PLACEHOLDERS,
  previewGradeTemplate,
} from '@/lib/gradeTemplate';
import { builtInDefault, builtInTemplates } from '@/lib/templates';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body } from '@/theme/type';

export default function Templates() {
  const { accents, color, scheme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const t = useT();

  const mine = useTemplates();
  const teacherName = useStore((s) => s.teacherName);
  const storedGradeTemplate = useStore((s) => s.gradeTemplate);
  const storedFailTemplate = useStore((s) => s.gradeTemplateFail);
  const setGradeTemplate = useStore((s) => s.setGradeTemplate);
  const setGradeTemplateFail = useStore((s) => s.setGradeTemplateFail);
  const overrides = useStore((s) => s.templateOverrides);
  const hidden = useStore((s) => s.hiddenTemplates);
  const setBuiltInTemplate = useStore((s) => s.setBuiltInTemplate);
  const hideBuiltInTemplate = useStore((s) => s.hideBuiltInTemplate);
  const restoreBuiltInTemplates = useStore((s) => s.restoreBuiltInTemplates);
  const addTemplate = useStore((s) => s.addTemplate);
  const updateTemplate = useStore((s) => s.updateTemplate);
  const removeTemplate = useStore((s) => s.removeTemplate);

  /** `null` = not editing, `''` = writing a new one, otherwise an existing id. */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Set while the thing being edited is a starter rather than the teacher's own. */
  const [editingBuiltIn, setEditingBuiltIn] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');

  /*
    The result template is edited here too, but it is not one of the teacher's
    message templates and must not be listed among them: there is exactly one,
    it cannot be deleted, and it is not something you pick when composing. It
    is the wording every reported mark goes out with.
  */
  const [editingGrade, setEditingGrade] = useState<'pass' | 'fail' | null>(null);
  const [gradeText, setGradeText] = useState('');

  const passTemplate = storedGradeTemplate ?? defaultGradeTemplate(t);
  const failTemplate = storedFailTemplate ?? defaultFailTemplate(t);

  const builtIn = builtInTemplates(t, { overrides, hidden });
  const ready = title.trim().length > 1 && text.trim().length > 1;

  const startNew = () => {
    setEditingId('');
    setEditingBuiltIn(null);
    setTitle('');
    setText('');
  };

  const startEdit = (template: MessageTemplate) => {
    setEditingId(template.id);
    setEditingBuiltIn(null);
    setTitle(template.title);
    setText(template.body);
  };

  const startEditBuiltIn = (template: MessageTemplate) => {
    setEditingId(template.id);
    setEditingBuiltIn(template.id);
    setTitle(template.title);
    setText(template.body);
  };

  const closeEditor = () => {
    setEditingId(null);
    setEditingBuiltIn(null);
  };

  /*
    The editors are a state inside this one screen, not a route of their own —
    so tapping the on-screen chevron and calling `closeEditor` was the whole
    fix for one way back can be asked for, and the phone's own back button is
    the other. Unhandled, it goes to the stack instead of the state: Android's
    back button pops the *route*, which is this whole modal, and a teacher two
    taps into writing a template lands back in Settings rather than on the
    list they were just looking at.

    Same fix as the selection mode on the Messages tab: catch it while there is
    editor state to close, close that, and consume the event so the route is
    left alone. Falls through to the normal pop — out of Templates entirely —
    the moment neither editor is open, which is the one time that pop is right.
  */
  useFocusEffect(
    useCallback(() => {
      if (editingId === null && editingGrade === null) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (editingGrade !== null) setEditingGrade(null);
        else closeEditor();
        return true;
      });
      return () => sub.remove();
    }, [editingId, editingGrade]),
  );

  const save = () => {
    if (!ready) {
      void showAlert(t('template.new'), t('template.saveFirst'), 'danger');
      return;
    }
    if (editingBuiltIn) {
      const original = builtInDefault(t, editingBuiltIn);
      // Back to the translated original when the teacher has typed it word for
      // word, so it keeps following their language instead of freezing here.
      const unchanged =
        original?.title === title.trim() && original?.body === text.trim();
      setBuiltInTemplate(
        editingBuiltIn,
        unchanged ? null : { title: title.trim(), body: text.trim() },
      );
    } else if (editingId) {
      updateTemplate(editingId, { title: title.trim(), body: text.trim() });
    } else {
      addTemplate(title.trim(), text.trim());
    }
    closeEditor();
  };

  const resetBuiltIn = async () => {
    if (!editingBuiltIn) return;
    const original = builtInDefault(t, editingBuiltIn);
    if (!original) return;
    setTitle(original.title);
    setText(original.body);
  };

  const removeBuiltIn = async (template: MessageTemplate) => {
    const yes = await confirm({
      title: t('template.deleteTitle', { title: template.title }),
      message: t('template.builtInRemoveHint'),
      confirmLabel: t('common.delete'),
    });
    if (yes) hideBuiltInTemplate(template.id);
  };

  const restoreStarters = async () => {
    const yes = await confirm({
      title: t('template.builtInRestore'),
      message: t('template.builtInRestoreConfirm'),
      confirmLabel: t('template.builtInRestore'),
    });
    if (yes) restoreBuiltInTemplates();
  };

  const remove = async (template: MessageTemplate) => {
    const yes = await confirm({
      title: t('template.deleteTitle', { title: template.title }),
      message: t('calendar.cannotUndo'),
      confirmLabel: t('common.delete'),
    });
    if (yes) removeTemplate(template.id);
  };

  /** The default for whichever of the two is open. */
  const defaultFor = (which: 'pass' | 'fail') =>
    which === 'pass' ? defaultGradeTemplate(t) : defaultFailTemplate(t);

  const saveGrade = () => {
    if (!editingGrade) return;
    const next = gradeText.trim();
    if (next.length < 5) {
      void showAlert(t('grades.templateTitle'), t('template.saveFirst'), 'danger');
      return;
    }
    // Storing null when it matches the default keeps the teacher on the
    // translated text: they would otherwise be pinned to whichever language
    // was active on the day they opened this screen.
    const value = next === defaultFor(editingGrade).trim() ? null : next;
    if (editingGrade === 'pass') setGradeTemplate(value);
    else setGradeTemplateFail(value);
    setEditingGrade(null);
  };

  const resetGrade = async () => {
    if (!editingGrade) return;
    const yes = await confirm({
      title: t('grades.templateReset'),
      message: t('grades.templateResetConfirm'),
      confirmLabel: t('grades.templateReset'),
    });
    if (!yes) return;
    if (editingGrade === 'pass') setGradeTemplate(null);
    else setGradeTemplateFail(null);
    setGradeText(defaultFor(editingGrade));
  };

  /* ------------------------------------------------- Editing the result */

  if (editingGrade !== null) {
    return (
      <Screen>
        <TopBar
          title={t(editingGrade === 'pass' ? 'grades.templatePass' : 'grades.templateFail')}
          onLeading={() => setEditingGrade(null)}
        />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={insets.top + 60}>
          <ScrollView
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={{ padding: space.gutter, paddingBottom: insets.bottom + 140 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <Text style={styles.hint}>{t('grades.templateHint')}</Text>

            <Card style={[styles.editor, { marginTop: 14 }]}>
              <TextInput
                value={gradeText}
                onChangeText={setGradeText}
                multiline
                placeholder={t('template.bodyHint')}
                placeholderTextColor={color.mutedLight}
                style={styles.editorInput}
                textAlignVertical="top"
                selectionColor={color.primary}
                keyboardAppearance={scheme === 'dark' ? 'dark' : 'light'}
              />
              <View style={styles.chipRow}>
                {GRADE_PLACEHOLDERS.map((p) => (
                  <Press
                    key={p}
                    onPress={() =>
                      setGradeText((d) => `${d}${d.endsWith(' ') || !d ? '' : ' '}${p}`)
                    }
                    style={styles.chip}>
                    <Text style={styles.chipLabel}>{p}</Text>
                  </Press>
                ))}
              </View>
            </Card>

            {/* Written out with a real name and a real mark in it. Reading
                "{student} scored {score}" tells nobody whether the sentence
                works. */}
            <Overline style={styles.label}>{t('grades.templatePreview')}</Overline>
            <Card style={styles.previewCard}>
              <Text style={styles.previewText}>
                {previewGradeTemplate(gradeText, t, teacherName)}
              </Text>
            </Card>

            <Press onPress={() => void resetGrade()} style={styles.resetRow}>
              <Icon name="refresh" size={14} color={color.mutedLight} />
              <Text style={styles.resetLabel}>{t('grades.templateReset')}</Text>
            </Press>
          </ScrollView>
        </KeyboardAvoidingView>

        <StickyFooter style={{ gap: 10 }}>
          <Press onPress={() => setEditingGrade(null)} style={styles.cancel}>
            <Text style={styles.cancelLabel}>{t('common.cancel')}</Text>
          </Press>
          <Button grow label={t('common.save')} height={50} onPress={saveGrade} />
        </StickyFooter>
      </Screen>
    );
  }

  /* ------------------------------------------------------------- Editing */

  if (editingId !== null) {
    return (
      <Screen>
        {/* Back returns to the list. It used to fall through to `router.back()`,
            which pops the whole templates route and drops the teacher in
            Profile — one level further out than they asked for. */}
        <TopBar
          title={t(editingId ? 'template.edit' : 'template.new')}
          onLeading={closeEditor}
        />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={insets.top + 60}>
          <ScrollView
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={{ padding: space.gutter, paddingBottom: insets.bottom + 140 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <Card style={styles.group}>
              <FieldRow
                label={t('template.title')}
                placeholder={t('template.titleHint')}
                value={title}
                onChangeText={setTitle}
                autoCapitalize="sentences"
              />
            </Card>

            <Overline style={styles.label}>{t('template.body')}</Overline>
            <Card style={styles.editor}>
              <TextInput
                value={text}
                onChangeText={setText}
                multiline
                placeholder={t('template.bodyHint')}
                placeholderTextColor={color.mutedLight}
                style={styles.editorInput}
                textAlignVertical="top"
                selectionColor={color.primary}
                keyboardAppearance={scheme === 'dark' ? 'dark' : 'light'}
              />
              <View style={styles.chipRow}>
                {['{name}', '{group}', '{time}'].map((p) => (
                  <Press
                    key={p}
                    onPress={() => setText((d) => `${d}${d.endsWith(' ') || !d ? '' : ' '}${p}`)}
                    style={styles.chip}>
                    <Text style={styles.chipLabel}>{p}</Text>
                  </Press>
                ))}
              </View>
            </Card>

            <Text style={styles.hint}>{t('messages.placeholderHint')}</Text>

            {editingBuiltIn ? (
              <Press onPress={() => void resetBuiltIn()} style={styles.resetRow}>
                <Icon name="refresh" size={14} color={color.mutedLight} />
                <Text style={styles.resetLabel}>{t('template.resetToDefault')}</Text>
              </Press>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>

        <StickyFooter style={{ gap: 10 }}>
          <Press onPress={closeEditor} style={styles.cancel}>
            <Text style={styles.cancelLabel}>{t('common.cancel')}</Text>
          </Press>
          <Button grow label={t('common.save')} height={50} onPress={save} disabled={!ready} />
        </StickyFooter>
      </Screen>
    );
  }

  /* -------------------------------------------------------------- Listing */

  return (
    <Screen>
      <TopBar title={t('messages.templates')} dismiss />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingTop: 16,
          paddingBottom: insets.bottom + 120,
        }}
        showsVerticalScrollIndicator={false}>
        {/*
          Two wordings, because a result is two different pieces of news. One
          message cannot serve both: "you scored 31 out of 50" congratulates
          when the pass mark is 25 and rebukes when it is 35.
        */}
        <Overline style={styles.label}>{t('grades.templateTitle')}</Overline>
        {[
          { which: 'pass' as const, body: passTemplate, labelKey: 'grades.templatePass' as const },
          { which: 'fail' as const, body: failTemplate, labelKey: 'grades.templateFail' as const },
        ].map((entry) => (
          <Press
            key={entry.which}
            onPress={() => {
              setGradeText(entry.body);
              setEditingGrade(entry.which);
            }}
            style={{ marginBottom: 10 }}>
            <Card style={styles.gradeCard}>
              <View
                style={[
                  styles.gradeGlyph,
                  {
                    backgroundColor:
                      entry.which === 'pass' ? accents.emerald.tint : accents.amber.tint,
                  },
                ]}>
                <Icon
                  name={entry.which === 'pass' ? 'check' : 'warning'}
                  size={15}
                  color={entry.which === 'pass' ? accents.emerald.ink : accents.amber.ink}
                />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.gradeKind}>{t(entry.labelKey)}</Text>
                <Text style={styles.rowBody} numberOfLines={3}>
                  {entry.body}
                </Text>
                <Text style={styles.gradeAction}>{t('grades.templateEdit')}</Text>
              </View>
            </Card>
          </Press>
        ))}

        <Overline style={[styles.label, { marginTop: 22 }]}>{t('template.mine')}</Overline>
        {mine.length === 0 ? (
          <EmptyState title={t('template.none')} hint={t('template.noneHint')} />
        ) : (
          <Card style={{ overflow: 'hidden' }}>
            {mine.map((template, i) => (
              <View key={template.id}>
                {i > 0 ? <Divider inset={15} /> : null}
                <View style={styles.row}>
                  <Press
                    onPress={() => startEdit(template)}
                    style={{ flex: 1, minWidth: 0, paddingVertical: 13 }}>
                    <Text style={styles.rowTitle}>{template.title}</Text>
                    <Text style={styles.rowBody} numberOfLines={2}>
                      {template.body}
                    </Text>
                  </Press>
                  <Press onPress={() => startEdit(template)} hitSlop={8} style={styles.action}>
                    <Icon name="pencil" size={15} color={color.inkSoft} />
                  </Press>
                  <Press onPress={() => remove(template)} hitSlop={8} style={styles.action}>
                    <Icon name="close" size={15} color={color.dangerDeep} />
                  </Press>
                </View>
              </View>
            ))}
          </Card>
        )}

        <Overline style={[styles.label, { marginTop: 24 }]}>{t('template.builtIn')}</Overline>
        {builtIn.length ? (
          <Card style={{ overflow: 'hidden' }}>
            {builtIn.map((template, i) => (
              <View key={template.id}>
                {i > 0 ? <Divider inset={15} /> : null}
                <View style={styles.row}>
                  <Press
                    onPress={() => startEditBuiltIn(template)}
                    style={{ flex: 1, minWidth: 0, paddingVertical: 13 }}>
                    <Text style={styles.rowTitle}>
                      {template.title}
                      {template.edited ? (
                        <Text style={styles.editedMark}> · {t('template.edited')}</Text>
                      ) : null}
                    </Text>
                    <Text style={styles.rowBody} numberOfLines={2}>
                      {template.body}
                    </Text>
                  </Press>
                  <Press
                    onPress={() => startEditBuiltIn(template)}
                    hitSlop={8}
                    style={styles.action}>
                    <Icon name="pencil" size={15} color={color.inkSoft} />
                  </Press>
                  <Press
                    onPress={() => void removeBuiltIn(template)}
                    hitSlop={8}
                    style={styles.action}>
                    <Icon name="close" size={15} color={color.dangerDeep} />
                  </Press>
                </View>
              </View>
            ))}
          </Card>
        ) : (
          <EmptyState title={t('template.builtInAllGone')} hint={t('template.builtInRestoreHint')} />
        )}

        {/* Only once something has actually been removed or rewritten. An undo
            offered before there is anything to undo is a puzzle. */}
        {hidden.length || Object.keys(overrides).length ? (
          <Press onPress={() => void restoreStarters()} style={styles.resetRow}>
            <Icon name="refresh" size={14} color={color.mutedLight} />
            <Text style={styles.resetLabel}>{t('template.builtInRestore')}</Text>
          </Press>
        ) : null}
      </ScrollView>

      <StickyFooter>
        <Button grow icon="plus" label={t('template.new')} height={50} onPress={startNew} />
      </StickyFooter>
    </Screen>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    label: { marginBottom: 10 },
    group: { overflow: 'hidden' },

    row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 15 },
    rowTitle: { fontFamily: body[700], fontSize: 14.5, color: color.ink },
    rowBody: { fontFamily: body[400], fontSize: 12.5, color: color.mutedLight, marginTop: 3 },
    editedMark: { fontFamily: body[400], fontSize: 12, color: color.mutedLight },
    action: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
    },

    editor: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12 },
    editorInput: {
      minHeight: 130,
      fontFamily: body[400],
      fontSize: 15,
      lineHeight: 23,
      color: color.ink,
    },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 12 },
    chip: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radius.sm,
      backgroundColor: color.fill,
    },
    chipLabel: { fontFamily: body[600], fontSize: 12, color: color.inkSoft },

    hint: {
      fontFamily: body[400],
      fontSize: 12,
      lineHeight: 17,
      color: color.mutedLight,
      marginTop: 14,
    },

    cancel: {
      height: 50,
      paddingHorizontal: 20,
      borderRadius: radius.button,
      backgroundColor: color.fill,
      borderWidth: 1,
      borderColor: color.border,
      justifyContent: 'center',
    },
    gradeCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 13,
      paddingHorizontal: 15,
      paddingVertical: 14,
    },
    gradeGlyph: {
      width: 30,
      height: 30,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    gradeKind: { fontFamily: body[700], fontSize: 13, color: color.ink, marginBottom: 4 },
    gradeAction: { fontFamily: body[700], fontSize: 12.5, color: color.primary, marginTop: 8 },

    previewCard: { paddingHorizontal: 15, paddingVertical: 14 },
    previewText: { fontFamily: body[400], fontSize: 14, lineHeight: 21, color: color.ink },

    resetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      paddingVertical: 16,
    },
    resetLabel: { fontFamily: body[600], fontSize: 13, color: color.mutedLight },

    cancelLabel: { fontFamily: body[600], fontSize: 14.5, color: color.inkSoft },
  });

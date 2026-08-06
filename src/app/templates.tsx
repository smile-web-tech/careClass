/**
 * The teacher's own message templates: add, edit, delete.
 *
 * The built-in starters are listed too but cannot be edited or deleted. They
 * are translations, not rows, so "editing" one would either write a copy the
 * teacher did not ask for or silently stop it following their language. Anyone
 * who wants a different version writes their own, which is one tap away.
 */
import { useState } from 'react';
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
import { Button, Card, Divider, EmptyState, FieldRow, Overline, Press } from '@/components/ui';
import { useStore, useTemplates } from '@/data/store';
import type { MessageTemplate } from '@/data/types';
import { useT } from '@/i18n/useT';
import { builtInTemplates } from '@/lib/templates';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body } from '@/theme/type';

export default function Templates() {
  const { color, scheme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const t = useT();

  const mine = useTemplates();
  const addTemplate = useStore((s) => s.addTemplate);
  const updateTemplate = useStore((s) => s.updateTemplate);
  const removeTemplate = useStore((s) => s.removeTemplate);

  /** `null` = not editing, `''` = writing a new one, otherwise an existing id. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');

  const builtIn = builtInTemplates(t);
  const ready = title.trim().length > 1 && text.trim().length > 1;

  const startNew = () => {
    setEditingId('');
    setTitle('');
    setText('');
  };

  const startEdit = (template: MessageTemplate) => {
    setEditingId(template.id);
    setTitle(template.title);
    setText(template.body);
  };

  const save = () => {
    if (!ready) {
      void showAlert(t('template.new'), t('template.saveFirst'), 'danger');
      return;
    }
    if (editingId) updateTemplate(editingId, { title: title.trim(), body: text.trim() });
    else addTemplate(title.trim(), text.trim());
    setEditingId(null);
  };

  const remove = async (template: MessageTemplate) => {
    const yes = await confirm({
      title: t('template.deleteTitle', { title: template.title }),
      message: t('calendar.cannotUndo'),
      confirmLabel: t('common.delete'),
    });
    if (yes) removeTemplate(template.id);
  };

  /* ------------------------------------------------------------- Editing */

  if (editingId !== null) {
    return (
      <Screen>
        <TopBar title={t(editingId ? 'template.edit' : 'template.new')} dismiss />
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
          </ScrollView>
        </KeyboardAvoidingView>

        <StickyFooter style={{ gap: 10 }}>
          <Press onPress={() => setEditingId(null)} style={styles.cancel}>
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
        <Overline style={styles.label}>{t('template.mine')}</Overline>
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
        <Card style={{ overflow: 'hidden' }}>
          {builtIn.map((template, i) => (
            <View key={template.id}>
              {i > 0 ? <Divider inset={15} /> : null}
              <View style={[styles.row, { paddingVertical: 13 }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowTitle}>{template.title}</Text>
                  <Text style={styles.rowBody} numberOfLines={2}>
                    {template.body}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </Card>
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
    cancelLabel: { fontFamily: body[600], fontSize: 14.5, color: color.inkSoft },
  });

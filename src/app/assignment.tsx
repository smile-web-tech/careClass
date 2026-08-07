/**
 * Send homework: a file, and what to do with it.
 *
 * A screen of its own rather than another row of controls on the composer.
 * Sending an assignment is a different job from sending a reminder — it always
 * goes to students, it always carries a file, and it never wants a template or
 * a `{name}` substitution. Folding it into the composer would have meant three
 * more controls that are wrong for every other message sent from there.
 *
 * Email only. SMS cannot carry a file, and the screen says which students have
 * no address on file rather than quietly dropping them.
 */
import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showAlert, showError } from '@/components/Dialog';
import { Icon } from '@/components/Icon';
import { FooterSummary, Screen, StickyFooter, TopBar } from '@/components/layout';
import { Button, Card, Overline, Press, SelectChip } from '@/components/ui';
import { fetchMessages, sendMessage as apiSendMessage } from '@/data/api';
import { useGroups, useStore, useStudents } from '@/data/store';
import { useT } from '@/i18n/useT';
import {
  formatBytes,
  MAX_FILES,
  pickAttachments,
  uploadAttachments,
  type PickedAttachment,
} from '@/lib/attachments';
import { hasSupabase } from '@/lib/supabase';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, text } from '@/theme/type';

export default function Assignment() {
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { accents, color, scheme } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const groups = useGroups();
  const students = useStudents();

  const [picked, setPicked] = useState<Record<string, boolean> | null>(null);
  const selection = picked ?? (groups[0] ? { [groups[0].id]: true } : {});
  const toggleGroup = (id: string) => setPicked({ ...selection, [id]: !selection[id] });

  const [files, setFiles] = useState<PickedAttachment[]>([]);
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  // The instructions box is the last thing on the screen, so it is the one the
  // keyboard covers. See `useKeyboardInset` for why padding alone is not it.
  const scroller = useRef<ScrollView>(null);
  const keyboard = useKeyboardInset(
    useCallback(() => scroller.current?.scrollToEnd({ animated: true }), []),
  );

  const selectedGroups = groups.filter((g) => selection[g.id]);
  const targeted = students.filter((s) => selectedGroups.some((g) => s.groupIds.includes(g.id)));
  const withEmail = targeted.filter((s) => s.email?.trim());
  const noEmail = targeted.length - withEmail.length;

  const blocker =
    selectedGroups.length === 0
      ? t('messages.noGroupSelected')
      : withEmail.length === 0
        ? t('assign.noEmail', { count: noEmail })
        : files.length === 0
          ? t('assign.needFile')
          : instructions.trim().length === 0
            ? t('assign.needText')
            : null;

  const addFiles = async () => {
    Keyboard.dismiss();
    try {
      const { accepted, rejected } = await pickAttachments(files.length);
      if (accepted.length) setFiles((f) => [...f, ...accepted]);

      // Say why something was refused, once, rather than silently dropping it.
      if (rejected.length) {
        const lines = rejected.map((r) =>
          r.reason === 'tooMany'
            ? t('attach.tooMany', { count: MAX_FILES })
            : t(`attach.${r.reason}` as 'attach.tooBig', { name: r.filename }),
        );
        void showAlert(t('assign.files'), [...new Set(lines)].join('\n'));
      }
    } catch (e) {
      void showError(e);
    }
  };

  const send = async () => {
    if (blocker || busy) return;
    if (!hasSupabase) {
      // No project means no storage to upload to and no server to send from.
      void showAlert(t('assign.title'), t('assign.emailOnly'));
      return;
    }

    try {
      setBusy(t('assign.uploading', { done: 0, total: files.length }));
      const uploaded = await uploadAttachments(files, (done, total) =>
        setBusy(t('assign.uploading', { done, total })),
      );

      setBusy(t('common.sending'));
      const report = await apiSendMessage({
        groupIds: selectedGroups.map((g) => g.id),
        audience: 'students',
        channels: ['email'],
        body: instructions.trim(),
        isAssignment: true,
        attachments: uploaded.map((a) => ({
          path: a.storagePath,
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
        })),
      });

      useStore.setState({ messages: await fetchMessages() });

      if (report.sent === 0) {
        await showAlert(
          t('messages.nothingSentTitle'),
          [`${report.failed} rejected.`, ...report.errors].join('\n\n'),
          'danger',
        );
        return;
      }

      router.replace('/(tabs)/messages');
      if (report.failed) {
        void showAlert(
          t('assign.sent'),
          t('messages.sentOf', { sent: report.sent, total: report.sent + report.failed }),
        );
      }
    } catch (e) {
      void showError(e, t('messages.nothingSentTitle'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <TopBar title={t('assign.new')} dismiss />

      <ScrollView
        ref={scroller}
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        contentContainerStyle={{
          padding: space.gutter,
          paddingTop: 14,
          paddingBottom: insets.bottom + 150 + keyboard,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <Text style={styles.lede}>{t('assign.subtitle')}</Text>

        <Overline style={styles.label}>To</Overline>
        <View style={styles.chipWrap}>
          {groups.map((g) => (
            <SelectChip
              key={g.id}
              label={g.name}
              dot={accents[g.accent].dot}
              count={students.filter((s) => s.groupIds.includes(g.id)).length}
              selected={!!selection[g.id]}
              onPress={() => toggleGroup(g.id)}
            />
          ))}
        </View>

        <View style={styles.note}>
          <Icon name="info" size={16} color={color.primary} />
          <Text style={styles.noteText}>
            {t('assign.studentsOnly')} {t('assign.emailOnly')}
          </Text>
        </View>

        {noEmail > 0 ? (
          <View style={styles.warn}>
            <Icon name="warning" size={16} color={color.warningDeep} />
            <Text style={styles.warnText}>{t('assign.noEmail', { count: noEmail })}</Text>
          </View>
        ) : null}

        <Overline style={styles.label}>{t('assign.files')}</Overline>
        <View style={styles.fileList}>
          {files.map((f) => (
            <Card key={f.id} style={styles.fileRow}>
              <View style={[styles.fileGlyph, { backgroundColor: color.primaryTint }]}>
                <Icon
                  name={f.mimeType.startsWith('image/') ? 'search' : 'envelope'}
                  size={16}
                  color={color.primaryInk}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fileName} numberOfLines={1}>
                  {f.filename}
                </Text>
                <Text style={styles.fileMeta}>{formatBytes(f.size)}</Text>
              </View>
              <Press
                onPress={() => setFiles((list) => list.filter((x) => x.id !== f.id))}
                accessibilityLabel={t('assign.remove')}
                hitSlop={8}
                style={styles.fileRemove}>
                <Icon name="close" size={14} color={color.muted} />
              </Press>
            </Card>
          ))}

          {files.length < MAX_FILES ? (
            <Press onPress={() => void addFiles()} style={styles.addFile}>
              <Icon name="plus" size={15} color={color.primary} />
              <Text style={styles.addFileLabel}>{t('assign.addFile')}</Text>
            </Press>
          ) : null}
        </View>

        <Overline style={styles.label}>{t('assign.instructions')}</Overline>
        <Card style={styles.editor}>
          <TextInput
            value={instructions}
            onChangeText={setInstructions}
            onFocus={() =>
              requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }))
            }
            multiline
            placeholder={t('assign.instructionsPlaceholder')}
            placeholderTextColor={color.mutedLight}
            style={styles.editorInput}
            textAlignVertical="top"
            selectionColor={color.primary}
            keyboardAppearance={scheme === 'dark' ? 'dark' : 'light'}
          />
        </Card>
      </ScrollView>

      <StickyFooter>
        <FooterSummary
          title={blocker ?? t('assign.reaches', { count: withEmail.length })}
          hint={files.length ? `${files.length} · ${t('assign.files')}` : t('assign.needFile')}
        />
        {busy ? (
          <View style={styles.busy}>
            <ActivityIndicator color={color.primary} />
            <Text style={styles.busyLabel}>{busy}</Text>
          </View>
        ) : (
          <Button label={t('assign.send')} icon="send" onPress={send} disabled={!!blocker} />
        )}
      </StickyFooter>
    </Screen>
  );
}

const makeStyles = ({ accents, color }: Theme) =>
  StyleSheet.create({
    lede: { fontFamily: body[400], fontSize: 13.5, lineHeight: 20, color: color.muted },
    label: { marginBottom: 10, marginTop: 22 },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

    note: {
      flexDirection: 'row',
      gap: 10,
      alignItems: 'flex-start',
      backgroundColor: color.primaryTint,
      borderRadius: radius.control,
      paddingHorizontal: 13,
      paddingVertical: 11,
      marginTop: 16,
    },
    noteText: {
      flex: 1,
      fontFamily: body[400],
      fontSize: 12.5,
      lineHeight: 18.5,
      color: color.primaryInk,
    },

    warn: {
      flexDirection: 'row',
      gap: 10,
      alignItems: 'flex-start',
      backgroundColor: accents.amber.tint,
      borderRadius: radius.control,
      paddingHorizontal: 13,
      paddingVertical: 11,
      marginTop: 10,
    },
    warnText: {
      flex: 1,
      fontFamily: body[400],
      fontSize: 12.5,
      lineHeight: 18.5,
      color: accents.amber.ink,
    },

    fileList: { gap: 8 },
    fileRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
    fileGlyph: {
      width: 34,
      height: 34,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    fileName: { fontFamily: body[600], fontSize: 14, color: color.ink },
    fileMeta: { fontFamily: body[400], fontSize: 12, color: color.mutedLight, marginTop: 2 },
    fileRemove: {
      width: 30,
      height: 30,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.sm,
    },

    addFile: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      height: 50,
      borderRadius: radius.button,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: color.dashed,
    },
    addFileLabel: { fontFamily: body[700], fontSize: 14, color: color.primary },

    editor: { padding: 14, minHeight: 150 },
    editorInput: {
      ...text.body,
      color: color.ink,
      minHeight: 120,
      padding: 0,
    },

    busy: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, paddingHorizontal: 4 },
    busyLabel: { fontFamily: body[600], fontSize: 13.5, color: color.muted },
  });

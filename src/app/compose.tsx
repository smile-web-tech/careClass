import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/Icon';
import { FooterSummary, Screen, StickyFooter, TopBar } from '@/components/layout';
import {
  Avatar,
  Button,
  Card,
  Divider,
  Overline,
  Press,
  SelectChip,
  Segmented,
  Txt,
} from '@/components/ui';
import { fetchMessages, sendMessage as apiSendMessage } from '@/data/api';
import { messageTemplates } from '@/data/seed';
import { useGroups, useStore, useStudents } from '@/data/store';
import type { Audience, Channel } from '@/data/types';
import { hasSupabase } from '@/lib/supabase';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, text } from '@/theme/type';

const CHANNELS: { key: Channel; label: string; icon: IconName }[] = [
  { key: 'sms', label: 'SMS', icon: 'chat' },
  { key: 'email', label: 'Email', icon: 'envelope' },
  { key: 'push', label: 'Push', icon: 'bell' },
];

const AUDIENCES: { key: Audience; label: string }[] = [
  { key: 'students', label: 'Students' },
  { key: 'parents', label: 'Parents' },
  { key: 'both', label: 'Both' },
];

const PLACEHOLDERS = ['{name}', '{group}', '{time}'];

export default function Compose() {
  const { accents, color, scheme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const params = useLocalSearchParams<{
    group?: string;
    audience?: Audience;
    students?: string;
    template?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const groups = useGroups();
  const students = useStudents();
  const sendMessage = useStore((s) => s.sendMessage);

  /** When arriving from attendance, the message targets specific students. */
  const focusIds = useMemo(
    () => (params.students ? params.students.split(',').filter(Boolean) : []),
    [params.students],
  );
  const focused = useMemo(
    () => students.filter((s) => focusIds.includes(s.id)),
    [focusIds, students],
  );

  const [picked, setPicked] = useState<Record<string, boolean>>(() =>
    params.group ? { [params.group]: true } : { [groups[0]?.id ?? '']: true },
  );
  const [audience, setAudience] = useState<Audience>(params.audience ?? 'students');
  const [channels, setChannels] = useState<Record<Channel, boolean>>({
    sms: true,
    email: false,
    push: true,
  });
  const [draft, setDraft] = useState(() => {
    const t = messageTemplates.find((x) => x.id === `t-${params.template}`);
    return (
      t?.body ?? 'Hi {name}, reminder: {group} meets today at {time}. Please bring your workbook.'
    );
  });
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [sending, setSending] = useState(false);

  /** Real gateways are involved only when signed in against a real project. */
  const demo = useStore((s) => s.demo);
  const liveSend = hasSupabase && !demo;

  const selectedGroups = groups.filter((g) => picked[g.id]);
  const activeChannels = CHANNELS.filter((c) => channels[c.key]);
  const multiplier = audience === 'both' ? 2 : 1;

  const reach = focusIds.length
    ? focused.length * multiplier
    : selectedGroups.reduce(
        (n, g) => n + students.filter((s) => s.groupIds.includes(g.id)).length,
        0,
      ) * multiplier;

  const canSend = reach > 0 && activeChannels.length > 0 && draft.trim().length > 0;
  const segments = Math.max(1, Math.ceil(draft.length / 160));

  /**
   * Sending is the one action that must not be optimistic. Everywhere else a
   * queued write is invisible and harmless; here, showing "Delivered 8/8" for a
   * message that never left would have the teacher believe the class was told.
   * So against a real backend we await the Edge Function and report failure.
   */
  const send = async () => {
    const payload = {
      groupIds: selectedGroups.map((g) => g.id),
      audience,
      channels: activeChannels.map((c) => c.key),
      body: draft.trim(),
    };

    if (!liveSend) {
      sendMessage({ ...payload, total: reach });
      router.replace('/(tabs)/messages');
      return;
    }

    setSending(true);
    try {
      await apiSendMessage({
        ...payload,
        studentIds: focusIds.length ? focusIds : undefined,
      });
      useStore.setState({ messages: await fetchMessages() });
      router.replace('/(tabs)/messages');
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      Alert.alert(
        'Nothing was sent',
        /not found|404/i.test(detail)
          ? 'The send-message function is not deployed yet, so no SMS or email went out.\n\nRun: supabase functions deploy send-message'
          : detail,
      );
    } finally {
      setSending(false);
    }
  };

  const audienceWord =
    audience === 'both' ? 'students and parents' : audience === 'parents' ? 'parents' : 'students';

  return (
    <Screen>
      <TopBar
        title="New message"
        dismiss
        trailing={
          <Press onPress={() => setTemplatesOpen(true)}>
            <Text style={styles.templatesLink}>Templates</Text>
          </Press>
        }
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 60}>
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{
            padding: space.gutter,
            paddingTop: 18,
            paddingBottom: insets.bottom + 140,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Overline style={styles.label}>To</Overline>

          {focusIds.length ? (
            <Card style={styles.focusCard}>
              <View style={styles.focusHead}>
                <Icon name="warning" size={16} color={color.warningDeep} />
                <Text style={styles.focusTitle}>
                  {focused.length} absentee{focused.length > 1 ? 's' : ''} from today
                </Text>
              </View>
              <View style={styles.focusList}>
                {focused.map((s) => (
                  <View key={s.id} style={styles.focusChip}>
                    <Avatar name={s.name} accent={s.accent} size={24} radius={8} fontSize={9.5} />
                    <Text style={styles.focusName}>{s.name}</Text>
                  </View>
                ))}
              </View>
            </Card>
          ) : (
            <View style={styles.chipWrap}>
              {groups.map((g) => (
                <SelectChip
                  key={g.id}
                  label={g.name}
                  dot={accents[g.accent].dot}
                  count={students.filter((s) => s.groupIds.includes(g.id)).length}
                  selected={!!picked[g.id]}
                  onPress={() => setPicked((p) => ({ ...p, [g.id]: !p[g.id] }))}
                />
              ))}
            </View>
          )}

          <Overline style={styles.label}>Recipients</Overline>
          <View style={{ marginBottom: 20 }}>
            <Segmented options={AUDIENCES} value={audience} onChange={setAudience} />
          </View>

          <Overline style={styles.label}>Send via</Overline>
          <View style={styles.channelRow}>
            {CHANNELS.map((c) => {
              const on = channels[c.key];
              return (
                <Press
                  key={c.key}
                  haptic
                  onPress={() => setChannels((x) => ({ ...x, [c.key]: !x[c.key] }))}
                  style={[
                    styles.channel,
                    {
                      backgroundColor: on ? color.primaryTint : color.surface,
                      borderColor: on ? color.primary : color.border,
                    },
                  ]}>
                  <Icon
                    name={c.icon}
                    size={20}
                    strokeWidth={1.6}
                    color={on ? color.primaryInk : color.inkSoft}
                  />
                  <Text
                    style={[styles.channelLabel, { color: on ? color.primaryInk : color.inkSoft }]}>
                    {c.label}
                  </Text>
                </Press>
              );
            })}
          </View>

          <Overline style={styles.label}>Message</Overline>
          <Card style={styles.editor}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              multiline
              placeholder="Type your message…"
              placeholderTextColor={color.mutedLight}
              style={styles.editorInput}
              textAlignVertical="top"
              selectionColor={color.primary}
              keyboardAppearance={scheme === 'dark' ? 'dark' : 'light'}
            />
            <View style={styles.editorFoot}>
              <View style={styles.placeholderRow}>
                {PLACEHOLDERS.map((p) => (
                  <Press
                    key={p}
                    onPress={() => setDraft((d) => `${d}${d.endsWith(' ') || !d ? '' : ' '}${p}`)}
                    style={styles.placeholderChip}>
                    <Text style={styles.placeholderLabel}>{p}</Text>
                  </Press>
                ))}
              </View>
              <Text style={styles.charCount}>
                {draft.length} chars · {segments} SMS
              </Text>
            </View>
          </Card>

          <View style={styles.info}>
            <Icon name="info" size={18} color={color.primary} />
            <Text style={styles.infoText}>
              Placeholders are filled per recipient, so everyone gets their own name.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <StickyFooter>
        <FooterSummary
          title={reach === 0 ? 'No group selected' : `Reaches ${reach} ${audienceWord}`}
          hint={
            activeChannels.length
              ? `via ${activeChannels.map((c) => c.label).join(' + ')}`
              : 'Pick at least one channel'
          }
        />
        <Button
          label={sending ? 'Sending…' : 'Send'}
          icon="send"
          onPress={send}
          disabled={!canSend || sending}
        />
      </StickyFooter>

      <Modal
        visible={templatesOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setTemplatesOpen(false)}>
        <Press style={styles.scrim} onPress={() => setTemplatesOpen(false)} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
          <View style={styles.grabber} />
          <Text style={[text.sheetTitle, styles.ink, { marginBottom: 4 }]}>Templates</Text>
          <Txt style={styles.sheetHint}>
            Placeholders stay intact — they fill per recipient when you send.
          </Txt>
          {messageTemplates.map((t, i) => (
            <View key={t.id}>
              {i > 0 ? <Divider /> : null}
              <Press
                onPress={() => {
                  setDraft(t.body);
                  setTemplatesOpen(false);
                }}
                style={styles.templateRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.templateTitle}>{t.title}</Text>
                  <Text style={styles.templateBody} numberOfLines={2}>
                    {t.body}
                  </Text>
                </View>
                <Icon name="disclosure" size={16} color={color.chevron} />
              </Press>
            </View>
          ))}
        </View>
      </Modal>
    </Screen>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    /** Default body ink. Text does not inherit colour from a parent View. */
    ink: { color: color.ink },
    templatesLink: {
      fontFamily: body[700],
      fontSize: 13,
      color: color.primary,
    },
    label: { marginBottom: 10 },

    chipWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 20,
    },

    focusCard: { padding: 14, marginBottom: 20, gap: 10 },
    focusHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    focusTitle: { fontFamily: body[700], fontSize: 13.5, color: color.ink },
    focusList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    focusChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      backgroundColor: color.fill,
      borderRadius: radius.lg,
      paddingLeft: 5,
      paddingRight: 10,
      paddingVertical: 5,
    },
    focusName: { fontFamily: body[600], fontSize: 12.5, color: color.inkSoft },

    channelRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
    channel: {
      flex: 1,
      height: 74,
      borderRadius: radius.button,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    channelLabel: { fontFamily: body[600], fontSize: 12.5 },

    editor: { paddingHorizontal: 15, paddingTop: 14, paddingBottom: 11 },
    editorInput: {
      fontFamily: body[400],
      fontSize: 14.5,
      lineHeight: 22.5,
      color: color.ink,
      minHeight: 112,
      padding: 0,
    },
    editorFoot: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      marginTop: 8,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: color.divider,
    },
    placeholderRow: { flexDirection: 'row', gap: 7 },
    placeholderChip: {
      height: 30,
      paddingHorizontal: 10,
      borderRadius: radius.md,
      backgroundColor: color.fill,
      justifyContent: 'center',
    },
    placeholderLabel: {
      fontFamily: body[600],
      fontSize: 12,
      color: color.inkSoft,
    },
    charCount: {
      fontFamily: body[600],
      fontSize: 11.5,
      color: color.mutedLight,
      ...text.tabular,
    },

    info: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: color.primaryTint,
      borderRadius: radius.button,
      paddingHorizontal: 15,
      paddingVertical: 13,
      marginTop: 14,
    },
    infoText: {
      flex: 1,
      fontFamily: body[400],
      fontSize: 12.5,
      lineHeight: 18.1,
      color: color.primaryInk,
    },

    scrim: { flex: 1, backgroundColor: color.scrim },
    sheet: {
      backgroundColor: color.sheet,
      borderTopLeftRadius: radius.sheet,
      borderTopRightRadius: radius.sheet,
      paddingHorizontal: space.gutter,
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
    sheetHint: { fontSize: 13, color: color.muted, marginBottom: 8 },
    templateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 14,
    },
    templateTitle: { fontFamily: body[700], fontSize: 14.5, color: color.ink },
    templateBody: {
      fontFamily: body[400],
      fontSize: 12.5,
      color: color.muted,
      marginTop: 3,
    },
  });

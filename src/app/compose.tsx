import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
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

import { showAlert } from '@/components/Dialog';
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
import { describeError } from '@/lib/errors';
import { hasSupabase } from '@/lib/supabase';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, text } from '@/theme/type';

/**
 * No push channel. ClassCare is the teacher's app — students and parents never
 * install it, so there is no device to push to and the server's `sendPush` is a
 * documented no-op. Offering the button only ever produced deliveries that
 * reported "sent" while reaching nobody. `Channel` keeps `'push'` because the
 * database enum and older message rows still carry it.
 */
const CHANNELS: { key: Channel; label: string; icon: IconName }[] = [
  { key: 'sms', label: 'SMS', icon: 'chat' },
  { key: 'email', label: 'Email', icon: 'envelope' },
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

  /**
   * `null` until the teacher touches a chip, so the default can follow the data
   * instead of being frozen at mount.
   *
   * Seeding this from `groups[0]` in a `useState` initialiser looked equivalent
   * and was not: the initialiser runs once, and opening the composer before the
   * store has hydrated from Supabase left it holding a key that matches no
   * group. The chips then rendered with nothing selected and the footer read
   * "No group selected" with no way to explain itself.
   */
  const [picked, setPicked] = useState<Record<string, boolean> | null>(null);
  const selection =
    picked ??
    (params.group
      ? { [params.group]: true }
      : groups[0]
        ? { [groups[0].id]: true }
        : ({} as Record<string, boolean>));
  const toggleGroup = (id: string) => setPicked({ ...selection, [id]: !selection[id] });
  const [audience, setAudience] = useState<Audience>(params.audience ?? 'students');
  const [channels, setChannels] = useState<Record<Channel, boolean>>({
    sms: true,
    email: false,
    push: false,
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

  const selectedGroups = groups.filter((g) => selection[g.id]);
  const activeChannels = CHANNELS.filter((c) => channels[c.key]);
  const multiplier = audience === 'both' ? 2 : 1;

  const reach = focusIds.length
    ? focused.length * multiplier
    : selectedGroups.reduce(
        (n, g) => n + students.filter((s) => s.groupIds.includes(g.id)).length,
        0,
      ) * multiplier;

  /**
   * Recipients the email channel cannot reach.
   *
   * The server drops these silently — it has no address to send to — so say so
   * before the teacher taps Send rather than after. Email is the channel where
   * this bites: a phone number is required on every student, an address is not.
   */
  const targeted = focusIds.length
    ? focused
    : students.filter((s) => selectedGroups.some((g) => s.groupIds.includes(g.id)));

  const noEmail = channels.email
    ? targeted.reduce((n, s) => {
        let missing = 0;
        if (audience !== 'parents' && !s.email) missing += 1;
        // A guardian only counts as a recipient at all if we hold some way to
        // reach them, which mirrors how the function builds its list.
        if (
          audience !== 'students' &&
          (s.parentPhone || s.parentEmail || s.parentName) &&
          !s.parentEmail
        ) {
          missing += 1;
        }
        return n + missing;
      }, 0)
    : 0;

  /**
   * Why Send is unavailable, in the teacher's terms.
   *
   * "No group selected" used to cover all of these, including the case where a
   * group *is* ticked and simply has nobody in it — which reads as the app
   * ignoring the tap. The focus case matters too: arriving from attendance the
   * chip picker is not rendered at all, so an empty group list there is not
   * something the teacher can see, let alone fix.
   */
  const blocker =
    selectedGroups.length === 0
      ? focusIds.length
        ? 'Those students are not in any group'
        : 'No group selected'
      : reach === 0
        ? selectedGroups.length > 1
          ? 'Those groups have no students'
          : `${selectedGroups[0].name} has no students`
        : activeChannels.length === 0
          ? 'Pick at least one channel'
          : null;

  const canSend = !blocker && draft.trim().length > 0;
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
      const report = await apiSendMessage({
        ...payload,
        studentIds: focusIds.length ? focusIds : undefined,
      });
      useStore.setState({ messages: await fetchMessages() });

      const skipped = report.skipped.sms + report.skipped.email + report.skipped.push;
      const missing = [
        report.skipped.email ? 'an email address' : '',
        report.skipped.sms || report.skipped.push ? 'a phone number' : '',
      ]
        .filter(Boolean)
        .join(' or ');

      // Every delivery rejected. The message is in the log but nobody was told
      // anything, so stay on the composer rather than dropping the teacher on a
      // Messages list that looks like the class has been informed.
      if (report.sent === 0) {
        await showAlert(
          'Nothing was sent',
          [`All ${report.failed} deliveries were rejected.`, ...report.errors].join('\n\n'),
          'danger',
        );
        return;
      }

      router.replace('/(tabs)/messages');

      if (report.failed || skipped) {
        void showAlert(
          `Sent to ${report.sent} of ${report.sent + report.failed + skipped}`,
          [
            skipped
              ? `${skipped} skipped — no ${missing} on file. Add it on the student, then send again.`
              : '',
            report.failed ? `${report.failed} rejected by the provider.` : '',
            ...report.errors,
          ]
            .filter(Boolean)
            .join('\n\n'),
        );
      }
    } catch (e) {
      const described = describeError(e);
      // The one case worth overriding: a 404 here is not "not found" to the
      // teacher, it means the function was never deployed. Nobody using the app
      // can fix that, but whoever set it up can, and the message names the step.
      const notDeployed = described.kind === 'notFound';
      void showAlert(
        'Nothing was sent',
        notDeployed
          ? 'Messaging is not finished being set up on the server yet. Nothing went out.'
          : described.message,
        'danger',
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
                  selected={!!selection[g.id]}
                  onPress={() => toggleGroup(g.id)}
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

          {noEmail > 0 ? (
            <View style={styles.warn}>
              <Icon name="info" size={18} color={color.warningDeep} />
              <Text style={styles.warnText}>
                {noEmail} of them {noEmail === 1 ? 'has' : 'have'} no email address on file and will
                not be emailed. Add one on the student to include them.
              </Text>
            </View>
          ) : null}

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
          title={blocker ?? `Reaches ${reach} ${audienceWord}`}
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

const makeStyles = ({ color, accents }: Theme) =>
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
    warn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: accents.amber.tint,
      borderRadius: radius.button,
      paddingHorizontal: 15,
      paddingVertical: 13,
      marginBottom: 20,
    },
    warnText: {
      flex: 1,
      fontFamily: body[400],
      fontSize: 12.5,
      lineHeight: 18.1,
      color: accents.amber.ink,
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

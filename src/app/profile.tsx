import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirm, showAlert, showError } from '@/components/Dialog';
import { LanguagePicker } from '@/components/LanguagePicker';
import { Icon, type IconName } from '@/components/Icon';
import { Screen, TopBar } from '@/components/layout';
import { Button, Card, Divider, Overline, Press, StatTile, Toggle } from '@/components/ui';
import { deleteAccountData, updateTeacher } from '@/data/api';
import { useGroups, useStore, useStudents } from '@/data/store';
import { hydrate } from '@/data/sync';
import type { TranslationKey } from '@/i18n';
import { useT } from '@/i18n/useT';
import {
  cancelClassReminders,
  registerForPush,
  requestNotificationPermission,
  rescheduleClassReminders,
  scheduledReminderCount,
  type ReminderLead,
} from '@/lib/notifications';
import { signOut } from '@/lib/auth';
import { weekDays } from '@/lib/date';
import { sessionsForWeek } from '@/lib/schedule';
import { hasSupabase } from '@/lib/supabase';
import { radius, space, useTheme, useThemedStyles, type Theme, type ThemePref } from '@/theme';
import { body, display, text } from '@/theme/type';

const PROVIDER_LABEL: Record<string, string> = {
  google: 'Signed in with Google',
  apple: 'Signed in with Apple',
  email: 'Signed in with email',
};

export default function Profile() {
  const { color, scheme, status } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const groups = useGroups();
  const students = useStudents();
  const messages = useStore((s) => s.messages);
  const name = useStore((s) => s.teacherName);
  const email = useStore((s) => s.teacherEmail);
  const avatarUrl = useStore((s) => s.teacherAvatarUrl);
  const provider = useStore((s) => s.teacherProvider);
  const doSignOut = useStore((s) => s.signOut);

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [busy, setBusy] = useState(false);

  const t = useT();
  const live = hasSupabase;
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC', []);

  const sessionsThisWeek = useMemo(() => {
    const week = sessionsForWeek(groups, weekDays(new Date()));
    return Object.values(week).reduce((n, s) => n + s.length, 0);
  }, [groups]);

  const saveName = async () => {
    const next = draftName.trim();
    if (next.length < 2) return;

    useStore.setState({ teacherName: next });
    setEditing(false);

    if (!live) return;
    try {
      await updateTeacher({ name: next, timezone });
    } catch (e) {
      showError(e, t('profile.couldNotSave'));
    }
  };

  const confirmSignOut = async () => {
    const yes = await confirm({
      title: t('auth.signOutTitle'),
      message: t('auth.signOutMessage'),
      confirmLabel: t('auth.signOut'),
    });
    if (!yes) return;

    if (live) {
      try {
        await signOut();
      } catch {
        // Even if the network call fails, drop the local session.
      }
    }
    doSignOut();
    router.replace('/sign-in');
  };

  /**
   * Two-step, because this is unrecoverable. Removing the `teachers` row
   * cascades through every table — groups, students, attendance, message
   * history. The auth user itself survives; that needs the admin API.
   */
  const confirmDelete = async () => {
    const first = await confirm({
      title: t('profile.deleteAllTitle'),
      message: t('profile.deleteAllMessage', {
        groups: groups.length,
        students: students.length,
      }),
      confirmLabel: t('profile.deleteAllConfirm'),
    });
    if (!first) return;

    const sure = await confirm({
      title: t('profile.deleteAllSure'),
      message: t('profile.deleteAllSureMessage'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('profile.keepMyData'),
    });
    if (!sure) return;

    setBusy(true);
    try {
      await deleteAccountData();
      await signOut();
      doSignOut();
      router.replace('/sign-in');
    } catch (e) {
      showError(e, t('profile.couldNotDelete'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <TopBar title={t('profile.title')} />

      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{
          padding: space.gutter,
          paddingBottom: insets.bottom + 40,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}>
        <View style={styles.identity}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatarImage} contentFit="cover" />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarInitials}>
                {name
                  .split(' ')
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase() || '?'}
              </Text>
            </View>
          )}

          {editing ? (
            <View style={styles.editRow}>
              <TextInput
                value={draftName}
                onChangeText={setDraftName}
                autoFocus
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={saveName}
                style={styles.nameInput}
                selectionColor={color.primary}
                keyboardAppearance={scheme === 'dark' ? 'dark' : 'light'}
              />
              <Button
                label={t('common.save')}
                height={40}
                onPress={saveName}
                style={{ paddingHorizontal: 16 }}
              />
            </View>
          ) : (
            <Press
              onPress={() => {
                setDraftName(name);
                setEditing(true);
              }}
              style={styles.nameRow}>
              <Text style={styles.name}>{name || 'Add your name'}</Text>
              <Icon name="pencil" size={16} color={color.mutedLight} />
            </Press>
          )}

          <Text style={styles.email}>{email ?? 'No email on file'}</Text>
          <View style={styles.providerPill}>
            <Text style={styles.providerLabel}>
              {PROVIDER_LABEL[provider] ?? t('auth.signIn')}
            </Text>
          </View>
        </View>

        <View style={styles.statRow}>
          <StatTile value={String(groups.length)} label={t('profile.groups')} fontSize={21} />
          <StatTile value={String(students.length)} label={t('profile.students')} fontSize={21} />
          <StatTile value={String(sessionsThisWeek)} label={t('profile.thisWeek')} fontSize={21} />
        </View>

        <Overline style={styles.label}>{t('profile.account')}</Overline>
        <Card style={styles.group}>
          <InfoRow icon="person" label={t('profile.name')} value={name || '.'} />
          <Divider inset={58} />
          <InfoRow icon="mail" label={t('profile.email')} value={email ?? '.'} />
          <Divider inset={58} />
          <InfoRow icon="tabCalendar" label={t('profile.timezone')} value={timezone} />
          <Divider inset={58} />
          <InfoRow
            icon="chat"
            label={t('profile.messagesSent')}
            value={t('profile.messagesSentValue', { count: messages.length })}
          />
        </Card>

        <Overline style={styles.label}>{t('profile.reminders')}</Overline>
        <ReminderSettings />

        <Overline style={styles.label}>{t('profile.language')}</Overline>
        <Card style={styles.group}>
          <LanguagePicker />
        </Card>
        <Text style={styles.languageHint}>{t('profile.languageHint')}</Text>

        <Overline style={styles.label}>{t('profile.appearance')}</Overline>
        <ThemePicker />

        <Overline style={styles.label}>{t('messages.templates')}</Overline>
        <Card style={[styles.group, { overflow: 'hidden' }]}>
          <ActionRow
            icon="chat"
            label={t('template.manage')}
            hint={t('profile.emailTemplatesHint')}
            onPress={() => router.push('/templates')}
          />
        </Card>

        <Overline style={styles.label}>{t('about.aboutApp')}</Overline>
        <Card style={[styles.group, { overflow: 'hidden' }]}>
          <ActionRow
            icon="info"
            label={t('about.aboutApp')}
            hint={t('about.aboutHint')}
            onPress={() => router.push('/about')}
          />
          <Divider inset={58} />
          <ActionRow
            icon="mail"
            label={t('about.support')}
            hint={t('about.supportHint')}
            onPress={() =>
              Linking.openURL(
                `mailto:smiletechweb@gmail.com?subject=${encodeURIComponent(
                  t('about.supportSubject'),
                )}`,
              ).catch(() => showAlert(t('error.cannotOpen'), t('error.noAppFor', { what: 'email' }), 'danger'))
            }
          />
        </Card>

        <Overline style={styles.label}>{t('profile.data')}</Overline>
        <Card style={styles.group}>
          <ActionRow
            icon="tabStudents"
            label={t('profile.students')}
            hint={`${students.length} / ${groups.length}`}
            onPress={() => router.push('/(tabs)/students')}
          />
          <Divider inset={58} />
          <ActionRow
            icon="info"
            label={t('profile.privacy')}
            hint={t('profile.privacyHint')}
            onPress={() =>
              showAlert(t('profile.yourData'), t('profile.privacyBody'))
            }
          />
        </Card>

        {live ? (
          <>
            <Overline style={styles.label}>{t('groups.dangerZone')}</Overline>
            <Card style={styles.group}>
              <ActionRow
                icon="close"
                label={t('auth.signOut')}
                hint={t('profile.dataStays')}
                tint={color.bg}
                fg={color.inkSoft}
                onPress={confirmSignOut}
              />
              <Divider inset={58} />
              <ActionRow
                icon="warning"
                label={busy ? t('common.sending') : t('profile.deleteAll')}
                hint={t('profile.deleteAllHint')}
                tint={status.absent.tint}
                fg={color.danger}
                labelColor={color.dangerDeep}
                onPress={busy ? undefined : confirmDelete}
              />
            </Card>
          </>
        ) : null}

        {live ? (
          <Press onPress={() => hydrate().catch(() => {})} style={styles.refresh}>
            <Text style={styles.refreshLabel}>{t('profile.refreshFromServer')}</Text>
          </Press>
        ) : null}

        <Text style={styles.version}>ClassCare 1.0.0</Text>
      </ScrollView>
    </Screen>
  );
}

function InfoRow({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Icon name={icon} size={16} color={color.inkSoft} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
}

const LEADS: ReminderLead[] = [5, 15, 30, 60];

/**
 * Class reminders, raised by the phone itself rather than by the server — the
 * schedule is already on the device, so a reminder must not depend on the
 * network being up. See `lib/notifications.ts`.
 */
function ReminderSettings() {
  const t = useT();
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const groups = useGroups();
  const on = useStore((s) => s.remindersOn);
  const lead = useStore((s) => s.reminderLead);
  const setReminders = useStore((s) => s.setReminders);

  const [blocked, setBlocked] = useState(false);
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    setCount(await scheduledReminderCount());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const apply = useCallback(
    async (nextOn: boolean, nextLead: ReminderLead) => {
      if (nextOn) {
        // Ask only when they actually turn it on — a cold prompt at launch
        // earns a "Don't allow" that iOS never offers to revisit.
        const ok = await requestNotificationPermission();
        if (!ok) {
          setBlocked(true);
          setReminders(false);
          return;
        }
        setBlocked(false);
        // Permission is the gate on getting a token at all, so this is the
        // first moment registration can succeed for a teacher who declined
        // at some earlier point.
        void registerForPush((pushToken) => updateTeacher({ pushToken }));
      }
      setReminders(nextOn, nextLead);
      if (nextOn) await rescheduleClassReminders(groups, nextLead);
      else await cancelClassReminders();
      await refresh();
    },
    [groups, refresh, setReminders],
  );

  return (
    <>
      <Card style={styles.group}>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.actionLabel}>{t('profile.remindBeforeClass')}</Text>
            <Text style={styles.actionHint} numberOfLines={2}>
              {on
                ? count
                  ? t('profile.remindersQueued', { count })
                  : t('profile.noUpcoming')
                : t('profile.reminderHint')}
            </Text>
          </View>
          <Toggle value={on} onChange={(v) => void apply(v, lead)} />
        </View>

        {on ? (
          <>
            <Divider inset={15} />
            <View style={styles.leadRow}>
              {LEADS.map((m) => {
                const active = m === lead;
                return (
                  <Press
                    key={m}
                    haptic
                    onPress={() => void apply(true, m)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    style={[
                      styles.leadChip,
                      {
                        backgroundColor: active ? color.primaryTint : color.fill,
                        borderColor: active ? color.primary : 'transparent',
                      },
                    ]}>
                    <Text
                      style={[
                        styles.leadLabel,
                        { color: active ? color.primaryInk : color.inkSoft },
                      ]}>
                      {t('profile.minutes', { count: m })}
                    </Text>
                  </Press>
                );
              })}
            </View>
          </>
        ) : null}
      </Card>

      {blocked ? (
        <Press onPress={() => Linking.openSettings()} style={styles.blockedRow}>
          <Icon name="info" size={15} color={color.warningDeep} />
          <Text style={[styles.actionHint, { color: color.warningDeep, flex: 1 }]}>
            Notifications are turned off for ClassCare. Tap to open Settings.
          </Text>
        </Press>
      ) : null}
    </>
  );
}

const THEME_OPTIONS: {
  key: ThemePref;
  labelKey: TranslationKey;
  icon: IconName;
}[] = [
  { key: 'light', labelKey: 'profile.themeLight', icon: 'sun' },
  { key: 'dark', labelKey: 'profile.themeDark', icon: 'moon' },
  { key: 'system', labelKey: 'profile.themeSystem', icon: 'phone' },
];

/**
 * Light / Dark / System. `System` keeps following the OS as it changes, so a
 * phone on auto-dark flips this app with it at sunset without a second tap.
 */
function ThemePicker() {
  const t = useT();
  const { color, pref, scheme, setPref } = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <>
      <View style={styles.themeRow}>
        {THEME_OPTIONS.map((opt) => {
          const on = pref === opt.key;
          return (
            <Press
              key={opt.key}
              haptic
              onPress={() => setPref(opt.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t(opt.labelKey)}
              style={[styles.themeCard, on && styles.themeCardOn]}>
              <View style={[styles.themeIcon, on && styles.themeIconOn]}>
                <Icon name={opt.icon} size={18} color={on ? color.primaryInk : color.mutedLight} />
              </View>
              <Text style={[styles.themeLabel, on && styles.themeLabelOn]}>
                {t(opt.labelKey)}
              </Text>
            </Press>
          );
        })}
      </View>
      {/* Only meaningful under `system` — otherwise the chosen card says it. */}
      {pref === 'system' ? (
        <Text style={styles.themeFootnote}>{scheme}</Text>
      ) : null}
    </>
  );
}

function ActionRow({
  icon,
  label,
  hint,
  onPress,
  tint: tintProp,
  fg: fgProp,
  labelColor: labelColorProp,
}: {
  icon: IconName;
  label: string;
  hint: string;
  onPress?: () => void;
  tint?: string;
  fg?: string;
  labelColor?: string;
}) {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const tint = tintProp ?? color.fill;
  const fg = fgProp ?? color.inkSoft;
  const labelColor = labelColorProp ?? color.ink;
  return (
    <Press onPress={onPress} disabled={!onPress} style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: tint }]}>
        <Icon name={icon} size={16} color={fg} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.actionLabel, { color: labelColor }]}>{label}</Text>
        <Text style={styles.actionHint} numberOfLines={1}>
          {hint}
        </Text>
      </View>
      <Icon name="disclosure" size={16} color={color.chevron} />
    </Press>
  );
}

const makeStyles = ({ color, status }: Theme) =>
  StyleSheet.create({
    identity: { alignItems: 'center', paddingTop: 8, paddingBottom: 22 },
    avatar: {
      width: 88,
      height: 88,
      borderRadius: 30,
      backgroundColor: color.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarImage: {
      width: 88,
      height: 88,
      borderRadius: 30,
      backgroundColor: color.primaryTint,
    },
    avatarInitials: { fontFamily: display[600], fontSize: 30, color: '#fff' },

    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 16,
    },
    name: { ...text.pageTitle, color: color.ink },
    editRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 16,
      width: '100%',
    },
    nameInput: {
      flex: 1,
      height: 44,
      paddingHorizontal: 14,
      borderRadius: radius.control,
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: color.border,
      fontFamily: body[600],
      fontSize: 16,
      color: color.ink,
    },
    email: {
      fontFamily: body[400],
      fontSize: 13.5,
      color: color.muted,
      marginTop: 6,
    },
    providerPill: {
      marginTop: 12,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.md,
      backgroundColor: color.primaryTint,
    },
    providerPillDemo: { backgroundColor: status.late.tint },

    toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 15,
    paddingVertical: 13,
  },
  leadRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 15, paddingVertical: 12 },
  leadChip: {
    flex: 1,
    height: 38,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leadLabel: { fontFamily: body[700], fontSize: 12.5 },
  blockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    marginTop: -14,
    marginBottom: 18,
  },

  themeRow: { flexDirection: 'row', gap: 10, marginBottom: 4 },
    themeCard: {
      flex: 1,
      backgroundColor: color.surface,
      borderWidth: 1.5,
      borderColor: color.border,
      borderRadius: radius.card,
      paddingVertical: 14,
      paddingHorizontal: 10,
      alignItems: 'center',
      gap: 7,
    },
    themeCardOn: {
      borderColor: color.primary,
      backgroundColor: color.primaryTint,
    },
    themeIcon: {
      width: 38,
      height: 38,
      borderRadius: radius.control,
      backgroundColor: color.fill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    themeIconOn: { backgroundColor: color.surface },
    themeLabel: { fontFamily: body[700], fontSize: 14, color: color.ink },
    themeLabelOn: { color: color.primaryInk },
    themeHint: {
      fontFamily: body[500],
      fontSize: 10.5,
      color: color.mutedLight,
    },
    themeFootnote: {
      fontFamily: body[500],
      fontSize: 12,
      color: color.mutedLight,
      marginTop: 8,
      marginBottom: 2,
    },
    providerLabel: {
      fontFamily: body[600],
      fontSize: 12,
      color: color.primaryInk,
    },

    statRow: { flexDirection: 'row', gap: 10, marginBottom: 22 },
    label: { marginBottom: 10 },
    group: { overflow: 'hidden', marginBottom: 22 },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 13,
    },
    rowIcon: {
      width: 32,
      height: 32,
      borderRadius: radius.md,
      backgroundColor: color.fill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowLabel: {
      fontFamily: body[700],
      fontSize: 10.5,
      letterSpacing: 0.84,
      textTransform: 'uppercase',
      color: color.mutedLight,
    },
    rowValue: {
      fontFamily: body[600],
      fontSize: 14.5,
      color: color.ink,
      marginTop: 2,
    },
    // `Text` does not inherit colour from its parent View, and the default is
    // black — which is invisible on a dark card. Every other caller passed a
    // colour explicitly, so only the reminder row showed the bug.
    actionLabel: { fontFamily: body[700], fontSize: 14.5, color: color.ink },
    languageHint: {
      fontFamily: body[400],
      fontSize: 12,
      lineHeight: 17,
      color: color.mutedLight,
      marginTop: -12,
      marginBottom: 22,
      paddingHorizontal: 4,
    },
    actionHint: {
      fontFamily: body[400],
      fontSize: 12.5,
      color: color.mutedLight,
      marginTop: 2,
    },

    demoCard: { padding: 18, marginBottom: 22 },
    demoTitle: { fontFamily: body[700], fontSize: 15, color: color.ink },
    demoHint: {
      fontSize: 13.5,
      lineHeight: 20,
      color: color.muted,
      marginTop: 5,
    },

    refresh: { height: 44, alignItems: 'center', justifyContent: 'center' },
    refreshLabel: {
      fontFamily: body[600],
      fontSize: 13.5,
      color: color.primary,
    },

    version: {
      fontFamily: body[400],
      fontSize: 11.5,
      color: color.faint,
      textAlign: 'center',
      marginTop: 12,
    },
  });

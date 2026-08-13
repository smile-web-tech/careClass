/**
 * Everything that is a setting, in one place.
 *
 * These all used to live on Profile, below the teacher's name and stats: eight
 * sections, two of them with their own controls, one of them the delete-
 * everything button. A screen that is both "who am I" and "how does this app
 * behave" is a screen where neither is easy to find, and the important half was
 * the half you had to scroll past the other to reach.
 *
 * Profile keeps the account, and the one door to the templates. This keeps the
 * behaviour: reminders, language, appearance, backups, permissions, and the
 * app's own details.
 */
import Constants from 'expo-constants';
import { File } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirm, showAlert, showError } from '@/components/Dialog';
import { Icon, type IconName } from '@/components/Icon';
import { LanguagePicker } from '@/components/LanguagePicker';
import { Screen, TopBar } from '@/components/layout';
import { ActionRow } from '@/components/SettingsRows';
import { Card, Divider, Overline, Press, Toggle } from '@/components/ui';
import { updateTeacher } from '@/data/api';
import { applyBackup, BackupError, exportBackup, readBackup, summarise } from '@/data/backup';
import { useGroups, useStore } from '@/data/store';
import { hydrate } from '@/data/sync';
import type { TranslationKey } from '@/i18n';
import { useT } from '@/i18n/useT';
import { SUPPORT_EMAIL } from '@/lib/brand';
import {
  cancelClassReminders,
  getDevicePushToken,
  notificationPermissionStatus,
  registerForPush,
  requestNotificationPermission,
  rescheduleReminders,
  scheduledReminderCount,
  type ReminderLead,
} from '@/lib/notifications';
import { hasSupabase } from '@/lib/supabase';
import { radius, space, useTheme, useThemedStyles, type Theme, type ThemePref } from '@/theme';
import { body } from '@/theme/type';

/** Why a chosen file could not be read, in words rather than in a code. */
const BACKUP_ERROR_KEY: Record<BackupError['reason'], TranslationKey> = {
  notJson: 'backup.errorNotJson',
  notBackup: 'backup.errorNotBackup',
  tooNew: 'backup.errorTooNew',
  empty: 'backup.errorEmpty',
};

export default function Settings() {
  const t = useT();
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  /** Which backup job is running, so the row can say so and refuse a second. */
  const [busyBackup, setBusyBackup] = useState<'export' | 'import' | null>(null);
  const live = hasSupabase;

  /**
   * Write the whole account to a file and hand it to whatever the teacher
   * wants to send it with.
   *
   * `shareAsync` rather than saving to Downloads: the file is on its way to
   * another phone, and the share sheet is where Bluetooth, WhatsApp and the
   * file manager all already are. A copy stays in `ClassCare/backups` either
   * way.
   */
  const doExport = async () => {
    if (busyBackup) return;
    setBusyBackup('export');
    try {
      const file = await exportBackup();

      /*
        Loaded here rather than imported at the top of the file.

        An Expo module resolves its native side at import time, so a top-level
        import crashes the whole screen on a build that predates the package —
        for a feature the teacher may never touch. Failing on the button
        instead keeps the rest of the screen working.
      */
      let Sharing: typeof import('expo-sharing');
      try {
        Sharing = require('expo-sharing') as typeof import('expo-sharing');
      } catch {
        await showAlert(t('backup.exported'), t('backup.savedTo', { path: file.uri }));
        return;
      }

      if (!(await Sharing.isAvailableAsync())) {
        // No share sheet — a rooted or stripped device. The file exists, so
        // say where it is rather than pretending nothing happened.
        await showAlert(t('backup.exported'), t('backup.savedTo', { path: file.uri }));
        return;
      }

      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        dialogTitle: t('backup.export'),
      });
    } catch (e) {
      showError(e, t('backup.exportFailed'));
    } finally {
      setBusyBackup(null);
    }
  };

  /**
   * Read a backup file and, once the teacher has seen what is in it, replace
   * this device's data with it.
   *
   * Replace rather than merge, and the confirmation says so with the counts in
   * it. Merging two copies of the same class means deciding which version of a
   * mark is right, and there is no honest way to do that without asking about
   * every difference.
   */
  const doImport = async () => {
    if (busyBackup) return;

    // One file, so the single-file overload: it hands back the `File` itself
    // rather than an array.
    const picked = await File.pickFileAsync({ mimeTypes: ['application/json', '*/*'] });
    if (picked.canceled) return;

    setBusyBackup('import');
    try {
      const backup = await readBackup(picked.result);
      const summary = summarise(backup);

      const yes = await confirm({
        title: t('backup.importTitle'),
        message: t('backup.importSummary', {
          groups: summary.groups,
          students: summary.students,
          photos: summary.photos,
          date: summary.exportedAt.slice(0, 10),
        }),
        confirmLabel: t('backup.importConfirm'),
      });
      if (!yes) return;

      await applyBackup(backup);
      await showAlert(
        t('backup.imported'),
        t('backup.importedBody', { students: summary.students }),
        'success',
      );
    } catch (e) {
      if (e instanceof BackupError) {
        await showAlert(t('backup.importFailed'), t(BACKUP_ERROR_KEY[e.reason]), 'danger');
      } else {
        showError(e, t('backup.importFailed'));
      }
    } finally {
      setBusyBackup(null);
    }
  };

  return (
    <Screen>
      <TopBar title={t('settings.title')} />

      <ScrollView
        contentContainerStyle={{ padding: space.gutter, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}>
        <Overline style={styles.label}>{t('profile.reminders')}</Overline>
        <ReminderSettings />

        <Overline style={styles.label}>{t('profile.language')}</Overline>
        <Card style={styles.group}>
          <LanguagePicker />
        </Card>
        <Text style={styles.languageHint}>{t('profile.languageHint')}</Text>

        <Overline style={styles.label}>{t('profile.appearance')}</Overline>
        <ThemePicker />

        {/*
          A file the teacher owns, that works with no server involved. Moving to
          a new phone in a place where the connection is a sometimes thing
          should not depend on anybody's infrastructure.
        */}
        <Overline style={styles.label}>{t('backup.section')}</Overline>
        <Card style={styles.group}>
          <ActionRow
            icon="cloudUp"
            label={busyBackup === 'export' ? t('backup.exporting') : t('backup.export')}
            hint={t('backup.exportHint')}
            onPress={() => void doExport()}
          />
          <Divider inset={58} />
          <ActionRow
            icon="paperclip"
            label={busyBackup === 'import' ? t('backup.importing') : t('backup.import')}
            hint={t('backup.importHint')}
            onPress={() => void doImport()}
          />
        </Card>

        <Overline style={styles.label}>{t('profile.data')}</Overline>
        <Card style={styles.group}>
          <ActionRow
            icon="bell"
            label={t('perm.manage')}
            hint={t('perm.manageHint')}
            onPress={() => router.push('/permissions')}
          />
          <Divider inset={58} />
          <ActionRow
            icon="info"
            label={t('profile.privacy')}
            hint={t('profile.privacyHint')}
            onPress={() => showAlert(t('profile.yourData'), t('profile.privacyBody'))}
          />
          {live ? (
            <>
              <Divider inset={58} />
              <ActionRow
                icon="refresh"
                label={t('profile.refreshFromServer')}
                hint={t('settings.refreshHint')}
                onPress={() => void hydrate().catch(() => {})}
              />
            </>
          ) : null}
        </Card>

        <Overline style={styles.label}>{t('about.aboutApp')}</Overline>
        <Card style={styles.group}>
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
                `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(t('about.supportSubject'))}`,
              ).catch(() =>
                showAlert(t('error.cannotOpen'), t('error.noAppFor', { what: 'email' }), 'danger'),
              )
            }
          />
        </Card>

        {/* Read from the manifest rather than typed in here, which is how it
            came to say 1.0.0 three releases after it was. */}
        <Text style={styles.version}>
          ClassCare {Constants.expoConfig?.version ?? ''}
        </Text>
      </ScrollView>
    </Screen>
  );
}

const LEADS: ReminderLead[] = [5, 10, 15, 20, 30, 60];

/**
 * Reminders, raised by the phone itself rather than by the server — the
 * calendar is already on the device, so a reminder must not depend on the
 * network being up. See `lib/notifications.ts`.
 *
 * One switch and one lead time for everything in the calendar. It used to say
 * "Remind before class" and mean exactly that, so an event a teacher typed in
 * themselves was kept and never mentioned again.
 */
function ReminderSettings() {
  const t = useT();
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const groups = useGroups();
  const events = useStore((s) => s.events);
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
      // Written straight to the device's own settings table, so the choice
      // survives a relaunch — see `data/persistence.ts`.
      setReminders(nextOn, nextLead);
      if (nextOn) await rescheduleReminders(groups, events, nextLead);
      else await cancelClassReminders();
      await refresh();
    },
    [events, groups, refresh, setReminders],
  );

  return (
    <>
      <Card style={styles.group}>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.actionLabel}>{t('profile.remindBefore')}</Text>
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
            {t('profile.notificationsBlocked')}
          </Text>
        </Press>
      ) : null}

      <PushStatus />
    </>
  );
}

/**
 * Whether this phone can receive a push at all.
 *
 * Reminders are raised by the phone; a parent's reply is raised by the server,
 * and that needs a device token registered against the account. When it is
 * missing there is nothing on screen to say so — push simply never arrives, and
 * from the teacher's side that is indistinguishable from nobody having written
 * back. This says which of the three it is, and retries when tapped.
 */
function PushStatus() {
  const t = useT();
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [state, setState] = useState<'checking' | 'ready' | 'unavailable' | 'off'>('checking');

  const check = useCallback(async () => {
    const permission = await notificationPermissionStatus();
    if (permission !== 'granted') {
      setState('off');
      return;
    }
    // A token means Play Services answered and the build carries the FCM
    // config. No token is the answer to "why does push do nothing".
    setState((await getDevicePushToken()) ? 'ready' : 'unavailable');
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const retry = async () => {
    setState('checking');
    await registerForPush((pushToken) => updateTeacher({ pushToken })).catch(() => false);
    await check();
  };

  const hint: TranslationKey =
    state === 'ready'
      ? 'profile.pushReady'
      : state === 'unavailable'
        ? 'profile.pushUnavailable'
        : state === 'off'
          ? 'profile.pushOff'
          : 'profile.pushChecking';

  return (
    <Card style={styles.group}>
      <Press onPress={() => void retry()} style={styles.toggleRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.actionLabel}>{t('profile.pushTitle')}</Text>
          <Text style={styles.actionHint}>{t(hint)}</Text>
        </View>
        <Icon
          name={state === 'ready' ? 'check' : 'refresh'}
          size={16}
          color={state === 'ready' ? color.successDeep : color.inkSoft}
        />
      </Press>
    </Card>
  );
}

const THEME_OPTIONS: { key: ThemePref; labelKey: TranslationKey; icon: IconName }[] = [
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
    <View style={{ marginBottom: 22 }}>
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
              <Text style={[styles.themeLabel, on && styles.themeLabelOn]}>{t(opt.labelKey)}</Text>
            </Press>
          );
        })}
      </View>
      {/* Only meaningful under `system` — otherwise the chosen card says it. */}
      {pref === 'system' ? <Text style={styles.themeFootnote}>{scheme}</Text> : null}
    </View>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    label: { marginBottom: 10 },
    group: { overflow: 'hidden', marginBottom: 22 },

    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 15,
      paddingVertical: 13,
    },
    actionLabel: { fontFamily: body[700], fontSize: 14.5, color: color.ink },
    actionHint: { fontFamily: body[400], fontSize: 12.5, color: color.mutedLight, marginTop: 2 },

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

    languageHint: {
      fontFamily: body[400],
      fontSize: 12,
      lineHeight: 17,
      color: color.mutedLight,
      marginTop: -12,
      marginBottom: 22,
      paddingHorizontal: 4,
    },

    themeRow: { flexDirection: 'row', gap: 10 },
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
    themeCardOn: { borderColor: color.primary, backgroundColor: color.primaryTint },
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
    themeFootnote: {
      fontFamily: body[500],
      fontSize: 12,
      color: color.mutedLight,
      marginTop: 8,
    },

    version: {
      fontFamily: body[400],
      fontSize: 11.5,
      color: color.faint,
      textAlign: 'center',
      marginTop: 4,
    },
  });

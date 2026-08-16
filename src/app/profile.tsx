/**
 * The teacher's own account, and nothing else.
 *
 * Everything that governs how the app behaves — reminders, language, theme,
 * templates, backups, permissions — moved to `settings.tsx`. This screen had
 * grown to eight sections of settings under a name and a photo, which made the
 * two things it was for equally hard to find. What is left is who is signed in,
 * what they have, and the two account actions nobody should have to hunt for.
 */
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirm, showError } from '@/components/Dialog';
import { Icon } from '@/components/Icon';
import { Screen, TopBar } from '@/components/layout';
import { ActionRow, InfoRow } from '@/components/SettingsRows';
import { Button, Card, Divider, Overline, Press, StatTile } from '@/components/ui';
import { deleteAccountData, updateTeacher } from '@/data/api';
import { useGroups, useStore, useStudents } from '@/data/store';
import { wipeLocal } from '@/data/persistence';
import { clearQueue, flushWrites } from '@/data/sync';
import { useSyncStatus } from '@/data/syncStatus';
import type { TranslationKey } from '@/i18n';
import { useT } from '@/i18n/useT';
import { signOut } from '@/lib/auth';
import { weekDays } from '@/lib/date';
import { sessionsForWeek } from '@/lib/schedule';
import { hasSupabase } from '@/lib/supabase';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, display, text } from '@/theme/type';

/** How this session was established, in the teacher's language. */
const PROVIDER_KEY: Record<string, TranslationKey> = {
  google: 'profile.viaGoogle',
  apple: 'profile.viaApple',
  email: 'profile.viaEmail',
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
    /*
      Signing out throws away this device's copy of the account, including
      anything still queued for the server. On a connection that comes and goes
      that queue can be a whole afternoon of registers, and losing it silently
      would be the worst bug in the app — so when there is unsent work the
      warning says so plainly instead of the usual one.
    */
    let unsent = useSyncStatus.getState().pending;

    /*
      Try to send it before asking anything.

      The old flow warned that N changes would be lost and then lost them, which
      put the teacher in the position of choosing between staying signed in and
      throwing away an afternoon of work — when almost always there is a signal
      and the queue would drain in a couple of seconds if anybody asked it to.
      So ask it first, and only raise the warning for what genuinely will not
      go.
    */
    if (unsent > 0 && live) {
      setBusy(true);
      try {
        await flushWrites();
      } catch {
        // Offline or refused. The count below is now the honest one either way.
      } finally {
        setBusy(false);
      }
      unsent = useSyncStatus.getState().pending;
    }

    const yes = await confirm({
      title: t('auth.signOutTitle'),
      message: unsent > 0 ? t('auth.signOutUnsent', { count: unsent }) : t('auth.signOutMessage'),
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
    await clearQueue();
    doSignOut();
    // The device's copy goes with the session. A shared staffroom phone is
    // exactly how this app gets used.
    await wipeLocal();
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
              <Text style={styles.name}>{name || t('profile.addName')}</Text>
              <Icon name="pencil" size={16} color={color.mutedLight} />
            </Press>
          )}

          <Text style={styles.email}>{email ?? t('profile.noEmail')}</Text>
          <View style={styles.providerPill}>
            <Text style={styles.providerLabel}>{t(PROVIDER_KEY[provider] ?? 'auth.signIn')}</Text>
          </View>
        </View>

        <View style={styles.statRow}>
          <StatTile value={String(groups.length)} label={t('profile.groups')} fontSize={21} />
          <StatTile value={String(students.length)} label={t('profile.students')} fontSize={21} />
          <StatTile value={String(sessionsThisWeek)} label={t('profile.thisWeek')} fontSize={21} />
        </View>

        {/*
          The name and the address are already on the card above, in larger
          type. Repeating them here was two more rows to scroll past before
          anything actionable.
        */}
        <Overline style={styles.label}>{t('profile.account')}</Overline>
        <Card style={styles.group}>
          <InfoRow icon="tabCalendar" label={t('profile.timezone')} value={timezone} />
          <Divider inset={58} />
          <InfoRow
            icon="chat"
            label={t('profile.messagesSent')}
            value={t('profile.messagesSentValue', { count: messages.length })}
          />
        </Card>

        {/*
          One way in to everything the app does, rather than eight sections of
          it stacked under the teacher's photograph.
        */}
        <Card style={styles.group}>
          <ActionRow
            icon="gear"
            label={t('settings.title')}
            hint={t('settings.hint')}
            onPress={() => router.push('/settings')}
          />
          <Divider inset={58} />
          <ActionRow
            icon="chat"
            label={t('template.manage')}
            hint={t('profile.emailTemplatesHint')}
            onPress={() => router.push('/templates')}
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
      </ScrollView>
    </Screen>
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

    providerLabel: {
      fontFamily: body[600],
      fontSize: 12,
      color: color.primaryInk,
    },

    statRow: { flexDirection: 'row', gap: 10, marginBottom: 22 },
    label: { marginBottom: 10 },
    group: { overflow: 'hidden', marginBottom: 22 },


  });

import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/Icon';
import { Screen, TopBar } from '@/components/layout';
import { Button, Card, Divider, Overline, Press, StatTile, Txt } from '@/components/ui';
import { deleteAccountData, updateTeacher } from '@/data/api';
import { useGroups, useStore, useStudents } from '@/data/store';
import { hydrate } from '@/data/sync';
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
  demo: 'Demo mode — nothing is saved to an account',
};

export default function Profile() {
  const { color, scheme, status } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const groups = useGroups();
  const students = useStudents();
  const messages = useStore((s) => s.messages);
  const demo = useStore((s) => s.demo);
  const name = useStore((s) => s.teacherName);
  const email = useStore((s) => s.teacherEmail);
  const avatarUrl = useStore((s) => s.teacherAvatarUrl);
  const provider = useStore((s) => s.teacherProvider);
  const doSignOut = useStore((s) => s.signOut);

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [busy, setBusy] = useState(false);

  const live = hasSupabase && !demo;
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
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    }
  };

  const confirmSignOut = () => {
    Alert.alert('Sign out?', 'Your groups and students stay in your account.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          if (live) {
            try {
              await signOut();
            } catch {
              // Even if the network call fails, drop the local session.
            }
          }
          doSignOut();
          router.replace('/sign-in');
        },
      },
    ]);
  };

  /**
   * Two-step, because this is unrecoverable. Removing the `teachers` row
   * cascades through every table — groups, students, attendance, message
   * history. The auth user itself survives; that needs the admin API.
   */
  const confirmDelete = () => {
    Alert.alert(
      'Delete all your data?',
      `This removes ${groups.length} groups, ${students.length} students and every attendance record and message. It cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: () =>
            Alert.alert('Are you certain?', 'There is no undo and no backup.', [
              { text: 'Keep my data', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  setBusy(true);
                  try {
                    await deleteAccountData();
                    await signOut();
                    doSignOut();
                    router.replace('/sign-in');
                  } catch (e) {
                    Alert.alert('Could not delete', e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy(false);
                  }
                },
              },
            ]),
        },
      ],
    );
  };

  return (
    <Screen>
      <TopBar title="Profile" />

      <ScrollView
        contentContainerStyle={{
          padding: space.gutter,
          paddingBottom: insets.bottom + 40,
        }}
        keyboardShouldPersistTaps="handled"
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
                label="Save"
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
          <View style={[styles.providerPill, demo && styles.providerPillDemo]}>
            <Text style={[styles.providerLabel, demo && { color: color.warningDeep }]}>
              {PROVIDER_LABEL[provider] ?? 'Signed in'}
            </Text>
          </View>
        </View>

        <View style={styles.statRow}>
          <StatTile value={String(groups.length)} label="Groups" fontSize={21} />
          <StatTile value={String(students.length)} label="Students" fontSize={21} />
          <StatTile value={String(sessionsThisWeek)} label="This week" fontSize={21} />
        </View>

        <Overline style={styles.label}>Account</Overline>
        <Card style={styles.group}>
          <InfoRow icon="person" label="Name" value={name || '—'} />
          <Divider inset={58} />
          <InfoRow icon="mail" label="Email" value={email ?? '—'} />
          <Divider inset={58} />
          <InfoRow icon="tabCalendar" label="Time zone" value={timezone} />
          <Divider inset={58} />
          <InfoRow icon="chat" label="Messages sent" value={`${messages.length} in your history`} />
        </Card>

        <Overline style={styles.label}>Appearance</Overline>
        <ThemePicker />

        <Overline style={styles.label}>Data</Overline>
        <Card style={styles.group}>
          <ActionRow
            icon="tabStudents"
            label="Your students"
            hint={`${students.length} across ${groups.length} groups`}
            onPress={() => router.push('/(tabs)/students')}
          />
          <Divider inset={58} />
          <ActionRow
            icon="info"
            label="Privacy"
            hint="What ClassCare stores and why"
            onPress={() =>
              Alert.alert(
                'Your data',
                live
                  ? 'Your groups, students and attendance live in your own Supabase account, behind row level security — no other teacher can read them.\n\nStudent phone numbers are only sent to an SMS gateway at the moment you send a message.'
                  : 'Demo mode keeps everything on this device. Nothing is uploaded anywhere.',
              )
            }
          />
        </Card>

        {live ? (
          <>
            <Overline style={styles.label}>Danger zone</Overline>
            <Card style={styles.group}>
              <ActionRow
                icon="close"
                label="Sign out"
                hint="Your data stays in your account"
                tint={color.bg}
                fg={color.inkSoft}
                onPress={confirmSignOut}
              />
              <Divider inset={58} />
              <ActionRow
                icon="warning"
                label={busy ? 'Deleting…' : 'Delete all my data'}
                hint="Groups, students, attendance, messages — permanently"
                tint={status.absent.tint}
                fg={color.danger}
                labelColor={color.dangerDeep}
                onPress={busy ? undefined : confirmDelete}
              />
            </Card>
          </>
        ) : (
          <Card style={styles.demoCard}>
            <Text style={styles.demoTitle}>You&rsquo;re exploring with demo data</Text>
            <Txt style={styles.demoHint}>
              Nothing here is saved to an account. Sign in to keep your own groups and students.
            </Txt>
            <Button
              label="Sign in"
              onPress={() => {
                doSignOut();
                router.replace('/sign-in');
              }}
              style={{ marginTop: 14 }}
            />
          </Card>
        )}

        {live ? (
          <Press onPress={() => hydrate().catch(() => {})} style={styles.refresh}>
            <Text style={styles.refreshLabel}>Refresh from server</Text>
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

const THEME_OPTIONS: {
  key: ThemePref;
  label: string;
  icon: IconName;
  hint: string;
}[] = [
  { key: 'light', label: 'Light', icon: 'sun', hint: 'Always light' },
  { key: 'dark', label: 'Dark', icon: 'moon', hint: 'Always dark' },
  { key: 'system', label: 'System', icon: 'phone', hint: 'Match the phone' },
];

/**
 * Light / Dark / System. `System` keeps following the OS as it changes, so a
 * phone on auto-dark flips this app with it at sunset without a second tap.
 */
function ThemePicker() {
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
              accessibilityLabel={`${opt.label} theme`}
              style={[styles.themeCard, on && styles.themeCardOn]}>
              <View style={[styles.themeIcon, on && styles.themeIconOn]}>
                <Icon name={opt.icon} size={18} color={on ? color.primaryInk : color.mutedLight} />
              </View>
              <Text style={[styles.themeLabel, on && styles.themeLabelOn]}>{opt.label}</Text>
              <Text style={styles.themeHint} numberOfLines={1}>
                {opt.hint}
              </Text>
            </Press>
          );
        })}
      </View>
      {/* Only meaningful under `system` — otherwise the chosen card says it. */}
      {pref === 'system' ? (
        <Text style={styles.themeFootnote}>Following your phone, currently {scheme}.</Text>
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
    actionLabel: { fontFamily: body[700], fontSize: 14.5 },
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

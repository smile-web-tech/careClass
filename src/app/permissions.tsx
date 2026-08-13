/**
 * What the app needs, asked once, on the way in.
 *
 * Every permission is requested here rather than at the moment it is first
 * needed. That is a deliberate reversal of the usual advice, and it is right
 * for this app: these teachers are on the phone in front of a class, and a
 * dialog appearing mid-lesson because they happened to tap Attendance is worse
 * than one screen at the start that explains the lot.
 *
 * What makes it work is the order. Nothing is requested until the teacher has
 * read what each one is for and pressed Allow — Android permits two refusals
 * before it stops showing the dialog for good, so the single chance to ask has
 * to arrive with its reason attached. A cold system prompt for "send SMS" from
 * a class-management app reads as malware and is denied permanently.
 *
 * Nothing here is required, and the screen says so. Refusing SMS leaves the
 * composer sending email; refusing the camera leaves students with initials.
 * Skip is a real option, and this is reachable again from Profile.
 */
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Screen, StickyFooter, TopBar } from '@/components/layout';
import { Button, Card, Press } from '@/components/ui';
import { useStore } from '@/data/store';
import { useT } from '@/i18n/useT';
import {
  applicablePermissions,
  readPermissionStates,
  requestPermission,
  type PermissionKey,
  type PermissionState,
} from '@/lib/permissions';
import { rescheduleBirthdays, rescheduleClassReminders } from '@/lib/notifications';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, text } from '@/theme/type';

export default function Permissions() {
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { color, accents } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const markAsked = useStore((s) => s.markPermissionsAsked);

  const rows = applicablePermissions();
  const [states, setStates] = useState<Partial<Record<PermissionKey, PermissionState>>>({});
  /** Which one the system is showing a dialog for, so the row can say so. */
  const [asking, setAsking] = useState<PermissionKey | null>(null);
  const [ran, setRan] = useState(false);

  useEffect(() => {
    let alive = true;
    void readPermissionStates().then((next) => alive && setStates(next));
    return () => {
      alive = false;
    };
  }, []);

  /**
   * One dialog at a time, in order.
   *
   * Android shows them serially whatever the caller does; asking in parallel
   * only produces a stack the teacher taps through without reading, which is
   * how a permission gets refused by accident.
   */
  const askAll = async () => {
    setRan(true);
    for (const permission of rows) {
      if (states[permission.key] === 'granted') continue;
      setAsking(permission.key);
      const result = await requestPermission(permission.key);
      setStates((previous) => ({ ...previous, [permission.key]: result }));
    }
    setAsking(null);
  };

  const finish = () => {
    markAsked();

    /*
      Plan the reminders now that we may finally be allowed to.

      Scheduling is gated on the OS permission, and the effect in the root
      layout ran long before this screen was answered — so without this the
      first reminders are not queued until the app is next brought to the
      foreground. A teacher who grants notifications and then has a class in an
      hour gets nothing, which reads as reminders being broken.
    */
    const { groups, students, remindersOn, reminderLead } = useStore.getState();
    if (remindersOn) void rescheduleClassReminders(groups, reminderLead);
    void rescheduleBirthdays(students);

    router.replace('/(tabs)');
  };

  const anyDenied = rows.some((p) => states[p.key] === 'denied');

  return (
    <Screen>
      <TopBar title={t('perm.title')} />

      <ScrollView
        contentContainerStyle={{ padding: space.gutter, paddingBottom: insets.bottom + 140 }}
        showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>{t('perm.intro')}</Text>

        <View style={{ gap: 10, marginTop: 18 }}>
          {rows.map((permission) => {
            const state = states[permission.key];
            const busy = asking === permission.key;

            return (
              <Card key={permission.key} style={styles.row}>
                <View
                  style={[
                    styles.glyph,
                    {
                      backgroundColor:
                        state === 'granted' ? accents.emerald.tint : color.primaryTint,
                    },
                  ]}>
                  <Icon
                    name={permission.icon}
                    size={17}
                    color={state === 'granted' ? accents.emerald.ink : color.primaryInk}
                  />
                </View>

                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowTitle}>{t(permission.titleKey)}</Text>
                  <Text style={styles.rowWhy}>{t(permission.reasonKey)}</Text>
                </View>

                {busy ? (
                  <ActivityIndicator color={color.primary} />
                ) : state === 'granted' ? (
                  <Icon name="check" size={16} color={color.successDeep} />
                ) : state === 'denied' ? (
                  <Text style={[styles.status, { color: color.mutedLight }]}>
                    {t('perm.denied')}
                  </Text>
                ) : null}
              </Card>
            );
          })}
        </View>

        {/* Only once something has actually been refused. Saying it up front
            would read as an instruction rather than a reassurance. */}
        {ran && anyDenied ? <Text style={styles.settings}>{t('perm.openSettings')}</Text> : null}
      </ScrollView>

      <StickyFooter style={{ gap: 10 }}>
        <Press onPress={finish} style={styles.skip}>
          <Text style={styles.skipLabel}>{ran ? t('perm.done') : t('perm.skip')}</Text>
        </Press>
        <Button
          grow
          height={50}
          label={asking ? t('perm.asking') : t('perm.allow')}
          disabled={asking !== null}
          onPress={() => void askAll()}
        />
      </StickyFooter>
    </Screen>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    intro: { ...text.body, color: color.muted },

    row: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 14 },
    glyph: {
      width: 38,
      height: 38,
      borderRadius: radius.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowTitle: { fontFamily: body[700], fontSize: 14.5, color: color.ink },
    rowWhy: {
      fontFamily: body[400],
      fontSize: 12.5,
      lineHeight: 18,
      color: color.mutedLight,
      marginTop: 2,
    },
    status: { fontFamily: body[600], fontSize: 12 },

    settings: {
      fontFamily: body[400],
      fontSize: 12.5,
      color: color.mutedLight,
      textAlign: 'center',
      marginTop: 18,
    },

    skip: { height: 50, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
    skipLabel: { fontFamily: body[700], fontSize: 14.5, color: color.muted },
  });

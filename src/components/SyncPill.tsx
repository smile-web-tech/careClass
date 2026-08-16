/**
 * Whether this phone and the server agree, and the button that makes them.
 *
 * The internet in Turkmenistan comes and goes, so the app writes locally first
 * and pushes in the background. That is invisible when it works, and invisible
 * is exactly wrong when it does not: a teacher who took a register in a
 * basement needs to know it is still sitting on the phone, and needs somewhere
 * to press when they walk back into signal.
 *
 * Four states, one row:
 *
 *  - **Synced** — quiet by design. Nothing is wrong, so nothing shouts. Still
 *    tappable, because "did that actually go?" is a question people ask.
 *  - **Waiting** — the count, in the accent colour, with a Sync button. This is
 *    the state the whole component exists for.
 *  - **Offline** — the same count, amber, saying why it has not gone.
 *  - **Syncing** — a spinner, and no way to press it twice.
 *
 * The banner in `SyncBanner` is a different job: it appears over any screen the
 * moment a write is rejected outright. This lives on the home screen and is
 * about the ordinary state of things.
 */
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useRouter } from 'expo-router';

import { showAlert } from '@/components/Dialog';
import { Icon, type IconName } from '@/components/Icon';
import { Press } from '@/components/ui';
import { useStore } from '@/data/store';
import { syncNow } from '@/data/sync';
import { useSyncStatus } from '@/data/syncStatus';
import { useT } from '@/i18n/useT';
import { radius, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body } from '@/theme/type';

export function SyncPill({ style }: { style?: object }) {
  const t = useT();
  const { color, accents } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  const localOnly = useStore((s) => s.offline);
  const pending = useSyncStatus((s) => s.pending);
  const offline = useSyncStatus((s) => s.offline);
  const syncing = useSyncStatus((s) => s.syncing);

  const [pressed, setPressed] = useState(false);
  const busy = syncing || pressed;

  /*
    With no account there is nothing to sync, and saying "Synced" would be a
    lie: the work is on this handset and nowhere else, and the teacher should
    be able to change that from the place they look to check.
  */
  if (localOnly) {
    return (
      <Press
        onPress={() => router.push('/sign-in')}
        accessibilityRole="button"
        accessibilityLabel={t('auth.signInToBackUp')}
        style={[styles.pill, { backgroundColor: accents.amber.tint }, style]}>
        <View style={styles.glyph}>
          <Icon name="cloudUp" size={14} color={accents.amber.ink} />
        </View>
        <Text style={[styles.label, { color: accents.amber.ink }]} numberOfLines={1}>
          {t('sync.onThisPhone')}
        </Text>
        <View style={[styles.action, { borderColor: accents.amber.ink + '40' }]}>
          <Text style={[styles.actionLabel, { color: accents.amber.ink }]}>{t('auth.signIn')}</Text>
        </View>
      </Press>
    );
  }

  const run = async () => {
    if (busy) return;
    setPressed(true);
    try {
      const outcome = await syncNow();
      if (outcome === 'offline') {
        await showAlert(t('sync.stillOfflineTitle'), t('sync.stillOfflineBody'));
      } else if (outcome === 'failed') {
        await showAlert(t('sync.failedTitle'), t('sync.failedBody'), 'danger');
      }
    } finally {
      setPressed(false);
    }
  };

  const look: { tone: string; tint: string; icon: IconName; label: string } = busy
    ? {
        tone: color.primary,
        tint: color.primaryTint,
        icon: 'refresh',
        label: t('sync.syncing'),
      }
    : offline
      ? {
          tone: accents.amber.ink,
          tint: accents.amber.tint,
          icon: 'warning',
          label: pending > 0 ? t('sync.waiting', { count: pending }) : t('sync.offlineShort'),
        }
      : pending > 0
        ? {
            tone: color.primary,
            tint: color.primaryTint,
            icon: 'cloudUp',
            label: t('sync.waiting', { count: pending }),
          }
        : {
            tone: color.mutedLight,
            tint: color.fill,
            icon: 'check',
            label: t('sync.synced'),
          };

  const quiet = !busy && !offline && pending === 0;

  return (
    <Press
      onPress={() => void run()}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={`${look.label}. ${t('sync.button')}`}
      style={[
        styles.pill,
        { backgroundColor: quiet ? 'transparent' : look.tint },
        quiet && styles.pillQuiet,
        style,
      ]}>
      <View style={[styles.glyph, { backgroundColor: quiet ? color.fill : 'transparent' }]}>
        {busy ? (
          <ActivityIndicator size="small" color={look.tone} />
        ) : (
          <Icon name={look.icon} size={14} color={look.tone} />
        )}
      </View>

      <Text style={[styles.label, { color: look.tone }]} numberOfLines={1}>
        {look.label}
      </Text>

      {/*
        The word only appears when pressing it would do something visible.
        On a synced, online phone the row is a status, not a call to action.
      */}
      {!quiet && !busy ? (
        <View style={[styles.action, { borderColor: look.tone + '40' }]}>
          <Text style={[styles.actionLabel, { color: look.tone }]}>{t('sync.button')}</Text>
        </View>
      ) : null}
    </Press>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      alignSelf: 'flex-start',
      borderRadius: radius.button,
      paddingLeft: 6,
      paddingRight: 8,
      paddingVertical: 6,
    },
    // Synced: no fill, no border, just the words. It should read as a caption.
    pillQuiet: { paddingLeft: 6, paddingRight: 6, opacity: 0.9 },

    glyph: {
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
    },
    label: { fontFamily: body[600], fontSize: 12.5, letterSpacing: 0.1 },

    action: {
      borderWidth: 1,
      borderRadius: radius.sm,
      paddingHorizontal: 9,
      paddingVertical: 3,
      backgroundColor: color.sheet,
    },
    actionLabel: { fontFamily: body[700], fontSize: 11.5, letterSpacing: 0.2 },
  });

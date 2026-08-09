/**
 * The strip that appears when the teacher's changes are not reaching the server.
 *
 * Deliberately a banner and not a dialog. These failures are not caused by
 * anything the teacher just did — a modal interrupting attendance to announce
 * that the wifi dropped would be worse than the problem. It states the fact,
 * offers the one useful action, and stays out of the way.
 *
 * Short on purpose. "No internet. Your changes are saved on this phone and will
 * sync automatically" is true but nobody reads it mid-lesson.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Press } from '@/components/ui';
import { useSyncStatus } from '@/data/syncStatus';
import { useT } from '@/i18n/useT';
import { retryNow } from '@/data/sync';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body } from '@/theme/type';

/** Long enough to read six words, short enough not to become furniture. */
const VISIBLE_MS = 2200;

export function SyncBanner() {
  const { color, accents, status } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const insets = useSafeAreaInsets();

  const pending = useSyncStatus((s) => s.pending);
  const offline = useSyncStatus((s) => s.offline);
  const failure = useSyncStatus((s) => s.failure);
  const clearFailure = useSyncStatus((s) => s.clearFailure);

  const [retrying, setRetrying] = useState(false);

  /*
    The offline banner announces itself and then gets out of the way.

    It used to sit at the top of the screen for as long as the connection was
    down, which on these networks can be the whole lesson — a permanent strip
    over whatever the teacher is doing, saying something they already know.
    Nothing is lost by hiding it: the work is saved, and the sync row on the
    home screen carries the state for as long as it is true.

    A rejected write is different and stays. That one is not coming back on its
    own and has a Dismiss button for exactly that reason.
  */
  const [showOffline, setShowOffline] = useState(offline);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!offline) {
      setShowOffline(false);
      return;
    }
    setShowOffline(true);
    const timer = setTimeout(() => setShowOffline(false), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [offline]);

  // Retrying by hand deserves to be seen through, so the banner comes back for
  // as long as that takes.
  useEffect(() => {
    if (retrying) setShowOffline(true);
  }, [retrying]);

  const visible = !!failure || showOffline;

  useEffect(() => {
    Animated.timing(fade, {
      toValue: visible ? 1 : 0,
      duration: visible ? 160 : 260,
      useNativeDriver: true,
    }).start();
  }, [fade, visible]);

  if (!offline && !failure) return null;

  const retry = async () => {
    setRetrying(true);
    try {
      await retryNow();
    } finally {
      setRetrying(false);
    }
  };

  // A rejected write is the louder problem: it is not coming back on its own.
  const skin = failure
    ? { bg: status.absent.tint, fg: color.dangerDeep }
    : { bg: accents.amber.tint, fg: accents.amber.ink };

  return (
    <View
      style={[styles.wrap, { top: insets.top + 6 }]}
      pointerEvents={visible ? 'box-none' : 'none'}>
      <Animated.View
        style={[
          styles.bar,
          { backgroundColor: skin.bg, borderColor: skin.fg + '33', opacity: fade },
        ]}>
        <Icon name="warning" size={16} color={skin.fg} />
        <Text style={[styles.label, { color: skin.fg }]} numberOfLines={2}>
          {failure ??
            (pending > 0 ? t('sync.offlinePending', { count: pending }) : t('sync.offline'))}
        </Text>

        {failure ? (
          <Press onPress={clearFailure} hitSlop={8} style={styles.action}>
            <Text style={[styles.actionLabel, { color: skin.fg }]}>{t('common.dismiss')}</Text>
          </Press>
        ) : retrying ? (
          <ActivityIndicator size="small" color={skin.fg} style={styles.action} />
        ) : (
          <Press onPress={retry} hitSlop={8} style={styles.action}>
            <Text style={[styles.actionLabel, { color: skin.fg }]}>{t('common.retry')}</Text>
          </Press>
        )}
      </Animated.View>
    </View>
  );
}

const makeStyles = (_theme: Theme) =>
  StyleSheet.create({
    wrap: {
      position: 'absolute',
      left: space.gutter,
      right: space.gutter,
      // Above every screen, below the dialogs, which are their own Modal.
      zIndex: 50,
      elevation: 50,
    },
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderRadius: radius.button,
      borderWidth: 1,
      paddingHorizontal: 14,
      paddingVertical: 11,
    },
    label: { flex: 1, fontFamily: body[600], fontSize: 12.5, lineHeight: 17 },
    action: { paddingHorizontal: 4 },
    actionLabel: { fontFamily: body[700], fontSize: 12.5 },
  });

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
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Press } from '@/components/ui';
import { useSyncStatus } from '@/data/syncStatus';
import { useT } from '@/i18n/useT';
import { retryNow } from '@/data/sync';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body } from '@/theme/type';

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
    <View style={[styles.wrap, { top: insets.top + 6 }]} pointerEvents="box-none">
      <View style={[styles.bar, { backgroundColor: skin.bg, borderColor: skin.fg + '33' }]}>
        <Icon name="warning" size={16} color={skin.fg} />
        <Text style={[styles.label, { color: skin.fg }]} numberOfLines={2}>
          {failure ?? t(pending > 0 ? 'sync.offlinePending' : 'sync.offline')}
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
      </View>
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

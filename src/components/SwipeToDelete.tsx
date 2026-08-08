/**
 * Swipe a row left to reveal Delete.
 *
 * Wraps `ReanimatedSwipeable` so every swipeable list in the app behaves the
 * same way and confirms the same way. The confirm is not optional: a swipe is
 * easy to do by accident while scrolling, and the rows this guards — a sent
 * message and its delivery receipts, a parent's reply — cannot be recovered.
 */
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useRef } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { confirm } from '@/components/Dialog';
import { useT } from '@/i18n/useT';
import { Icon } from '@/components/Icon';
import { Press } from '@/components/ui';
import { radius, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body } from '@/theme/type';

const ACTION_WIDTH = 92;

export function SwipeToDelete({
  children,
  /**
   * The confirm's title, already translated.
   *
   * Deliberately a whole sentence rather than a noun interpolated into a
   * template. The template took "this message" from the caller and produced
   * «this message» pozulsynmy? — a Turkmen sentence with an English subject —
   * because there is nowhere for an untranslated fragment to hide.
   */
  title,
  message,
  onDelete,
}: {
  children: React.ReactNode;
  title: string;
  message?: string;
  onDelete: () => void;
}) {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const row = useRef<SwipeableMethods>(null);

  const ask = async () => {
    const yes = await confirm({
      title,
      message: message ?? t('calendar.cannotUndo'),
      confirmLabel: t('common.delete'),
    });
    // Closed either way: leaving the row hanging open after a cancel reads as
    // the tap having failed.
    row.current?.close();
    if (yes) onDelete();
  };

  const renderActions = (_progress: SharedValue<number>, drag: SharedValue<number>) => (
    <DeleteAction drag={drag} onPress={ask} background={color.danger} label={t('common.delete')} />
  );

  return (
    <ReanimatedSwipeable
      ref={row}
      friction={2}
      rightThreshold={ACTION_WIDTH / 2}
      overshootRight={false}
      renderRightActions={renderActions}
      containerStyle={styles.container}>
      {children}
    </ReanimatedSwipeable>
  );
}

function DeleteAction({
  drag,
  onPress,
  background,
  label,
}: {
  drag: SharedValue<number>;
  onPress: () => void;
  background: string;
  label: string;
}) {
  const styles = useThemedStyles(makeStyles);

  // Slides in with the row rather than sitting statically behind it, so the
  // gesture feels attached to the finger.
  const animated = useAnimatedStyle(() => ({
    transform: [{ translateX: drag.value + ACTION_WIDTH }],
  }));

  return (
    <Animated.View style={[styles.actionWrap, animated]}>
      <Press onPress={onPress} haptic style={[styles.action, { backgroundColor: background }]}>
        <Icon name="close" size={16} color="#fff" />
        <Text style={styles.actionLabel}>{label}</Text>
      </Press>
    </Animated.View>
  );
}

const makeStyles = (_theme: Theme) =>
  StyleSheet.create({
    container: { overflow: 'visible' },
    actionWrap: { width: ACTION_WIDTH, justifyContent: 'center', paddingLeft: 10 },
    action: {
      flex: 1,
      borderRadius: radius.card,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
    },
    actionLabel: { fontFamily: body[700], fontSize: 12, color: '#fff' },
  });

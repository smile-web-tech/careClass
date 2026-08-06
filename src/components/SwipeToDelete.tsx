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
import { Icon } from '@/components/Icon';
import { Press } from '@/components/ui';
import { radius, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body } from '@/theme/type';

const ACTION_WIDTH = 92;

export function SwipeToDelete({
  children,
  /** Shown in the confirm — "this message", "Gulnora's reply". */
  what,
  message,
  onDelete,
}: {
  children: React.ReactNode;
  what: string;
  message?: string;
  onDelete: () => void;
}) {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const row = useRef<SwipeableMethods>(null);

  const ask = async () => {
    const yes = await confirm({
      title: `Delete ${what}?`,
      message: message ?? 'This cannot be undone.',
      confirmLabel: 'Delete',
    });
    // Closed either way: leaving the row hanging open after a cancel reads as
    // the tap having failed.
    row.current?.close();
    if (yes) onDelete();
  };

  const renderActions = (_progress: SharedValue<number>, drag: SharedValue<number>) => (
    <DeleteAction drag={drag} onPress={ask} background={color.danger} />
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
}: {
  drag: SharedValue<number>;
  onPress: () => void;
  background: string;
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
        <Text style={styles.actionLabel}>Delete</Text>
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

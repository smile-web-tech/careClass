/**
 * The letter rail down the right edge of a long list, as in a phone's contacts.
 *
 * Two things make it feel native rather than like a column of small buttons.
 * It tracks a *drag*, not a tap — a finger held on the rail and slid scrubs
 * through the list continuously — and it fires a selection haptic on each new
 * letter, which is what makes scrubbing feel like it has detents. A bubble
 * follows the finger, because at this size the letter under a fingertip is the
 * one thing the finger is covering.
 *
 * The letters are handed in rather than assumed. A Turkmen roster is Latin, a
 * Russian one is Cyrillic, and plenty are both — a hardcoded A–Z would be a
 * rail that scrolls to nothing for half the teachers this is for.
 */
import * as Haptics from 'expo-haptics';
import { useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';

import { radius, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body } from '@/theme/type';

/** Below this the rail is noise: three letters is a list you can simply read. */
const WORTH_IT = 3;

export function AlphabetIndex({
  letters,
  onPick,
}: {
  letters: string[];
  /** Index into `letters` — the caller decides what to scroll where. */
  onPick: (index: number) => void;
}) {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [height, setHeight] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  /*
    The responder is built once and reads everything through refs.

    A PanResponder captures the closure it was created with, so one rebuilt on
    every render would be replaced mid-gesture, and one built with `useMemo` on
    stale values would scroll to the wrong letter after the list changed. Refs
    keep the callbacks stable and the values current.
  */
  const state = useRef({ letters, height, onPick, at: -1 });
  state.current = { ...state.current, letters, height, onPick };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Claim the gesture outright: without this the list underneath treats a
        // vertical drag on the rail as a scroll and the rail does nothing.
        onPanResponderTerminationRequest: () => false,

        onPanResponderGrant: (e) => scrub(e.nativeEvent.locationY),
        onPanResponderMove: (e) => scrub(e.nativeEvent.locationY),
        onPanResponderRelease: () => {
          state.current.at = -1;
          setActive(null);
        },
        onPanResponderTerminate: () => {
          state.current.at = -1;
          setActive(null);
        },
      }),
    [],
  );

  function scrub(y: number) {
    const { letters: ls, height: h, onPick: pick } = state.current;
    if (!ls.length || h <= 0) return;
    const step = h / ls.length;
    const next = Math.min(ls.length - 1, Math.max(0, Math.floor(y / step)));
    if (next === state.current.at) return;
    state.current.at = next;
    setActive(next);
    // Selection, not impact: this is a picker moving through detents, and the
    // heavier feedback on every letter of a long scrub is exhausting.
    void Haptics.selectionAsync().catch(() => {});
    pick(next);
  }

  if (letters.length < WORTH_IT) return null;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {active !== null ? (
        <View style={[styles.bubble, { top: bubbleTop(active, letters.length, height) }]}>
          <Text style={styles.bubbleText}>{letters[active]}</Text>
        </View>
      ) : null}

      <View
        {...responder.panHandlers}
        onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
        style={styles.rail}
        accessibilityRole="adjustable"
        accessibilityLabel={letters.join(' ')}>
        {letters.map((l, i) => (
          <Text
            key={`${l}-${i}`}
            style={[styles.letter, active === i && { color: color.primary, fontFamily: body[700] }]}>
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** Centres the bubble on the letter under the finger, clamped to the rail. */
function bubbleTop(index: number, count: number, height: number) {
  if (!height) return 0;
  const step = height / count;
  return Math.max(0, Math.min(height - 44, index * step + step / 2 - 22));
}

const makeStyles = ({ color, shadow }: Theme) =>
  StyleSheet.create({
    wrap: {
      position: 'absolute',
      right: 0,
      top: 0,
      bottom: 0,
      justifyContent: 'center',
      alignItems: 'flex-end',
    },
    rail: {
      // Wider than the letters look, because the target is a fingertip and a
      // 10px column is a column you miss.
      width: 26,
      paddingVertical: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    letter: {
      fontFamily: body[600],
      fontSize: 10.5,
      lineHeight: 13.5,
      color: color.mutedLight,
      textAlign: 'center',
    },
    bubble: {
      position: 'absolute',
      right: 34,
      width: 44,
      height: 44,
      borderRadius: radius.tile,
      backgroundColor: color.primary,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadow.card,
    },
    bubbleText: {
      fontFamily: body[700],
      fontSize: 19,
      color: '#fff',
    },
  });

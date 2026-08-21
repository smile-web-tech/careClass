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

/**
 * Vertical pitch between letters, and the ceiling on it.
 *
 * Set from how far apart they should look, not from the type size — packed at
 * their line height the letters read as one grey smear and a fingertip cannot
 * tell which one it is over. This is a ceiling rather than a fixed step because
 * a roster written in two alphabets can run to fifty letters, and fifty at 18px
 * is taller than the phone: `step` below shrinks to whatever fits.
 */
const LETTER_STEP = 18;

/** Air kept above and below the rail, so it never runs to the screen edges. */
const RAIL_MARGIN = 24;

/**
 * The tightest the letters may be packed before some are dropped instead.
 *
 * Below roughly this the 11px glyphs start clipping each other, and a rail you
 * cannot read is worse than a shorter one. A Turkmen roster carrying Russian
 * names runs to both alphabets — fifty-odd letters — which on a small phone
 * does not fit at any readable pitch, so past this point the rail shows an even
 * sample of the letters and the ones between are reached by scrubbing.
 */
const MIN_STEP = 13;

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
  /** The space the rail is allowed, measured; `step` is derived from it. */
  const [avail, setAvail] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  /*
    What the rail draws, which is not always every letter.

    Each entry keeps the index it had in `letters`, so a sampled rail still
    reports the right letter to the caller — the sample changes what is drawn,
    never what a position means.
  */
  const shown = useMemo(() => {
    const all = letters.map((label, index) => ({ label, index }));
    if (avail <= 0) return all;
    const fits = Math.max(WORTH_IT, Math.floor(avail / MIN_STEP));
    if (all.length <= fits) return all;
    return Array.from({ length: fits }, (_, k) => all[Math.round((k * (all.length - 1)) / (fits - 1))]);
  }, [letters, avail]);

  const step = avail > 0 ? Math.min(LETTER_STEP, avail / shown.length) : LETTER_STEP;
  const height = step * shown.length;

  /*
    The responder is built once and reads everything through refs.

    A PanResponder captures the closure it was created with, so one rebuilt on
    every render would be replaced mid-gesture, and one built with `useMemo` on
    stale values would scroll to the wrong letter after the list changed. Refs
    keep the callbacks stable and the values current.
  */
  const state = useRef({ shown, height, onPick, at: -1 });
  state.current = { ...state.current, shown, height, onPick };

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
    const { shown: rail, height: h, onPick: pick } = state.current;
    if (!rail.length || h <= 0) return;
    const pitch = h / rail.length;
    const at = Math.min(rail.length - 1, Math.max(0, Math.floor(y / pitch)));
    if (at === state.current.at) return;
    state.current.at = at;
    setActive(at);
    // Selection, not impact: this is a picker moving through detents, and the
    // heavier feedback on every letter of a long scrub is exhausting.
    void Haptics.selectionAsync().catch(() => {});
    pick(rail[at].index);
  }

  if (letters.length < WORTH_IT) return null;

  return (
    <View
      style={styles.wrap}
      pointerEvents="box-none"
      onLayout={(e) => setAvail(e.nativeEvent.layout.height - RAIL_MARGIN)}>
      {active !== null ? (
        <View style={[styles.bubble, { top: bubbleTop(active, shown.length, height) }]}>
          <Text style={styles.bubbleText}>{shown[active]?.label}</Text>
        </View>
      ) : null}

      <View
        {...responder.panHandlers}
        style={[styles.rail, { height }]}
        accessibilityRole="adjustable"
        accessibilityLabel={letters.join(' ')}>
        {shown.map((l, i) => (
          <Text
            key={`${l.label}-${l.index}`}
            style={[
              styles.letter,
              // Height and line height are the step, so the glyph sits centred
              // in its own slot and the rail's height is exactly `step × count`
              // — which is what makes the scrub maths land on the right letter.
              { height: step, lineHeight: step },
              active === i && { color: color.primary, fontFamily: body[700] },
            ]}>
            {l.label}
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
      // 10px column is a column you miss. No vertical padding: the rail's
      // height has to be exactly the letters' height or the scrub drifts.
      width: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    letter: {
      fontFamily: body[600],
      fontSize: 11,
      color: color.mutedLight,
      textAlign: 'center',
      // `height` and `lineHeight` come from `step` at render.
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

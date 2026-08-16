/**
 * The opening animation.
 *
 * A title card: "KERVEN BAYLYEV'S" over CLASS in blue, with CARE in green
 * sliding up to sit across it. The overlap is the whole idea — CARE covers all
 * but the top slice of CLASS, so the two words read as one mark.
 *
 * The geometry below is not eyeballed. It is measured off the reference frame
 * (1080px wide) and stored as ratios of the CARE type size, so the card keeps
 * its exact proportions on any screen: every offset, every width, one number.
 *
 * Deliberately built to be invisible as a transition. Its background is the
 * same black as the native splash in `app.json`, so the handoff from the
 * OS-drawn splash to this screen has nothing to see — no flash, no jump. The
 * app fades in underneath it at the end.
 *
 * Skippable by tapping, and it runs on cold start only: an intro is charming
 * once and an obstacle every time after. It is mounted at the root and never
 * remounts while the app is alive.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { brand } from '@/theme/brand';
import { mark } from '@/theme/type';

/*
 * Measured from the reference, in pixels at its 1080-wide frame, then divided
 * through by the CARE size (199) so one scalar drives the lot.
 *
 *   ink top    CARE 283 · CLASS 252 · name 205
 *   type size  CARE 199 · CLASS 162 · name  56
 *
 * The three words are horizontally squeezed — the reference is a condensed cut
 * of this weight, which Archivo Black is not, so `scaleX` supplies it.
 */
const NAME_SIZE = 0.2814;
const CLASS_SIZE = 0.8141;
/** Ink tops, relative to CARE's, as a share of the CARE size. */
const NAME_TOP = -0.392;
const CLASS_TOP = -0.1558;
const NAME_SQUEEZE = 0.74;
const CLASS_SQUEEZE = 0.92;
const CARE_SQUEEZE = 0.9;
/** CARE sits a hair left of centre in the reference. */
const CARE_NUDGE = -0.03;

/**
 * Cap height starts this far below the top of a text box, as a share of the
 * type size. Archivo Black's ascent is .88em and its caps reach .69em, so the
 * gap above a capital is .19em — the number that turns "where the ink goes"
 * into "where the box goes".
 */
const CAP_INSET = 0.19;
/** Ink width of CARE at squeeze, over the type size. Sets the card's scale. */
const CARE_WIDTH = 2.643;
/** Ink top of the name to ink bottom of CARE, over the type size. */
const CARD_HEIGHT = 1.0955;

const NAME_IN = 460;
const CLASS_IN = 560;
const CLASS_AT = 240;
const CARE_IN = 560;
const CARE_SETTLE = 220;
const CARE_AT = 620;
const HOLD = 520;
const FADE_OUT = 340;

const END = CARE_AT + CARE_IN + CARE_SETTLE + HOLD;

export function Intro({ onDone }: { onDone: () => void }) {
  const { width } = useWindowDimensions();
  const [gone, setGone] = useState(false);
  // A tap is recorded as state rather than animating from the handler
  // directly: under the React Compiler a shared value may only be written from
  // an effect, so the effect below is what actually cuts the fade short.
  const [skipped, setSkipped] = useState(false);

  // One scalar. 440 caps it on a tablet, where 80% of the width would be
  // absurd; the card is a mark, not a banner.
  const size = Math.min(width * 0.8, 440) / CARE_WIDTH;

  const nameOpacity = useSharedValue(0);
  const nameShift = useSharedValue(-size * 0.1);
  const classOpacity = useSharedValue(0);
  const classShift = useSharedValue(-width * 0.55);
  const careOpacity = useSharedValue(0);
  const careShift = useSharedValue(size * 0.95);
  const backdrop = useSharedValue(1);

  const finish = useCallback(() => {
    setGone(true);
    onDone();
  }, [onDone]);

  /*
   * One effect owns every write to a shared value.
   *
   * Not a stylistic choice: the React Compiler refuses a value written in one
   * effect and named as another's dependency, so a second "skip" effect does
   * not compile. Re-running this one with `skipped` true is the same thing
   * expressed in a shape the compiler can check.
   */
  useEffect(() => {
    let cancelled = false;

    if (skipped) {
      // Hurried, not broken — still a fade, just a short one.
      backdrop.value = withTiming(0, { duration: 180 }, (done) => {
        if (done) runOnJS(finish)();
      });
      return;
    }

    const run = (reduced: boolean) => {
      if (cancelled) return;

      // Someone who has asked the OS for less motion still gets the card, just
      // assembled rather than flown in — the sliding is what they turned off.
      if (reduced) {
        nameShift.value = 0;
        classShift.value = 0;
        careShift.value = 0;
        nameOpacity.value = withTiming(1, { duration: 200 });
        classOpacity.value = withDelay(120, withTiming(1, { duration: 200 }));
        careOpacity.value = withDelay(260, withTiming(1, { duration: 200 }));
        backdrop.value = withDelay(
          900,
          withTiming(0, { duration: FADE_OUT }, (done) => {
            if (done) runOnJS(finish)();
          }),
        );
        return;
      }

      nameOpacity.value = withTiming(1, { duration: NAME_IN, easing: Easing.out(Easing.quad) });
      nameShift.value = withTiming(0, { duration: NAME_IN, easing: Easing.out(Easing.cubic) });

      // CLASS arrives from the left and decelerates hard, so it reads as
      // sliding into place rather than drifting.
      classOpacity.value = withDelay(CLASS_AT, withTiming(1, { duration: 200 }));
      classShift.value = withDelay(
        CLASS_AT,
        withTiming(0, { duration: CLASS_IN, easing: Easing.out(Easing.exp) }),
      );

      // CARE rises over it, overshoots by a whisker, and settles. The overshoot
      // is what makes the landing feel like weight instead of a stop.
      careOpacity.value = withDelay(CARE_AT, withTiming(1, { duration: 180 }));
      careShift.value = withDelay(
        CARE_AT,
        withSequence(
          withTiming(-size * 0.035, { duration: CARE_IN, easing: Easing.out(Easing.cubic) }),
          withTiming(0, { duration: CARE_SETTLE, easing: Easing.inOut(Easing.quad) }),
        ),
      );

      // The fade of the whole overlay is the last thing to run; `finish` is what
      // unmounts it, so it must fire on the JS thread.
      backdrop.value = withDelay(
        END,
        withTiming(0, { duration: FADE_OUT, easing: Easing.in(Easing.quad) }, (done) => {
          if (done) runOnJS(finish)();
        }),
      );
    };

    // Failing to read the setting must not cost anyone the intro.
    AccessibilityInfo.isReduceMotionEnabled()
      .then(run)
      .catch(() => run(false));

    return () => {
      cancelled = true;
    };
    // Shared values are stable across renders and deliberately not listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipped, finish, size, width]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));
  const nameStyle = useAnimatedStyle(() => ({
    opacity: nameOpacity.value,
    transform: [{ translateY: nameShift.value }],
  }));
  const classStyle = useAnimatedStyle(() => ({
    opacity: classOpacity.value,
    transform: [{ translateX: classShift.value }],
  }));
  const careStyle = useAnimatedStyle(() => ({
    opacity: careOpacity.value,
    transform: [{ translateY: careShift.value }],
  }));

  if (gone) return null;

  // Every word is absolutely placed off the same origin — CARE's ink top — so
  // the three sit in the exact relationship the reference has them in.
  const careTop = -NAME_TOP * size;
  const line = (ratio: number, top: number) => ({
    position: 'absolute' as const,
    left: 0,
    right: 0,
    top: careTop + top * size - CAP_INSET * ratio * size,
  });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
      {/* Swallows touches so a tap during the intro cannot reach the screen
          fading in underneath and open something nobody meant to open. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => setSkipped(true)}
        accessibilityRole="button"
      />
      <View style={styles.centre} pointerEvents="none">
        <View
          style={{ width: '100%', height: CARD_HEIGHT * size }}
          accessible
          accessibilityRole="image"
          accessibilityLabel="Kerven Baylyev's ClassCare"
        >
          <Animated.View style={[line(CLASS_SIZE, CLASS_TOP), classStyle]}>
            <Text
              style={[
                styles.word,
                {
                  fontSize: CLASS_SIZE * size,
                  color: brand.blue,
                  letterSpacing: -0.0123 * CLASS_SIZE * size,
                  transform: [{ scaleX: CLASS_SQUEEZE }],
                },
              ]}
            >
              CLASS
            </Text>
          </Animated.View>

          <Animated.View style={[line(NAME_SIZE, NAME_TOP), nameStyle]}>
            <Text
              style={[
                styles.word,
                {
                  fontSize: NAME_SIZE * size,
                  color: brand.sage,
                  letterSpacing: 0.0179 * NAME_SIZE * size,
                  transform: [{ scaleX: NAME_SQUEEZE }],
                },
              ]}
            >
              KERVEN BAYLYEV&apos;S
            </Text>
          </Animated.View>

          <Animated.View
            style={[line(1, 0), { marginLeft: CARE_NUDGE * size }, careStyle]}
          >
            <Text
              style={[
                styles.word,
                {
                  fontSize: size,
                  color: brand.green,
                  letterSpacing: -0.01 * size,
                  transform: [{ scaleX: CARE_SQUEEZE }],
                },
              ]}
            >
              CARE
            </Text>
          </Animated.View>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: brand.ground, zIndex: 100 },
  centre: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  word: {
    fontFamily: mark,
    textAlign: 'center',
    // Android pads a text box out to the font's recommended line box; without
    // this the measured top is not the top the maths above assumes.
    includeFontPadding: false,
  },
});

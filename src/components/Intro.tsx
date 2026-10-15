/**
 * The opening animation.
 *
 * A title card: KERVEN BAYLYEV'S over CLASS in blue, with CARE in green across
 * it. CARE lands first; CLASS then rises out from behind it; the name settles
 * on top last.
 *
 * CLASS is only ever half a word. It is cut off along a line a little below
 * CARE's top edge, so what shows between CARE's letters — in the gap after the
 * C, either side of the A's peak — is the top of CLASS and nothing under it.
 * Covering a whole CLASS with CARE is not the same picture: its lower half
 * shows blue through the C's mouth and the A's counter. The cut is also what
 * lets CLASS rise "from behind": it slides up through a window whose bottom
 * edge is that line.
 *
 * The geometry is the reference frame's, letter by letter. Every number below
 * is in pixels of that frame (1080 wide), fitted against it with the fonts the
 * app ships, and `u` turns them into points. The reference does not squeeze its
 * words evenly — CARE's E is narrowed far more than its A — so each letter is
 * set on its own with its own squeeze rather than the word as one string.
 *
 * Deliberately invisible as a transition. Its background is the same black as
 * the native splash in `app.json`, so the handoff from the OS-drawn splash to
 * this screen has nothing to see — no flash, no jump. The app fades in
 * underneath it at the end.
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

import { brand, titleCard } from '@/theme/brand';
import { mark, markName } from '@/theme/type';

/** The reference frame's width, and its centre line. */
const FRAME = 1080;
const MID = FRAME / 2;
/** Ink top of the name, and CARE's baseline: the card's extent. */
const TOP = 214;
const BOTTOM = 427;
/** CARE's ink width, edge to edge — the word the card is sized by. */
const CARE_INK = 522;
/** Share of the screen width CARE spans, and the most it ever spans. */
const SHARE = 0.75;
const MAX_CARE = 460;

/*
 * Where a text box's top sits above its baseline, as a share of the type size:
 * each font's ascent. Android lays a line out from it once `includeFontPadding`
 * is off, so this is what turns "baseline here" into "box there".
 */
const ARCHIVO_ASCENT = 0.878;
const AUDIOWIDE_ASCENT = 2027 / 2048;

/** A letter: where its advance is centred, from the centre line, and its squeeze. */
type Glyph = readonly [letter: string, centre: number, squeeze: number];

const CARE = {
  size: 199,
  baseline: 427,
  glyphs: [
    ['C', -199.5, 0.971],
    ['A', -51.1, 0.98],
    ['R', 88.3, 0.866],
    ['E', 207.9, 0.768],
  ] as const satisfies readonly Glyph[],
  /** The middle of its ink, which is what it scales about as it lands. */
  pivot: { x: -5, y: 358 },
};

const CLASS = {
  size: 156,
  baseline: 359.3,
  glyphs: [
    ['C', -195.3, 0.962],
    ['L', -92.7, 0.971],
    ['A', -4.9, 0.97],
    ['S', 100.2, 0.865],
    ['S', 194.2, 0.865],
  ] as const satisfies readonly Glyph[],
  /** Its round letters' ink top. */
  inkTop: 250,
  /** Nothing of CLASS exists below this line. */
  cut: 316,
};

/*
 * The name is one line of Audiowide, tracked out, with a hairline stroke in
 * its own colour: the reference's letters are Audiowide's shapes at a heavier
 * weight than the font has, and nine copies a fraction of a pixel apart is
 * that weight without a second font.
 */
const NAME = {
  size: 38.5,
  baseline: 241.5,
  tracking: 0.048,
  /** Its box sits this far left of the centre line. */
  centre: -2.1,
  stroke: 0.9,
};
const RING: readonly (readonly [number, number])[] = [
  [0, 0],
  ...Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    return [Math.cos(a), Math.sin(a)] as const;
  }),
];

const CARE_AT = 80;
const CARE_FADE = 240;
const CARE_IN = 420;
const CARE_SETTLE = 200;
const CLASS_AT = 480;
const CLASS_IN = 640;
const NAME_AT = 1000;
const NAME_IN = 420;
const HOLD = 700;
const FADE_OUT = 340;

const END = NAME_AT + NAME_IN + HOLD;

export function Intro({ onDone }: { onDone: () => void }) {
  const { width } = useWindowDimensions();
  const [gone, setGone] = useState(false);
  // A tap is recorded as state rather than animating from the handler
  // directly: under the React Compiler a shared value may only be written from
  // an effect, so the effect below is what actually cuts the fade short.
  const [skipped, setSkipped] = useState(false);

  // Points per reference pixel, chosen so CARE spans most of the screen. The
  // card's frame is then wider than the screen, which costs nothing: only
  // black lies outside the letters.
  const u = Math.min(width * SHARE, MAX_CARE) / CARE_INK;
  // Far enough down that the tallest letter of CLASS is under the cut.
  const sunk = (CLASS.cut - CLASS.inkTop + 4) * u;

  const careOpacity = useSharedValue(0);
  const careScale = useSharedValue(0.82);
  const classOpacity = useSharedValue(0);
  const classRise = useSharedValue(sunk);
  const nameOpacity = useSharedValue(0);
  const nameShift = useSharedValue(-8 * u);
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

      // Someone who has asked the OS for less motion still gets the card, in
      // the same order, just faded in rather than flown in.
      if (reduced) {
        careScale.value = 1;
        classRise.value = 0;
        nameShift.value = 0;
        careOpacity.value = withTiming(1, { duration: 200 });
        classOpacity.value = withDelay(200, withTiming(1, { duration: 200 }));
        nameOpacity.value = withDelay(400, withTiming(1, { duration: 200 }));
        backdrop.value = withDelay(
          1100,
          withTiming(0, { duration: FADE_OUT }, (done) => {
            if (done) runOnJS(finish)();
          }),
        );
        return;
      }

      // CARE first: it lands, overshoots by a whisker and settles. The
      // overshoot is what makes the landing feel like weight instead of a stop.
      careOpacity.value = withDelay(CARE_AT, withTiming(1, { duration: CARE_FADE }));
      careScale.value = withDelay(
        CARE_AT,
        withSequence(
          withTiming(1.03, { duration: CARE_IN, easing: Easing.out(Easing.cubic) }),
          withTiming(1, { duration: CARE_SETTLE, easing: Easing.inOut(Easing.quad) }),
        ),
      );

      // Then CLASS comes up from behind it. It is under the cut until it
      // rises, so it is already "there" — the opacity only guards the frames
      // before the first layout.
      classOpacity.value = withDelay(CLASS_AT, withTiming(1, { duration: 80 }));
      classRise.value = withDelay(
        CLASS_AT,
        withTiming(0, { duration: CLASS_IN, easing: Easing.out(Easing.cubic) }),
      );

      nameOpacity.value = withDelay(
        NAME_AT,
        withTiming(1, { duration: NAME_IN, easing: Easing.out(Easing.quad) }),
      );
      nameShift.value = withDelay(
        NAME_AT,
        withTiming(0, { duration: NAME_IN, easing: Easing.out(Easing.cubic) }),
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
  }, [skipped, finish, u]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));
  const careStyle = useAnimatedStyle(() => ({
    opacity: careOpacity.value,
    transform: [{ scale: careScale.value }],
  }));
  const classStyle = useAnimatedStyle(() => ({
    opacity: classOpacity.value,
    transform: [{ translateY: classRise.value }],
  }));
  const nameStyle = useAnimatedStyle(() => ({
    opacity: nameOpacity.value,
    transform: [{ translateY: nameShift.value }],
  }));

  if (gone) return null;

  const letters = (
    word: { size: number; baseline: number; glyphs: readonly Glyph[] },
    color: string,
  ) =>
    word.glyphs.map(([letter, centre, squeeze], i) => {
      // A box twice the type size with the letter centred in it: the advance
      // lands centred on `centre` whatever Android rounds its width to, and
      // the squeeze — which scales about the box's middle — pivots there too.
      const box = 2 * word.size * u;
      return (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: (MID + centre) * u - box / 2,
            top: (word.baseline - ARCHIVO_ASCENT * word.size - TOP) * u,
            width: box,
            transform: [{ scaleX: squeeze }],
          }}>
          <Text
            allowFontScaling={false}
            numberOfLines={1}
            style={[styles.letter, { fontSize: word.size * u, color }]}>
            {letter}
          </Text>
        </View>
      );
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
          style={{ width: FRAME * u, height: (BOTTOM - TOP) * u }}
          accessible
          accessibilityRole="image"
          accessibilityLabel="Kerven Baylyev's ClassCare">
          {/* The window CLASS rises through. Its bottom edge is the cut. */}
          <View
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: FRAME * u,
              height: (CLASS.cut - TOP) * u,
              overflow: 'hidden',
            }}>
            <Animated.View style={[StyleSheet.absoluteFill, classStyle]}>
              {letters(CLASS, titleCard.classWord)}
            </Animated.View>
          </View>

          <Animated.View
            style={[
              {
                position: 'absolute',
                left: 0,
                top: (NAME.baseline - AUDIOWIDE_ASCENT * NAME.size - TOP) * u,
                width: FRAME * u,
                height: NAME.size * 1.3 * u,
              },
              nameStyle,
            ]}>
            {RING.map(([dx, dy], i) => (
              <Text
                key={i}
                allowFontScaling={false}
                numberOfLines={1}
                style={[
                  styles.name,
                  {
                    fontSize: NAME.size * u,
                    letterSpacing: NAME.tracking * NAME.size * u,
                    transform: [
                      { translateX: (NAME.centre + dx * NAME.stroke) * u },
                      { translateY: dy * NAME.stroke * u },
                    ],
                  },
                ]}>
                <Text style={{ color: titleCard.givenName }}>KERVEN</Text>
                {" BAYLYEV'S"}
              </Text>
            ))}
          </Animated.View>

          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { transformOrigin: [(MID + CARE.pivot.x) * u, (CARE.pivot.y - TOP) * u, 0] },
              careStyle,
            ]}>
            {letters(CARE, titleCard.careWord)}
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
  letter: {
    fontFamily: mark,
    textAlign: 'center',
    // Android pads a text box out to the font's recommended line box; without
    // this the box top is not the ascent the maths above assumes.
    includeFontPadding: false,
  },
  name: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    fontFamily: markName,
    color: titleCard.familyName,
    textAlign: 'center',
    includeFontPadding: false,
  },
});

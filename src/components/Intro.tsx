/**
 * The opening animation.
 *
 * Deliberately built to be invisible as a transition. Its background is the
 * same `#0C1729` as the native splash in `app.json`, so the handoff from the
 * OS-drawn splash to this screen has nothing to see — no flash of white, no
 * jump in the mark's position. The app fades in underneath it at the end.
 *
 * Under a second and a half, and skippable by tapping. An intro is charming
 * once and an obstacle every time after that, which is why it runs on cold
 * start only: it is mounted at the root and never remounts while the app is
 * alive.
 */
import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { Logo } from '@/components/ui';
import { display } from '@/theme/type';

/** Matches `expo-splash-screen`'s `backgroundColor` in app.json. */
const BACKDROP = '#0C1729';

const MARK_IN = 420;
const WORD_IN = 300;
const HOLD = 430;
const FADE_OUT = 320;

export function Intro({ onDone }: { onDone: () => void }) {
  const [gone, setGone] = useState(false);
  // A tap is recorded as state rather than animating from the handler
  // directly: under the React Compiler a shared value may only be written from
  // an effect, so the effect below is what actually cuts the fade short.
  const [skipped, setSkipped] = useState(false);

  const markOpacity = useSharedValue(0);
  const markScale = useSharedValue(0.82);
  const wordOpacity = useSharedValue(0);
  const wordShift = useSharedValue(10);
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

      // Someone who has asked the OS for less motion still gets the brand, just
      // without the movement — the scale and the rise are what they turned off.
      const markMs = reduced ? 200 : MARK_IN;
      const wordMs = reduced ? 160 : WORD_IN;

      markOpacity.value = withTiming(1, {
        duration: markMs,
        easing: Easing.out(Easing.cubic),
      });
      markScale.value = reduced
        ? 1
        : withTiming(1, { duration: markMs, easing: Easing.out(Easing.back(1.4)) });

      wordOpacity.value = withDelay(
        markMs * 0.55,
        withTiming(1, { duration: wordMs, easing: Easing.out(Easing.quad) }),
      );
      wordShift.value = reduced
        ? 0
        : withDelay(markMs * 0.55, withTiming(0, { duration: wordMs, easing: Easing.out(Easing.quad) }));

      // The fade of the whole overlay is the last thing to run; `finish` is what
      // unmounts it, so it must fire on the JS thread.
      backdrop.value = withDelay(
        markMs + wordMs + HOLD,
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
  }, [skipped, finish]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));
  const markStyle = useAnimatedStyle(() => ({
    opacity: markOpacity.value,
    transform: [{ scale: markScale.value }],
  }));
  const wordStyle = useAnimatedStyle(() => ({
    opacity: wordOpacity.value,
    transform: [{ translateY: wordShift.value }],
  }));

  if (gone) return null;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
      {/* Swallows touches so a tap during the intro cannot reach the screen
          fading in underneath and open something nobody meant to open. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => setSkipped(true)}
        accessibilityRole="button"
      />
      <View style={styles.center} pointerEvents="none">
        <Animated.View style={markStyle}>
          <Logo size={84} />
        </Animated.View>
        <Animated.View style={wordStyle}>
          <Text style={styles.wordmark}>ClassCare</Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: BACKDROP, zIndex: 100 },
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    fontFamily: display[700],
    fontSize: 25,
    letterSpacing: -0.3,
    color: '#FFFFFF',
    marginTop: 20,
  },
});

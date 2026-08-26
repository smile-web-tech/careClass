import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Dimensions, Keyboard, Platform, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/ui';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, text } from '@/theme/type';

/** Height of the tab bar's content, excluding the home-indicator inset. */
export const TAB_BAR_CONTENT_HEIGHT = 59;

/**
 * Bottom padding a tab screen needs so its last row clears the floating tab
 * bar. The bar overlays content by design, so every scroll view opts in here.
 */
export function useTabInset(extra = 0) {
  const insets = useSafeAreaInsets();
  return TAB_BAR_CONTENT_HEIGHT + Math.max(insets.bottom, 10) + 8 + extra;
}

/** Full-bleed page background. */
export function Screen({
  children,
  bg: bgProp,
  style,
}: {
  children: ReactNode;
  bg?: string;
  style?: ViewStyle;
}) {
  const { color } = useTheme();
  return <View style={[{ flex: 1, backgroundColor: bgProp ?? color.bg }, style]}>{children}</View>;
}

/**
 * The white nav bar used by Attendance, Compose, Add student and Student
 * profile. `leading` defaults to a back chevron; pass `dismiss` for the ✕ form
 * used by modal screens.
 */
export function TopBar({
  title,
  subtitle,
  dismiss,
  onLeading,
  trailing,
  bare,
  extraTopPadding = 6,
  children,
}: {
  title?: string;
  subtitle?: string;
  /** Render an ✕ instead of a back chevron. */
  dismiss?: boolean;
  onLeading?: () => void;
  trailing?: ReactNode;
  /** Drop the white background + hairline (used when the header is a gradient). */
  bare?: boolean;
  extraTopPadding?: number;
  children?: ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[!bare && styles.topBarSurface, { paddingTop: insets.top + extraTopPadding }]}>
      <View style={styles.topBarRow}>
        <IconButton
          name={dismiss ? 'close' : 'chevronLeft'}
          iconSize={dismiss ? 17 : 18}
          strokeWidth={dismiss ? 2 : 1.9}
          onPress={onLeading ?? (() => router.back())}
        />
        {title ? (
          <View style={styles.topBarTitleWrap}>
            <Text style={[text.navTitle, styles.ink]}>{title}</Text>
            {subtitle ? <Text style={styles.topBarSubtitle}>{subtitle}</Text> : null}
          </View>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <View style={styles.topBarTrailing}>{trailing ?? <View style={{ width: 40 }} />}</View>
      </View>
      {children}
    </View>
  );
}

/**
 * Translucent action bar pinned to the bottom of a screen (Save, Send).
 * Sits above the home indicator without the caller having to think about it.
 */
/**
 * How far a bottom-pinned bar has to rise to clear the software keyboard.
 *
 * The footer is `position: absolute; bottom: 0` and sits *outside* the
 * `KeyboardAvoidingView` on every screen that has one, so nothing was moving
 * it. That was fine while the window itself shrank when the keyboard opened —
 * and it stopped being fine when edge-to-edge became the default on Android,
 * because an edge-to-edge window is not resized by `adjustResize` any more; the
 * app is handed the keyboard as an inset and is expected to do something with
 * it. iOS never resized the window at all.
 *
 * The result on both platforms was a Save button sitting underneath the
 * keyboard: still mounted, still enabled, and impossible to hit. Which reads,
 * from the other side of the screen, as "the button does not work sometimes" —
 * sometimes being whenever the teacher had just finished typing.
 *
 * Measured rather than assumed, because both behaviours still exist in the
 * wild: whatever height the window has already given up is subtracted, so on a
 * build where `adjustResize` does still resize, this is zero and the footer
 * stays exactly where it was. No double lift, no guessing which Android this
 * is.
 */
export function useKeyboardLift() {
  const [lift, setLift] = useState(0);
  /** The window height with no keyboard up — the baseline to measure against. */
  const full = useRef(Dimensions.get('window').height);
  const open = useRef(false);

  useEffect(() => {
    // `will` on iOS so the bar travels with the keyboard rather than after it;
    // Android only emits `did`.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (e) => {
      open.current = true;
      const shrunk = Math.max(0, full.current - Dimensions.get('window').height);
      setLift(Math.max(0, e.endCoordinates.height - shrunk));
    });

    const hide = Keyboard.addListener(hideEvent, () => {
      open.current = false;
      full.current = Dimensions.get('window').height;
      setLift(0);
    });

    // A rotation changes the baseline. Only trusted while the keyboard is down,
    // since a resized window is exactly what the baseline exists to detect.
    const rotate = Dimensions.addEventListener('change', ({ window }) => {
      if (!open.current) full.current = window.height;
    });

    return () => {
      show.remove();
      hide.remove();
      rotate.remove();
    };
  }, []);

  return lift;
}

export function StickyFooter({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const lift = useKeyboardLift();

  return (
    <View
      style={[
        styles.footer,
        {
          bottom: lift,
          // The home indicator is under the keyboard while it is up, so the
          // inset it reserves is padding nobody can see.
          paddingBottom: (lift ? 14 : Math.max(insets.bottom, 14)) + 6,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

/** Left-hand summary text used inside `StickyFooter` next to the action button. */
export function FooterSummary({ title, hint }: { title: string; hint: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={styles.footerTitle}>{title}</Text>
      <Text style={styles.footerHint}>{hint}</Text>
    </View>
  );
}

/** Uppercase eyebrow + big title block, as on Home and Calendar. */
export function PageHeading({
  eyebrow,
  title,
  trailing,
  style,
}: {
  eyebrow?: string;
  title: string;
  trailing?: ReactNode;
  style?: ViewStyle;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.headingRow, style]}>
      <View style={{ flex: 1 }}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={[text.greeting, styles.ink, eyebrow ? { marginTop: 6 } : null]}>{title}</Text>
      </View>
      {trailing}
    </View>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    /** Default body ink. Text does not inherit colour from a parent View. */
    ink: { color: color.ink },
    topBarSurface: {
      backgroundColor: color.surface,
      borderBottomWidth: 1,
      borderBottomColor: color.border,
    },
    topBarRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: space.gutter,
      paddingBottom: 14,
    },
    topBarTitleWrap: { flex: 1, alignItems: 'center' },
    topBarSubtitle: {
      fontFamily: body[400],
      fontSize: 12,
      color: color.mutedLight,
      marginTop: 2,
    },
    topBarTrailing: { flexDirection: 'row', alignItems: 'center', gap: 8 },

    footer: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: color.barTint,
      borderTopWidth: 1,
      borderTopColor: color.border,
      paddingHorizontal: space.gutter,
      paddingTop: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    footerTitle: { fontFamily: body[700], fontSize: 13, color: color.ink },
    footerHint: {
      fontFamily: body[400],
      fontSize: 11.5,
      color: color.mutedLight,
      marginTop: 2,
    },

    headingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: space.gutter,
    },
    eyebrow: {
      fontFamily: body[700],
      fontSize: 11.5,
      letterSpacing: 11.5 * 0.13,
      textTransform: 'uppercase',
      color: color.mutedLight,
    },

    avatarButton: {
      width: 46,
      height: 46,
      borderRadius: radius.tile,
      backgroundColor: color.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });

import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
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
export function StickyFooter({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 14) + 6 }, style]}>
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

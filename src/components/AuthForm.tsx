/**
 * The shell and the field every auth screen is built from.
 *
 * Sign-in, registration and password reset are the only screens a teacher meets
 * before they trust the app, so they share one layout rather than three
 * near-identical ones that drift apart.
 *
 * The keyboard is the hard part. Two mechanisms cover it and they must not both
 * run on the same platform or they double-count and leave a gap:
 *
 *   iOS      `automaticallyAdjustKeyboardInsets` pads the scroll view.
 *   Android  `softwareKeyboardLayoutMode: "resize"` in app.json shrinks the
 *            window, which shrinks this ScrollView.
 *
 * Either way the *space* exists — but neither scrolls the field the teacher is
 * typing into up into it. That is what `AuthField` does on focus, measuring
 * itself against the scroll content so nesting cannot break it.
 */
import { useRouter } from 'expo-router';
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Press } from '@/components/ui';
import { useT } from '@/i18n/useT';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, display } from '@/theme/type';

/** How far below the top of the viewport a focused field comes to rest. */
const REVEAL_INSET = 16;

/**
 * Carries both halves of the reveal: the node fields measure themselves
 * against, and the scroll that acts on the result.
 */
type RevealCtx = { root: React.RefObject<View | null>; reveal: (y: number) => void };
const RevealContext = createContext<RevealCtx | null>(null);

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

export function AuthScreen({
  title,
  subtitle,
  step,
  steps,
  onBack,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  /** 1-based. Renders the progress rail when `steps` is also given. */
  step?: number;
  steps?: number;
  /** Defaults to `router.back()`. Registration overrides it to step backwards. */
  onBack?: () => void;
  children: ReactNode;
  /** Sits under the form, outside the scroll padding — the "already a member" line. */
  footer?: ReactNode;
}) {
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(makeStyles);
  const { color } = useTheme();

  const scroll = useRef<ScrollView>(null);
  const content = useRef<View>(null);

  const reveal = useCallback((y: number) => {
    // The keyboard has its own animation; scrolling before it settles gets
    // undone when the window resizes underneath us.
    setTimeout(
      () => scroll.current?.scrollTo({ y: Math.max(0, y - REVEAL_INSET), animated: true }),
      Platform.OS === 'android' ? 180 : 90,
    );
  }, []);

  const revealCtx = useMemo<RevealCtx>(() => ({ root: content, reveal }), [reveal]);

  const back = () => (onBack ? onBack() : router.back());

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        // iOS only — on Android the window itself resizes, and doing both
        // leaves a keyboard-sized hole under the form.
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + 6,
          paddingBottom: insets.bottom + 28,
          paddingHorizontal: space.gutter + 4,
        }}>
        <View ref={content} collapsable={false}>
          <View style={styles.headerRow}>
            <Press onPress={back} style={styles.backButton} accessibilityLabel={t('common.goBack')}>
              <Icon name="chevronLeft" size={17} color={color.ink} />
            </Press>
            {step && steps ? <StepRail step={step} steps={steps} /> : null}
          </View>

          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

          <RevealContext.Provider value={revealCtx}>
            <View style={styles.form}>{children}</View>
          </RevealContext.Provider>

          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </ScrollView>
    </View>
  );
}

function StepRail({ step, steps }: { step: number; steps: number }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View
      style={styles.rail}
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${step} of ${steps}`}>
      {Array.from({ length: steps }, (_, i) => (
        <View key={i} style={[styles.railSeg, i < step && styles.railSegOn]} />
      ))}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Field                                                                      */
/* -------------------------------------------------------------------------- */

export type AuthFieldProps = TextInputProps & {
  label: string;
  /** Quiet helper line. Replaced by `error` when there is one. */
  hint?: string;
  error?: string | null;
  optional?: boolean;
  /** Rendered inside the box on the right — the password reveal toggle. */
  trailing?: ReactNode;
  containerStyle?: ViewStyle;
};

export const AuthField = forwardRef<TextInput, AuthFieldProps>(function AuthField(
  { label, hint, error, optional, trailing, containerStyle, onFocus, onBlur, ...input },
  ref,
) {
  const t = useT();
  const { color, scheme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const ctx = useContext(RevealContext);
  const box = useRef<View>(null);
  const [focused, setFocused] = useState(false);

  return (
    <View ref={box} style={[styles.field, containerStyle]} collapsable={false}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {optional ? <Text style={styles.optional}>{t('common.optional')}</Text> : null}
      </View>

      <View
        style={[
          styles.box,
          focused && { borderColor: color.primary, backgroundColor: color.surface },
          !!error && { borderColor: color.danger },
        ]}>
        <TextInput
          ref={ref}
          placeholderTextColor={color.faint}
          selectionColor={color.primary}
          keyboardAppearance={scheme === 'dark' ? 'dark' : 'light'}
          style={styles.input}
          onFocus={(e) => {
            setFocused(true);
            // Measured against the scroll content rather than read off a layout
            // event, so a field wrapped in extra Views still lands correctly.
            if (ctx?.root.current) {
              box.current?.measureLayout(
                ctx.root.current,
                (_x, y) => ctx.reveal(y),
                () => {},
              );
            }
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...input}
        />
        {trailing}
      </View>

      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
});

/* -------------------------------------------------------------------------- */
/* Small shared bits                                                          */
/* -------------------------------------------------------------------------- */

/** The full-width action at the bottom of every auth form. */
export function AuthButton({
  label,
  onPress,
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Press
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      style={[styles.action, (disabled || busy) && styles.actionOff]}>
      <Text style={styles.actionLabel}>{busy ? 'Please wait…' : label}</Text>
    </Press>
  );
}

/** "Already have an account? Sign in" — the text plus its tappable tail. */
export function AuthLink({
  prompt,
  label,
  onPress,
}: {
  prompt: string;
  label: string;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.linkRow}>
      <Text style={styles.linkPrompt}>{prompt} </Text>
      <Press onPress={onPress} accessibilityRole="link" style={styles.linkPress}>
        <Text style={styles.linkLabel}>{label}</Text>
      </Press>
    </View>
  );
}

/** Inline failure banner — for errors about the form, not about one field. */
export function AuthNotice({
  tone = 'error',
  children,
}: {
  tone?: 'error' | 'info';
  children: ReactNode;
}) {
  const { color, accents } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const error = tone === 'error';
  // `rose` is the danger colourway — its tint is the one wash in the palette
  // that reads as a warning in both themes.
  const bg = error ? accents.rose.tint : color.primaryTint;
  const fg = error ? color.dangerDeep : color.primaryInk;
  const edge = error ? color.danger : color.primary;

  return (
    <View style={[styles.notice, { backgroundColor: bg, borderColor: edge }]}>
      <Icon name={error ? 'warning' : 'info'} size={15} color={fg} />
      <Text style={[styles.noticeText, { color: fg }]}>{children}</Text>
    </View>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: color.bg },

    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 22 },
    backButton: {
      width: 40,
      height: 40,
      borderRadius: radius.control,
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: color.border,
      alignItems: 'center',
      justifyContent: 'center',
    },

    rail: { flex: 1, flexDirection: 'row', gap: 6 },
    railSeg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: color.border },
    railSegOn: { backgroundColor: color.primary },

    title: {
      fontFamily: display[600],
      fontSize: 27,
      lineHeight: 33,
      letterSpacing: -0.5,
      color: color.ink,
    },
    subtitle: {
      fontFamily: body[400],
      fontSize: 14.5,
      lineHeight: 22,
      color: color.muted,
      marginTop: 8,
    },

    form: { marginTop: 26 },
    footer: { marginTop: 22 },

    field: { marginBottom: 16 },
    labelRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 7 },
    label: { fontFamily: body[600], fontSize: 13, color: color.inkSoft, flex: 1 },
    optional: { fontFamily: body[400], fontSize: 12, color: color.mutedLight },

    box: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 54,
      borderRadius: radius.button,
      backgroundColor: color.surface,
      borderWidth: 1.5,
      borderColor: color.border,
      paddingHorizontal: 15,
    },
    input: {
      flex: 1,
      paddingVertical: Platform.OS === 'ios' ? 16 : 12,
      fontFamily: body[600],
      fontSize: 16,
      color: color.ink,
    },

    hint: { fontFamily: body[400], fontSize: 12.5, color: color.mutedLight, marginTop: 6 },
    error: { fontFamily: body[600], fontSize: 12.5, color: color.dangerDeep, marginTop: 6 },

    action: {
      height: 54,
      marginTop: 8,
      borderRadius: radius.button,
      backgroundColor: color.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionOff: { backgroundColor: color.borderStrong },
    actionLabel: { fontFamily: body[700], fontSize: 15.5, color: '#fff' },

    linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    linkPrompt: { fontFamily: body[400], fontSize: 14, color: color.muted },
    linkPress: { paddingVertical: 8, paddingHorizontal: 2 },
    linkLabel: { fontFamily: body[700], fontSize: 14, color: color.primary },

    notice: {
      flexDirection: 'row',
      gap: 10,
      alignItems: 'flex-start',
      borderWidth: 1,
      borderRadius: radius.control,
      paddingHorizontal: 13,
      paddingVertical: 12,
      marginBottom: 18,
    },
    noticeText: { flex: 1, fontFamily: body[500], fontSize: 13, lineHeight: 19.5 },
  });

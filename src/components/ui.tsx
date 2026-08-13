import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { forwardRef, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  type PressableProps,
  type StyleProp,
  StyleSheet,
  Text,
  type TextProps,
  TextInput,
  type TextInputProps,
  type TextStyle,
  View,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import Svg, { Circle, G, Path } from 'react-native-svg';

import { Icon, type IconName } from '@/components/Icon';
import { useStudentPhoto } from '@/lib/studentPhoto';
import {
  PRESS_OPACITY,
  radius,
  useTheme,
  useThemedStyles,
  type AccentName,
  type Theme,
} from '@/theme';
import { body, text } from '@/theme/type';

/* -------------------------------------------------------------------------- */
/* Text                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Every piece of copy in the app goes through `Txt` so the Plus Jakarta family
 * and ink colour are applied by default — RN's `Text` would otherwise fall back
 * to the system font the moment a style is overridden.
 */
export function Txt({ style, ...rest }: TextProps) {
  const styles = useThemedStyles(makeStyles);
  return <Text style={[styles.txt, style]} {...rest} />;
}

/** Small-caps section label ("TO", "RECIPIENTS", "CONTACT"). */
export function Overline({ style, ...rest }: TextProps) {
  const { color } = useTheme();
  return <Text style={[text.overline, { color: color.mutedLight }, style]} {...rest} />;
}

/* -------------------------------------------------------------------------- */
/* Pressable                                                                  */
/* -------------------------------------------------------------------------- */

type PressProps = Omit<PressableProps, 'style'> & {
  /** Fire a selection tick on press. Use for state-changing taps, not navigation. */
  haptic?: boolean | Haptics.ImpactFeedbackStyle;
  style?: StyleProp<ViewStyle>;
};

/**
 * The single tappable primitive. The design has no ripple, just a quick opacity
 * dip, so that is what this does on both platforms.
 */
export const Press = forwardRef<View, PressProps>(function Press(
  { haptic, onPress, style, disabled, ...rest },
  ref,
) {
  return (
    <Pressable
      ref={ref}
      disabled={disabled}
      onPress={(e) => {
        if (haptic && Platform.OS !== 'web') {
          Haptics.impactAsync(haptic === true ? Haptics.ImpactFeedbackStyle.Light : haptic).catch(
            () => {},
          );
        }
        onPress?.(e);
      }}
      style={({ pressed }) => [
        style,
        pressed && { opacity: PRESS_OPACITY },
        disabled && { opacity: 0.55 },
      ]}
      {...rest}
    />
  );
});

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                   */
/* -------------------------------------------------------------------------- */

/** White surface, 1px cool border, 16px radius — the app's default container. */
export function Card({ style, ...rest }: ViewProps) {
  const styles = useThemedStyles(makeStyles);
  return <View style={[styles.card, style]} {...rest} />;
}

/** Hairline used inside cards. `inset` matches the design's `margin-left`. */
export function Divider({ inset = 0 }: { inset?: number }) {
  const styles = useThemedStyles(makeStyles);
  return <View style={[styles.divider, { marginLeft: inset }]} />;
}

/* -------------------------------------------------------------------------- */
/* Buttons                                                                    */
/* -------------------------------------------------------------------------- */

type ButtonProps = {
  label: string;
  icon?: IconName;
  onPress?: () => void;
  /** solid = primary blue, tonal = white on tint, ghost = borderless. */
  variant?: 'solid' | 'outline' | 'tonal' | 'ghost' | 'success';
  disabled?: boolean;
  height?: number;
  style?: ViewStyle;
  /** Fill the row rather than hugging its label. */
  grow?: boolean;
};

const buttonSkins = (
  color: Theme['color'],
): Record<NonNullable<ButtonProps['variant']>, { bg: string; fg: string; border?: string }> => ({
  solid: { bg: color.primary, fg: '#fff' },
  success: { bg: color.success, fg: '#fff' },
  outline: { bg: color.surface, fg: color.ink, border: color.border },
  tonal: { bg: color.primaryTint, fg: color.primaryInk },
  ghost: { bg: 'transparent', fg: color.primary },
});

export function Button({
  label,
  icon,
  onPress,
  variant = 'solid',
  disabled,
  height = 48,
  grow,
  style,
}: ButtonProps) {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const skin = buttonSkins(color)[variant];
  const bg = disabled && variant === 'solid' ? color.borderStrong : skin.bg;

  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        {
          height,
          backgroundColor: bg,
          borderWidth: skin.border ? 1 : 0,
          borderColor: skin.border,
        },
        grow ? { flex: 1 } : null,
        style as ViewStyle,
      ]}>
      {icon ? <Icon name={icon} size={16} color={skin.fg} /> : null}
      <Text style={[text.button, { color: skin.fg }]}>{label}</Text>
    </Press>
  );
}

/** Square icon-only control — nav bar actions, row call/message shortcuts. */
export function IconButton({
  name,
  onPress,
  size = 40,
  iconSize = 18,
  tint: tintProp,
  fg: fgProp,
  strokeWidth,
  radius: r = radius.control,
  style,
  accessibilityLabel,
}: {
  name: IconName;
  onPress?: () => void;
  size?: number;
  iconSize?: number;
  tint?: string;
  fg?: string;
  strokeWidth?: number;
  radius?: number;
  style?: ViewStyle;
  /** An icon on its own says nothing to a screen reader. Name what it does. */
  accessibilityLabel?: string;
}) {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const tint = tintProp ?? color.fill;
  const fg = fgProp ?? color.ink;
  return (
    <Press
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.center,
        { width: size, height: size, borderRadius: r, backgroundColor: tint },
        style as ViewStyle,
      ]}>
      <Icon name={name} size={iconSize} color={fg} strokeWidth={strokeWidth} />
    </Press>
  );
}

/* -------------------------------------------------------------------------- */
/* Identity                                                                   */
/* -------------------------------------------------------------------------- */

/** "Amir Rasulov" -> "AR". Falls back to a single letter for mononyms. */
export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Rounded-square initials tile, tinted by the owner's accent colour. */
export function Avatar({
  name,
  accent = 'blue',
  size = 42,
  radius: r,
  fontSize,
  style,
  photoId,
}: {
  name: string;
  accent?: AccentName;
  size?: number;
  radius?: number;
  fontSize?: number;
  style?: ViewStyle;
  /**
   * A student id. When that student has a picture on this device it is shown
   * instead of their initials.
   *
   * Read from disk rather than passed in as a URI so that every avatar in the
   * app picks a new photo up without each caller having to know about files.
   */
  photoId?: string;
}) {
  const { accents } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const a = accents[accent];
  const photo = useStudentPhoto(photoId);

  if (photo) {
    return (
      <Image
        source={photo}
        style={[
          {
            width: size,
            height: size,
            borderRadius: r ?? Math.round(size * 0.33),
            backgroundColor: a.tint,
          },
          style as object,
        ]}
        contentFit="cover"
      />
    );
  }

  return (
    <View
      style={[
        styles.center,
        {
          width: size,
          height: size,
          borderRadius: r ?? Math.round(size * 0.33),
          backgroundColor: a.tint,
        },
        style as ViewStyle,
      ]}>
      <Text
        style={{
          fontFamily: 'SpaceGrotesk_600SemiBold',
          fontSize: fontSize ?? Math.round(size * 0.345 * 10) / 10,
          color: a.ink,
        }}>
        {initialsOf(name)}
      </Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Chips & badges                                                             */
/* -------------------------------------------------------------------------- */

/** Coloured label pill — group tags, delivery status, "2 absences". */
export function Badge({
  label,
  bg,
  fg,
  icon,
  dot,
  style,
  textStyle,
}: {
  label: string;
  bg: string;
  fg: string;
  icon?: IconName;
  dot?: string;
  style?: ViewStyle;
  textStyle?: TextStyle;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.badge, { backgroundColor: bg }, style as ViewStyle]}>
      {dot ? <View style={[styles.badgeDot, { backgroundColor: dot }]} /> : null}
      {icon ? <Icon name={icon} size={12} color={fg} /> : null}
      <Text style={[styles.badgeText, { color: fg }, textStyle]}>{label}</Text>
    </View>
  );
}

/** Selectable group chip used by the composer and the add-student form. */
export function SelectChip({
  label,
  dot,
  count,
  selected,
  onPress,
  onLongPress,
  onRemove,
  removeLabel,
  height = 40,
}: {
  label: string;
  dot?: string;
  count?: number;
  selected: boolean;
  onPress: () => void;
  /** Optional second action, used where a chip is also the teacher's to delete. */
  onLongPress?: () => void;
  /**
   * Draws a small × at the end of the chip.
   *
   * Long-press alone was the only way to remove one, which is a gesture with no
   * affordance: nothing on screen says it is there, and a teacher who has not
   * read the hint under the row will never find it. The × is the same action,
   * visible.
   */
  onRemove?: () => void;
  /** What the × does, for screen readers. */
  removeLabel?: string;
  height?: number;
}) {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Press
      haptic
      onPress={onPress}
      onLongPress={onLongPress}
      style={[
        styles.selectChip,
        {
          height,
          borderRadius: height >= 42 ? radius.field : radius.control,
          backgroundColor: selected ? color.primaryTint : color.surface,
          borderColor: selected ? color.primary : color.border,
          ...(onRemove ? { paddingRight: 6 } : null),
        },
      ]}>
      {dot ? <View style={[styles.chipDot, { backgroundColor: dot }]} /> : null}
      <Text
        style={{
          fontFamily: body[600],
          fontSize: 13.5,
          color: selected ? color.primaryInk : color.inkSoft,
        }}>
        {label}
      </Text>
      {count != null ? (
        <Text
          style={{
            fontFamily: body[600],
            fontSize: 12,
            opacity: 0.65,
            color: selected ? color.primaryInk : color.inkSoft,
            ...text.tabular,
          }}>
          {count}
        </Text>
      ) : null}
      {onRemove ? (
        <Press
          onPress={onRemove}
          // Generous, because the target is 22pt inside a chip somebody is
          // trying to *select* — a miss that deletes would be unforgivable, and
          // a miss that selects is free.
          hitSlop={8}
          accessibilityLabel={removeLabel}
          style={[styles.chipRemove, { backgroundColor: color.fill }]}>
          <Icon name="close" size={10} color={color.mutedLight} />
        </Press>
      ) : null}
    </Press>
  );
}

/* -------------------------------------------------------------------------- */
/* Stats                                                                      */
/* -------------------------------------------------------------------------- */

/** One cell of the three-up stat strip on group and student screens. */
export function StatTile({
  value,
  label,
  tone,
  fontSize = 22,
}: {
  value: string;
  label: string;
  tone?: string;
  fontSize?: number;
}) {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Card style={styles.statTile}>
      <Text style={[text.stat, { fontSize, color: tone ?? color.ink }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Inputs                                                                     */
/* -------------------------------------------------------------------------- */

/** Labelled input row inside a grouped card (add-student form). */
export function FieldRow({
  label,
  labelWidth = 74,
  ...input
}: TextInputProps & { label: string; labelWidth?: number }) {
  const { color, scheme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.fieldRow}>
      <Text style={[styles.fieldLabel, { width: labelWidth }]}>{label}</Text>
      <TextInput
        placeholderTextColor={color.faint}
        style={styles.fieldInput}
        {...input}
        selectionColor={color.primary}
        keyboardAppearance={scheme === 'dark' ? 'dark' : 'light'}
      />
    </View>
  );
}

/** iOS-style switch drawn to the design's exact geometry. */
export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Press
      haptic
      onPress={() => onChange(!value)}
      style={[
        styles.toggle,
        {
          backgroundColor: value ? color.primary : color.dashed,
          justifyContent: value ? 'flex-end' : 'flex-start',
        },
      ]}>
      <View style={styles.toggleKnob} />
    </Press>
  );
}

/** Sliding segmented control (Students / Parents / Both). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  const { color, shadow } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.segmentTrack}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Press
            key={o.key}
            haptic
            onPress={() => onChange(o.key)}
            style={[styles.segment, on && { backgroundColor: color.surface, ...shadow.segment }]}>
            <Text
              style={{
                fontFamily: on ? body[700] : body[600],
                fontSize: 13.5,
                color: on ? color.ink : color.muted,
              }}>
              {o.label}
            </Text>
          </Press>
        );
      })}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                       */
/* -------------------------------------------------------------------------- */

/** The three-bar ClassCare mark. Scales from the 38px header to the 46px hero. */
/**
 * The Held mark on a rounded tile — three heads over one cradling stroke.
 *
 * Drawn from the vector master in `icons/svg/held-mark-onblue.svg` rather than
 * bundling a PNG, so it stays sharp at every size and can follow the theme.
 * Geometry is the 96-unit master grid described in `icons/README.md`, scaled to
 * whatever `size` is asked for.
 *
 * The README's small-size rule is applied below 44px: the cradle thickens, the
 * heads grow, and the two-tone treatment drops to one colour, because at that
 * scale the teal heads read as noise against the blue.
 */
export function Logo({ size = 46, tint: tintProp }: { size?: number; tint?: string }) {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const tint = tintProp ?? color.primary;

  const small = size < 44;
  const artwork = size * 0.74;
  const stroke = small ? 15.5 : 13;
  const head = small ? 7.5 : 6.5;

  return (
    <View
      style={[
        styles.center,
        {
          width: size,
          height: size,
          borderRadius: size * 0.224,
          backgroundColor: tint,
        },
      ]}>
      <Svg width={artwork} height={artwork} viewBox="0 0 96 96">
        {/* The master shifts the mark +6.5 on Y so it sits optically centred. */}
        <G translateY={6.5}>
          <Path
            d="M16 36C16 74 80 74 80 36"
            fill="none"
            stroke="#fff"
            strokeWidth={stroke}
            strokeLinecap="round"
          />
          <G fill={small ? '#fff' : '#6FE3DE'}>
            <Circle cx={31} cy={24} r={head} />
            <Circle cx={48} cy={17} r={head} />
            <Circle cx={65} cy={24} r={head} />
          </G>
        </G>
      </Svg>
    </View>
  );
}

/** Centered "nothing here" state used by search and empty calendar days. */
export function EmptyState({ title, hint }: { title: string; hint: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyHint}>{hint}</Text>
    </View>
  );
}

/** Small helper for the repeated `<Overline>` + content block rhythm. */
export function Section({
  label,
  action,
  children,
  style,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
  style?: ViewStyle;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={style}>
      <View style={styles.sectionHead}>
        <Overline>{label}</Overline>
        {action}
      </View>
      {children}
    </View>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    txt: { fontFamily: body[400], color: color.ink },
    center: { alignItems: 'center', justifyContent: 'center' },

    card: {
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: color.border,
      borderRadius: radius.card,
    },
    divider: { height: 1, backgroundColor: color.divider },

    button: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderRadius: radius.button,
      paddingHorizontal: 20,
    },

    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.sm,
    },
    badgeDot: { width: 7, height: 7, borderRadius: 2 },
    badgeText: { fontFamily: body[700], fontSize: 11.5 },

    selectChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 13,
      borderWidth: 1.5,
    },
    chipDot: { width: 8, height: 8, borderRadius: 3 },
    chipRemove: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 2,
    },

    statTile: {
      flex: 1,
      borderRadius: radius.tile - 1,
      paddingHorizontal: 12,
      paddingVertical: 13,
    },
    statLabel: {
      fontFamily: body[600],
      fontSize: 11,
      color: color.mutedLight,
      marginTop: 3,
    },

    fieldRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 15,
      paddingVertical: 12,
    },
    fieldLabel: { fontFamily: body[700], fontSize: 12.5, color: color.muted },
    fieldInput: {
      flex: 1,
      minWidth: 0,
      fontFamily: body[600],
      fontSize: 15,
      color: color.ink,
      padding: 0,
    },

    toggle: {
      width: 50,
      height: 30,
      borderRadius: 15,
      padding: 3,
      flexDirection: 'row',
    },
    toggleKnob: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: '#fff',
      boxShadow: '0 1px 4px rgba(12,23,41,0.2)',
    },

    segmentTrack: {
      flexDirection: 'row',
      gap: 4,
      padding: 4,
      backgroundColor: color.canvas,
      borderRadius: radius.button,
    },
    segment: {
      flex: 1,
      height: 42,
      borderRadius: radius.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },

    empty: {
      alignItems: 'center',
      gap: 5,
      paddingVertical: 40,
      paddingHorizontal: 20,
    },
    emptyTitle: { fontFamily: body[700], fontSize: 15, color: color.inkSoft },
    emptyHint: { fontFamily: body[400], fontSize: 13, color: color.mutedLight },

    sectionHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
  });

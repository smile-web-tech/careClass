/**
 * The two row shapes every settings list is built from.
 *
 * Extracted from Profile when the settings moved out of it. One copy, because
 * two screens showing rows that are nearly the same height with nearly the same
 * padding is exactly how an app starts looking unfinished.
 */
import { StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { Press } from '@/components/ui';
import { radius, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body } from '@/theme/type';

/** A fact, with no action attached. */
export function InfoRow({
  icon,
  label,
  value,
}: {
  icon: IconName;
  label: string;
  value: string;
}) {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Icon name={icon} size={16} color={color.inkSoft} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
}

/** A row that goes somewhere or does something. */
export function ActionRow({
  icon,
  label,
  hint,
  onPress,
  tint: tintProp,
  fg: fgProp,
  labelColor: labelColorProp,
}: {
  icon: IconName;
  label: string;
  hint: string;
  onPress?: () => void;
  tint?: string;
  fg?: string;
  labelColor?: string;
}) {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const tint = tintProp ?? color.fill;
  const fg = fgProp ?? color.inkSoft;
  const labelColor = labelColorProp ?? color.ink;

  return (
    <Press onPress={onPress} disabled={!onPress} style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: tint }]}>
        <Icon name={icon} size={16} color={fg} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.actionLabel, { color: labelColor }]}>{label}</Text>
        <Text style={styles.actionHint} numberOfLines={2}>
          {hint}
        </Text>
      </View>
      {onPress ? <Icon name="disclosure" size={16} color={color.chevron} /> : null}
    </Press>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 13,
    },
    rowIcon: {
      width: 32,
      height: 32,
      borderRadius: radius.md,
      backgroundColor: color.fill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowLabel: {
      fontFamily: body[700],
      fontSize: 10.5,
      letterSpacing: 0.84,
      textTransform: 'uppercase',
      color: color.mutedLight,
    },
    rowValue: { fontFamily: body[600], fontSize: 14.5, color: color.ink, marginTop: 2 },

    // `Text` does not inherit colour from its parent View and the default is
    // black, which is invisible on a dark card. Set explicitly, always.
    actionLabel: { fontFamily: body[700], fontSize: 14.5, color: color.ink },
    actionHint: { fontFamily: body[400], fontSize: 12.5, color: color.mutedLight, marginTop: 2 },
  });

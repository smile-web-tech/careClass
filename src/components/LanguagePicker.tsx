/**
 * Choosing the interface language.
 *
 * Each option is written in its own language — "Türkmen dili", "Русский" —
 * never translated into the currently selected one. Somebody who has landed on
 * the wrong language needs to recognise their own, and "Turkmen" rendered in
 * Russian helps nobody find their way out.
 *
 * Used twice: on the welcome screen before anything else is decided, and in
 * Profile afterwards.
 */
import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Press } from '@/components/ui';
import { useStore } from '@/data/store';
import { LANGUAGES, type Language } from '@/i18n';
import { radius, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body } from '@/theme/type';

export function LanguagePicker({
  /** Welcome screen shows big cards; settings shows a compact list. */
  variant = 'list',
  onPick,
}: {
  variant?: 'list' | 'cards';
  onPick?: (language: Language) => void;
}) {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const language = useStore((s) => s.language);
  const setLanguage = useStore((s) => s.setLanguage);

  const choose = (next: Language) => {
    setLanguage(next);
    onPick?.(next);
  };

  if (variant === 'cards') {
    return (
      <View style={styles.cardRow}>
        {LANGUAGES.map((option) => {
          const on = option.code === language;
          return (
            <Press
              key={option.code}
              haptic
              onPress={() => choose(option.code)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={option.english}
              style={[
                styles.card,
                on && { borderColor: color.primary, backgroundColor: color.primaryTint },
              ]}>
              <Text style={[styles.cardLabel, on && { color: color.primaryInk }]}>
                {option.label}
              </Text>
              {on ? <Icon name="check" size={15} color={color.primary} /> : null}
            </Press>
          );
        })}
      </View>
    );
  }

  return (
    <View>
      {LANGUAGES.map((option, i) => {
        const on = option.code === language;
        return (
          <Press
            key={option.code}
            haptic
            onPress={() => choose(option.code)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={option.english}
            style={[styles.row, i > 0 && styles.rowBordered]}>
            <Text style={[styles.rowLabel, on && { color: color.primaryInk }]}>{option.label}</Text>
            {on ? <Icon name="check" size={16} color={color.primary} /> : null}
          </Press>
        );
      })}
    </View>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    cardRow: { gap: 10 },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      borderRadius: radius.button,
      borderWidth: 1.5,
      borderColor: color.border,
      backgroundColor: color.surface,
      paddingHorizontal: 18,
      paddingVertical: 16,
    },
    cardLabel: { fontFamily: body[700], fontSize: 16, color: color.ink },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 15,
      paddingVertical: 14,
    },
    rowBordered: { borderTopWidth: 1, borderTopColor: color.divider },
    rowLabel: { fontFamily: body[600], fontSize: 14.5, color: color.ink },
  });

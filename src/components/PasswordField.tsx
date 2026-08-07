/**
 * Password entry with a live strength read-out.
 *
 * The meter is not decoration. A teacher choosing a password has no idea which
 * of their habits are bad ones, and a form that only says "too weak" after they
 * submit teaches nothing. Four segments fill as the password improves, the tip
 * underneath names the single most useful change, and anything genuinely
 * unsafe is spelled out as a blocking problem rather than hinted at.
 *
 * Reveal is a text toggle rather than an eye glyph: it is unambiguous, it reads
 * correctly to a screen reader without extra labelling, and it does not need a
 * new icon path.
 */
import { forwardRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { AuthField, type AuthFieldProps } from '@/components/AuthForm';
import { Press } from '@/components/ui';
import { useT } from '@/i18n/useT';
import { scorePassword, type Strength } from '@/lib/password';
import { useTheme, useThemedStyles, type Theme } from '@/theme';
import { body } from '@/theme/type';

export const PasswordField = forwardRef<
  TextInput,
  Omit<AuthFieldProps, 'trailing' | 'secureTextEntry'> & {
    value: string;
    /** Shows the meter. Off for a login field, where scoring is meaningless. */
    meter?: boolean;
    /** Name and email, so a password built from them can be rejected. */
    personal?: string[];
    /** Suppresses the blocking problems until the teacher has stopped typing. */
    showProblems?: boolean;
  }
>(function PasswordField(
  { value, meter = false, personal = [], showProblems = true, ...rest },
  ref,
) {
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const [revealed, setRevealed] = useState(false);

  // Scored on every keystroke rather than memoised: `personal` is a fresh array
  // on each render, so a dependency list would never hit, and the work is a
  // handful of regexes over a string shorter than a tweet.
  const strength = meter ? scorePassword(value, personal) : null;

  return (
    <View>
      <AuthField
        ref={ref}
        value={value}
        secureTextEntry={!revealed}
        autoCapitalize="none"
        autoCorrect={false}
        // Left at the default deliberately: switching `keyboardType` in step
        // with `secureTextEntry` remounts the input on Android and drops what
        // has been typed so far.
        spellCheck={false}
        trailing={
          <Press
            onPress={() => setRevealed((r) => !r)}
            accessibilityRole="button"
            accessibilityLabel={revealed ? t('password.hide') : t('password.show')}
            hitSlop={10}
            style={styles.reveal}>
            <Text style={styles.revealLabel}>
              {revealed ? t('password.hide') : t('password.show')}
            </Text>
          </Press>
        }
        {...rest}
      />

      {strength && value.length > 0 ? (
        <StrengthReadout strength={strength} showProblems={showProblems} />
      ) : null}
    </View>
  );
});

function StrengthReadout({
  strength,
  showProblems,
}: {
  strength: Strength;
  showProblems: boolean;
}) {
  const { color, accents } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Subscribed, not read once: the meter has to re-translate when the teacher
  // switches language, and `scorePattern` above returns keys precisely so it
  // can. See the `Phrase` type in `lib/password.ts`.
  const t = useT();

  // Red through amber to green, so the colour says the same thing as the count.
  const scale = [color.danger, color.danger, accents.amber.dot, accents.lime.dot, color.success];
  const tint = scale[strength.score];

  return (
    <View style={styles.meterWrap}>
      <View style={styles.meterRow}>
        <View style={styles.segments}>
          {[0, 1, 2, 3].map((i) => (
            <View
              key={i}
              style={[styles.segment, i < strength.score && { backgroundColor: tint }]}
            />
          ))}
        </View>
        <Text style={[styles.meterLabel, { color: tint }]}>
          {strength.labelKey ? t(strength.labelKey) : ''}
        </Text>
      </View>

      {showProblems && strength.problems.length > 0 ? (
        strength.problems.map((p) => (
          <Text key={p.key} style={styles.problem}>
            {t(p.key, p.vars)}
          </Text>
        ))
      ) : strength.tip ? (
        <Text style={styles.tip}>{t(strength.tip.key, strength.tip.vars)}</Text>
      ) : null}
    </View>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    reveal: { paddingLeft: 12, paddingVertical: 8 },
    revealLabel: { fontFamily: body[700], fontSize: 13, color: color.primary },

    // Pulled up under the field, which carries its own bottom margin.
    meterWrap: { marginTop: -8, marginBottom: 16 },
    meterRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    segments: { flex: 1, flexDirection: 'row', gap: 5 },
    segment: { flex: 1, height: 4, borderRadius: 2, backgroundColor: color.border },
    meterLabel: { fontFamily: body[700], fontSize: 12, minWidth: 54, textAlign: 'right' },

    problem: { fontFamily: body[600], fontSize: 12.5, color: color.dangerDeep, marginTop: 7 },
    tip: { fontFamily: body[400], fontSize: 12.5, color: color.mutedLight, marginTop: 7 },
  });

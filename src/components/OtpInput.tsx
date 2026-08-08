/**
 * Six-box one-time-code input.
 *
 * Deliberately ONE hidden `TextInput` behind six drawn boxes, rather than six
 * real inputs wired together. Six inputs look the same and behave badly: paste
 * only fills the first box, autofill from the SMS/email suggestion bar cannot
 * target them, backspace across a boundary needs manual ref juggling, and
 * screen readers announce six unlabelled fields.
 *
 * With one input the platform does the work — `oneTimeCode` / `smsOTPCode`
 * autofill, paste, and select-all all behave as the OS intends.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { radius, useTheme, useThemedStyles, type Theme } from '@/theme';
import { display } from '@/theme/type';

export function OtpInput({
  value,
  onChange,
  length = 6,
  autoFocus = true,
  onComplete,
  editable = true,
  invalid = false,
}: {
  value: string;
  onChange: (v: string) => void;
  length?: number;
  autoFocus?: boolean;
  /** Fired once the last digit lands, so the caller can submit automatically. */
  onComplete?: (code: string) => void;
  editable?: boolean;
  invalid?: boolean;
}) {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const ref = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  // Guards against firing `onComplete` twice for the same code, which would
  // submit the form and then immediately submit it again.
  const submitted = useRef<string | null>(null);

  useEffect(() => {
    if (value.length < length) submitted.current = null;
    if (value.length === length && submitted.current !== value) {
      submitted.current = value;
      onComplete?.(value);
    }
  }, [value, length, onComplete]);

  const handle = (raw: string) => {
    // Strip everything but digits: pasting "123 456" or "Code: 123456" should
    // just work rather than being rejected.
    const digits = raw.replace(/\D/g, '').slice(0, length);
    onChange(digits);
  };

  const boxes = Array.from({ length }, (_, i) => i);
  // The caret sits on the next empty box, or the last one when full.
  const caretAt = Math.min(value.length, length - 1);

  return (
    <Pressable onPress={() => ref.current?.focus()} accessibilityRole="none" style={styles.row}>
      {boxes.map((i) => {
        const char = value[i] ?? '';
        const active = editable && focused && i === caretAt;
        return (
          <View
            key={i}
            style={[
              styles.box,
              char !== '' && styles.boxFilled,
              active && { borderColor: color.primary, backgroundColor: color.surface },
              invalid && styles.boxInvalid,
            ]}>
            <Text style={[styles.digit, invalid && { color: color.dangerDeep }]}>{char}</Text>
            {active && char === '' ? <View style={styles.caret} /> : null}
          </View>
        );
      })}

      <TextInput
        ref={ref}
        value={value}
        onChangeText={handle}
        editable={editable}
        autoFocus={autoFocus}
        keyboardType="number-pad"
        inputMode="numeric"
        textContentType="oneTimeCode"
        autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
        maxLength={length}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // Off-screen rather than transparent-on-top: an invisible input laid
        // over the boxes swallows the paste long-press that makes this usable.
        style={styles.hidden}
        caretHidden
        {...({ 'aria-label': 'One-time code' } as TextInputProps)}
      />
    </Pressable>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    row: { flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
    box: {
      flex: 1,
      aspectRatio: 0.82,
      maxWidth: 54,
      borderRadius: radius.field,
      borderWidth: 1.5,
      borderColor: color.border,
      backgroundColor: color.fill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    boxFilled: { borderColor: color.borderStrong, backgroundColor: color.surface },
    boxInvalid: { borderColor: color.danger, backgroundColor: color.surface },
    digit: { fontFamily: display[600], fontSize: 24, color: color.ink },
    caret: {
      position: 'absolute',
      width: 2,
      height: 24,
      borderRadius: 1,
      backgroundColor: color.primary,
    },
    hidden: { position: 'absolute', opacity: 0, height: 1, width: 1, top: -100 },
  });

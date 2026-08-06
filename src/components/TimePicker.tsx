/**
 * Wheel time picker.
 *
 * Typing "16:00" into a text field is the wrong interaction for a value with
 * only 24 × 12 valid states, and it puts validation in front of the teacher
 * ("Use 24-hour times") for what should be a two-second scroll.
 *
 * Implemented in JS rather than with `@react-native-community/datetimepicker`
 * on purpose: the native module would need a new native build to install, and
 * its dialog is styled by the OS, so it would ignore the app's own light/dark
 * choice whenever that differs from the system.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Press } from '@/components/ui';
import { useT } from '@/i18n/useT';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, display, text } from '@/theme/type';

const ITEM_HEIGHT = 46;
/** Rows visible above and below the selected one. */
const PAD_ROWS = 2;
const VIEWPORT = ITEM_HEIGHT * (PAD_ROWS * 2 + 1);

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

/** `HH:MM` → `[hh, mm]`, falling back to 09:00 for anything malformed. */
function parse(value: string): [string, string] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return ['09', '00'];
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const raw = Math.min(59, Math.max(0, Number(m[2])));
  // Snap to the nearest 5, which is the only granularity the wheel offers.
  const mm = Math.round(raw / 5) * 5;
  return [String(h).padStart(2, '0'), String(mm === 60 ? 55 : mm).padStart(2, '0')];
}

/** One column of the wheel. */
function Column({
  values,
  value,
  onChange,
  testID,
}: {
  values: string[];
  value: string;
  onChange: (v: string) => void;
  testID?: string;
}) {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const ref = useRef<ScrollView>(null);
  const index = Math.max(0, values.indexOf(value));

  // Jump to the incoming value on mount and whenever it changes from outside.
  useEffect(() => {
    ref.current?.scrollTo({ y: index * ITEM_HEIGHT, animated: false });
  }, [index]);

  const settle = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const i = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
      const next = values[Math.min(values.length - 1, Math.max(0, i))];
      if (next !== value) onChange(next);
    },
    [onChange, value, values],
  );

  return (
    <ScrollView
      ref={ref}
      testID={testID}
      style={{ height: VIEWPORT }}
      showsVerticalScrollIndicator={false}
      // Snapping is what makes this feel like a picker rather than a list.
      snapToInterval={ITEM_HEIGHT}
      decelerationRate="fast"
      onMomentumScrollEnd={settle}
      // Momentum does not always fire on Android for a short flick.
      onScrollEndDrag={settle}
      contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * PAD_ROWS }}>
      {values.map((v) => {
        const on = v === value;
        return (
          <Press
            key={v}
            onPress={() => {
              onChange(v);
              ref.current?.scrollTo({ y: values.indexOf(v) * ITEM_HEIGHT, animated: true });
            }}
            style={styles.item}>
            <Text style={[styles.itemLabel, { color: on ? color.ink : color.mutedLight }]}>{v}</Text>
          </Press>
        );
      })}
    </ScrollView>
  );
}

export function TimePicker({
  visible,
  value,
  title,
  /** Reject times at or before this, e.g. an end time before its start. */
  min,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  value: string;
  title: string;
  min?: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const t = useT();
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  const [hh, setHh] = useState(() => parse(value)[0]);
  const [mm, setMm] = useState(() => parse(value)[1]);

  // Re-seed each time the sheet opens so it always reflects the current field.
  useEffect(() => {
    if (!visible) return;
    const [h, m] = parse(value);
    setHh(h);
    setMm(m);
  }, [visible, value]);

  const picked = `${hh}:${mm}`;
  const tooEarly = !!min && picked <= min;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Press style={styles.scrim} onPress={onCancel} accessibilityLabel="Dismiss" />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        <View style={styles.grabber} />
        <Text style={[text.sheetTitle, styles.ink]}>{title}</Text>

        <View style={styles.wheelWrap}>
          {/* The selection band sits behind the columns, so the chosen row
              reads as held in place while the numbers move past it. */}
          <View pointerEvents="none" style={styles.band} />
          <View style={styles.columns}>
            <Column values={HOURS} value={hh} onChange={setHh} testID="tp-hours" />
            <Text style={styles.colon}>:</Text>
            <Column values={MINUTES} value={mm} onChange={setMm} testID="tp-minutes" />
          </View>
        </View>

        {tooEarly ? (
          <Text style={styles.warn}>Must be after {min}.</Text>
        ) : (
          <Text style={styles.preview}>{picked}</Text>
        )}

        <View style={styles.actions}>
          <Press onPress={onCancel} style={[styles.button, styles.buttonGhost]}>
            <Text style={[styles.buttonLabel, { color: color.inkSoft }]}>{t('common.cancel')}</Text>
          </Press>
          <Press
            onPress={() => onConfirm(picked)}
            disabled={tooEarly}
            style={[styles.button, styles.buttonSolid, tooEarly && styles.buttonOff]}>
            <Text style={[styles.buttonLabel, { color: '#fff' }]}>{t('common.done')}</Text>
          </Press>
        </View>
      </View>
    </Modal>
  );
}

/**
 * The field a teacher taps to open the wheel. Looks like an input, behaves like
 * a button — no keyboard, nothing to mistype.
 */
export function TimeField({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress: () => void;
}) {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Press onPress={onPress} style={styles.field} accessibilityRole="button">
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldValueWrap}>
        <Text style={styles.fieldValue}>{value}</Text>
        <View style={[styles.fieldChevron, { borderColor: color.chevron }]} />
      </View>
    </Press>
  );
}

const makeStyles = ({ color, shadow }: Theme) =>
  StyleSheet.create({
    ink: { color: color.ink },

    scrim: { flex: 1, backgroundColor: color.scrim },
    sheet: {
      backgroundColor: color.sheet,
      borderTopLeftRadius: radius.sheet,
      borderTopRightRadius: radius.sheet,
      paddingHorizontal: space.gutter,
      paddingTop: 10,
    },
    grabber: {
      alignSelf: 'center',
      width: 38,
      height: 4,
      borderRadius: 2,
      backgroundColor: color.dashed,
      marginBottom: 16,
    },

    wheelWrap: { height: VIEWPORT, marginTop: 14, justifyContent: 'center' },
    band: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: ITEM_HEIGHT,
      top: ITEM_HEIGHT * PAD_ROWS,
      borderRadius: radius.field,
      backgroundColor: color.primaryTint,
    },
    columns: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4 },
    item: { height: ITEM_HEIGHT, minWidth: 74, alignItems: 'center', justifyContent: 'center' },
    itemLabel: { fontFamily: display[600], fontSize: 24, letterSpacing: -0.5 },
    colon: {
      fontFamily: display[600],
      fontSize: 24,
      color: color.mutedLight,
      marginBottom: 2,
    },

    preview: {
      fontFamily: body[600],
      fontSize: 13,
      color: color.mutedLight,
      textAlign: 'center',
      marginTop: 14,
    },
    warn: {
      fontFamily: body[600],
      fontSize: 13,
      color: color.dangerDeep,
      textAlign: 'center',
      marginTop: 14,
    },

    actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
    button: {
      flex: 1,
      height: 50,
      borderRadius: radius.button,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonGhost: { backgroundColor: color.fill },
    buttonSolid: { backgroundColor: color.primary },
    buttonOff: { backgroundColor: color.borderStrong },
    buttonLabel: { fontFamily: body[700], fontSize: 15 },

    field: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 15,
      paddingVertical: 13,
      opacity: 1,
    },
    fieldLabel: { fontFamily: body[600], fontSize: 14.5, color: color.inkSoft },
    fieldValueWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    fieldValue: {
      fontFamily: display[600],
      fontSize: 16,
      color: color.ink,
      ...text.tabular,
      ...shadow.segment,
      backgroundColor: color.fill,
      overflow: 'hidden',
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    fieldChevron: {
      width: 7,
      height: 7,
      borderRightWidth: 1.8,
      borderBottomWidth: 1.8,
      transform: [{ rotate: '45deg' }],
      marginTop: -3,
    },
  });

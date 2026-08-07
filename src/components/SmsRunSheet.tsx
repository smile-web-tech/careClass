/**
 * What the teacher watches while their phone works through a class list.
 *
 * A spinner would be wrong here. Sending thirty texts takes half a minute, some
 * of them will fail for reasons worth reading, and the phone must stay on this
 * screen — so the sheet shows the count climbing, names each recipient as it
 * lands, and stays open at the end with the failures still legible.
 *
 * It is deliberately not dismissable by tapping outside: leaving mid-run does
 * not stop the queue, and a half-sent batch the teacher cannot see is the one
 * outcome worse than a failed one.
 */
import { useMemo } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Button, Press } from '@/components/ui';
import type { SmsOutcome } from '@/lib/deviceSms';
import type { TranslationKey } from '@/i18n';
import { useT } from '@/i18n/useT';
import { radius, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, display, text } from '@/theme/type';

/** Native reason codes we have words for; anything else falls back. */
const KNOWN_REASONS = new Set([
  'no_service',
  'radio_off',
  'limit_exceeded',
  'generic_failure',
  'timeout',
  'no_number',
  'unavailable',
]);

export function SmsRunSheet({
  visible,
  total,
  results,
  running,
  onCancel,
  onClose,
}: {
  visible: boolean;
  total: number;
  results: SmsOutcome[];
  running: boolean;
  onCancel: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  const sent = results.filter((r) => r.state === 'sent').length;
  const failed = results.length - sent;
  const cancelled = running ? 0 : total - results.length;

  const reasonLabel = (reason?: string) =>
    t(
      (KNOWN_REASONS.has(reason ?? '')
        ? `sms.reason.${reason}`
        : 'sms.reason.unknown') as TranslationKey,
    );

  // Newest first: the row that just landed is the one being looked at.
  const rows = useMemo(() => [...results].reverse(), [results]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      // Android's back button is the one dismissal that must still work, and
      // while running it cancels rather than hides.
      onRequestClose={running ? onCancel : onClose}>
      <View style={styles.scrim} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
        <View style={styles.grabber} />

        <View style={styles.head}>
          {running ? (
            <ActivityIndicator color={color.primary} />
          ) : (
            <Icon
              name={failed ? 'warning' : 'check'}
              size={20}
              color={failed ? color.warningDeep : color.success}
            />
          )}
          <Text style={[text.sheetTitle, styles.ink]}>
            {running ? t('sms.sendingTitle') : t('sms.doneTitle')}
          </Text>
        </View>

        <Text style={styles.count}>{t('sms.progress', { done: results.length, total })}</Text>

        <View style={styles.bar}>
          <View
            style={[styles.barFill, { width: `${total ? (results.length / total) * 100 : 0}%` }]}
          />
        </View>

        <View style={styles.tallies}>
          <Tally tone={color.success} label={t('sms.sentCount', { count: sent })} />
          {failed > 0 ? (
            <Tally tone={color.dangerDeep} label={t('sms.failedCount', { count: failed })} />
          ) : null}
          {cancelled > 0 ? (
            <Tally tone={color.muted} label={t('sms.stoppedCount', { count: cancelled })} />
          ) : null}
        </View>

        {running ? <Text style={styles.hint}>{t('sms.sendingHint')}</Text> : null}

        <ScrollView
          style={styles.list}
          contentContainerStyle={{ paddingBottom: 6 }}
          showsVerticalScrollIndicator={false}>
          {rows.map((r) => (
            <View key={r.key} style={styles.row}>
              <Icon
                name={r.state === 'sent' ? 'check' : 'close'}
                size={13}
                color={r.state === 'sent' ? color.success : color.dangerDeep}
              />
              <Text style={styles.rowName} numberOfLines={1}>
                {r.name}
              </Text>
              <Text
                style={[styles.rowNote, r.state === 'failed' && { color: color.dangerDeep }]}
                numberOfLines={1}>
                {r.state === 'sent'
                  ? r.parts > 1
                    ? t('sms.segments', { count: r.parts })
                    : r.phone
                  : reasonLabel(r.reason)}
              </Text>
            </View>
          ))}
        </ScrollView>

        {running ? (
          <Press onPress={onCancel} style={styles.cancel}>
            <Text style={styles.cancelLabel}>{t('common.cancel')}</Text>
          </Press>
        ) : (
          <Button grow label={t('common.done')} height={50} onPress={onClose} />
        )}
      </View>
    </Modal>
  );
}

function Tally({ tone, label }: { tone: string; label: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.tally}>
      <View style={[styles.tallyDot, { backgroundColor: tone }]} />
      <Text style={[styles.tallyLabel, { color: tone }]}>{label}</Text>
    </View>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    ink: { color: color.ink },
    scrim: { flex: 1, backgroundColor: color.scrim },
    sheet: {
      backgroundColor: color.sheet,
      borderTopLeftRadius: radius.sheet,
      borderTopRightRadius: radius.sheet,
      paddingHorizontal: 22,
      paddingTop: 10,
    },
    grabber: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: color.dashed,
      marginBottom: 16,
    },

    head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    count: {
      fontFamily: display[600],
      fontSize: 30,
      color: color.ink,
      marginTop: 12,
      fontVariant: ['tabular-nums'],
    },

    bar: {
      height: 6,
      borderRadius: 3,
      backgroundColor: color.border,
      overflow: 'hidden',
      marginTop: 10,
    },
    barFill: { height: 6, borderRadius: 3, backgroundColor: color.primary },

    tallies: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 12 },
    tally: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    tallyDot: { width: 7, height: 7, borderRadius: 4 },
    tallyLabel: { fontFamily: body[600], fontSize: 13 },

    hint: {
      fontFamily: body[400],
      fontSize: 12.5,
      lineHeight: 18.5,
      color: color.mutedLight,
      marginTop: 10,
    },

    // Capped so a class of forty does not push the buttons off the screen.
    list: { maxHeight: 210, marginTop: 14, marginBottom: 14 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      paddingVertical: 7,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: color.divider,
    },
    rowName: { flex: 1, fontFamily: body[600], fontSize: 13.5, color: color.ink },
    rowNote: { fontFamily: body[400], fontSize: 12, color: color.mutedLight, maxWidth: 140 },

    cancel: { height: 50, alignItems: 'center', justifyContent: 'center' },
    cancelLabel: { fontFamily: body[700], fontSize: 15, color: color.dangerDeep },
  });

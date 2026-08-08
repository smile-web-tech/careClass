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
import { useEffect, useMemo, useState } from 'react';
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
  'cancelled',
  'rejected',
  'not_delivered',
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

  /**
   * Cancelling used to look like nothing happening, because the queue only
   * checked between messages and a stuck one held it for two minutes. It now
   * stops within a fraction of a second — but the label still has to change on
   * the press, or a teacher whose last message is mid-flight taps it twice.
   */
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    if (!visible || !running) setStopping(false);
  }, [visible, running]);

  const sent = results.filter((r) => r.state === 'sent').length;
  const failed = results.filter((r) => r.state === 'failed').length;
  const unknown = results.filter((r) => r.state === 'unknown').length;
  const delivered = results.filter((r) => r.delivery === 'delivered').length;
  const undelivered = results.filter((r) => r.delivery === 'undelivered').length;
  const stopped = running ? 0 : total - results.length;

  const reasonLabel = (reason?: string) =>
    t(
      (KNOWN_REASONS.has(reason ?? '')
        ? `sms.reason.${reason}`
        : 'sms.reason.unknown') as TranslationKey,
    );

  /**
   * What one row shows, given that a message has two outcomes and the second
   * one arrives late.
   *
   * `state` is what the phone did with it. `delivery` is what the network said
   * afterwards, and when it says anything it wins — a message the tower
   * accepted and then failed to deliver is a message the parent never read, and
   * that is the thing the teacher has to act on.
   */
  const rowLook = (r: SmsOutcome) => {
    if (r.delivery === 'undelivered') {
      return {
        icon: 'close' as const,
        tone: color.dangerDeep,
        note: reasonLabel(r.deliveryReason ?? 'not_delivered'),
      };
    }
    if (r.delivery === 'delivered') {
      return { icon: 'check' as const, tone: color.success, note: t('sms.delivered') };
    }
    if (r.state === 'sent') {
      return {
        icon: 'check' as const,
        tone: color.success,
        note: r.parts > 1 ? t('sms.segments', { count: r.parts }) : r.phone,
      };
    }
    if (r.state === 'unknown') {
      return {
        icon: 'warning' as const,
        tone: color.warningDeep,
        note: reasonLabel(r.reason),
      };
    }
    return { icon: 'close' as const, tone: color.dangerDeep, note: reasonLabel(r.reason) };
  };

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
              name={failed + undelivered + unknown > 0 ? 'warning' : 'check'}
              size={20}
              color={failed + undelivered + unknown > 0 ? color.warningDeep : color.success}
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
          {delivered > 0 ? (
            <Tally tone={color.success} label={t('sms.deliveredCount', { count: delivered })} />
          ) : null}
          {undelivered > 0 ? (
            <Tally
              tone={color.dangerDeep}
              label={t('sms.undeliveredCount', { count: undelivered })}
            />
          ) : null}
          {failed > 0 ? (
            <Tally tone={color.dangerDeep} label={t('sms.failedCount', { count: failed })} />
          ) : null}
          {unknown > 0 ? (
            <Tally tone={color.warningDeep} label={t('sms.unknownCount', { count: unknown })} />
          ) : null}
          {stopped > 0 ? (
            <Tally tone={color.muted} label={t('sms.stoppedCount', { count: stopped })} />
          ) : null}
        </View>

        {/*
          One line, and only the one that is worth acting on. A failed delivery
          outranks everything: it names a number the teacher has to check or a
          SIM that has run out, and it is the failure a plain "sent" would have
          hidden completely.
        */}
        {running ? (
          <Text style={styles.hint}>{t('sms.sendingHint')}</Text>
        ) : undelivered > 0 ? (
          <Text style={[styles.hint, styles.hintBad]}>{t('sms.undeliveredHint')}</Text>
        ) : unknown > 0 ? (
          <Text style={[styles.hint, styles.hintBad]}>{t('sms.unknownHint')}</Text>
        ) : sent > 0 && delivered < sent ? (
          <Text style={styles.hint}>{t('sms.deliveryHint')}</Text>
        ) : null}

        <ScrollView
          style={styles.list}
          contentContainerStyle={{ paddingBottom: 6 }}
          showsVerticalScrollIndicator={false}>
          {rows.map((r) => {
            const look = rowLook(r);
            return (
              <View key={r.key} style={styles.row}>
                <Icon name={look.icon} size={13} color={look.tone} />
                <Text style={styles.rowName} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text
                  style={[styles.rowNote, look.icon !== 'check' && { color: look.tone }]}
                  numberOfLines={1}>
                  {look.note}
                </Text>
              </View>
            );
          })}
        </ScrollView>

        {running ? (
          <Press
            onPress={() => {
              setStopping(true);
              onCancel();
            }}
            disabled={stopping}
            style={styles.cancel}>
            <Text style={[styles.cancelLabel, stopping && styles.cancelLabelOff]}>
              {stopping ? t('sms.stopping') : t('common.cancel')}
            </Text>
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
    hintBad: { color: color.dangerDeep },

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
    cancelLabelOff: { color: color.mutedLight },
  });

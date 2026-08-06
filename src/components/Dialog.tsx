/**
 * The app's own dialogs.
 *
 * `Alert.alert` hands the decision to the OS, which means a ClassCare confirm
 * looks like a system error on Android and like every other app on iOS —
 * different typography, different corner radius, different button order, and no
 * way to mark a destructive action as destructive on Android at all. For a
 * screen that asks "delete this group, and its whole attendance history?", that
 * is the one place the app should look most like itself.
 *
 * Imperative on purpose. A confirm is a question with an answer, so the call
 * site reads as one:
 *
 *     if (await confirm({ title: 'Sign out?', confirmLabel: 'Sign out' })) …
 *
 * That also lets code outside the React tree ask — `data/sync.ts` reporting a
 * write that would not land, `lib/contact.ts` when the phone has no mail app.
 */
import { useEffect, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { Press } from '@/components/ui';
import { translateNow, useT } from '@/i18n/useT';
import { describeError } from '@/lib/errors';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, display } from '@/theme/type';

export type DialogTone = 'info' | 'danger' | 'success';

export type DialogAction = {
  label: string;
  /** Returned from `showDialog` when chosen. Defaults to the label. */
  value?: string;
  /** `danger` paints it red, `primary` fills it, `quiet` is the cancel. */
  intent?: 'primary' | 'danger' | 'quiet';
};

export type DialogRequest = {
  title: string;
  message?: string;
  tone?: DialogTone;
  /** Defaults to a single "OK". */
  actions?: DialogAction[];
  /** Whether tapping the backdrop dismisses. Off for anything destructive. */
  dismissable?: boolean;
};

type Pending = { request: DialogRequest; resolve: (value: string | null) => void };

/* -------------------------------------------------------------------------- */
/* Imperative API                                                             */
/* -------------------------------------------------------------------------- */

let present: ((request: DialogRequest) => Promise<string | null>) | null = null;

/**
 * Show a dialog, resolving with the chosen action's `value` (or `null` if it
 * was dismissed).
 *
 * Resolves `null` when no host is mounted rather than throwing — a dialog is
 * never so important that failing to draw it should take down the operation
 * that wanted to explain itself.
 */
export function showDialog(request: DialogRequest): Promise<string | null> {
  return present ? present(request) : Promise.resolve(null);
}

/** A dialog with one dismiss button. The replacement for `Alert.alert(a, b)`. */
export function showAlert(title: string, message?: string, tone: DialogTone = 'info') {
  return showDialog({
    title,
    message,
    tone,
    actions: [{ label: translateNow('common.ok'), intent: 'primary' }],
  });
}

/**
 * Report a caught error in the teacher's language.
 *
 * Every `catch` that needs to say something out loud should come through here
 * rather than printing `e.message`, which is how "TypeError: Network request
 * failed" ends up on screen.
 */
export function showError(e: unknown, fallbackTitle?: string) {
  const described = describeError(e);
  return showAlert(
    fallbackTitle && described.kind === 'unknown' ? fallbackTitle : described.title,
    described.message,
    'danger',
  );
}

/** A yes/no question. Resolves true only if the confirming action was chosen. */
export async function confirm(opts: {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
}): Promise<boolean> {
  const chosen = await showDialog({
    title: opts.title,
    message: opts.message,
    tone: opts.tone ?? 'danger',
    dismissable: false,
    actions: [
      { label: opts.cancelLabel ?? translateNow('common.cancel'), value: 'cancel', intent: 'quiet' },
      {
        label: opts.confirmLabel ?? translateNow('common.ok'),
        value: 'confirm',
        intent: opts.tone === 'danger' || opts.tone === undefined ? 'danger' : 'primary',
      },
    ],
  });
  return chosen === 'confirm';
}

/* -------------------------------------------------------------------------- */
/* Host                                                                       */
/* -------------------------------------------------------------------------- */

const TONE_ICON: Record<DialogTone, IconName> = {
  info: 'info',
  danger: 'warning',
  success: 'check',
};

/** Mounted once, at the root. Everything above talks to this. */
export function DialogHost() {
  const { color, status, shadow, scheme } = useTheme();
  // `useT`, not `translateNow`: this one is resolved during render, so it has to
  // subscribe to the language rather than merely read it.
  const t = useT();
  const styles = useThemedStyles(makeStyles);

  // Heavier than the app's shared `color.scrim`, which is tuned for the time
  // picker sliding up over a form still meant to be readable. A dialog is a
  // stop: the screen behind it should recede, not compete.
  const scrim = scheme === 'dark' ? 'rgba(0,0,0,0.78)' : 'rgba(12,23,41,0.58)';

  /**
   * The whole queue is state, and the head of it is what shows.
   *
   * A ref would be the obvious place for a queue, but this project builds with
   * the React Compiler, which forbids reading a ref during render — and the
   * head of the queue is exactly that. Holding it in state keeps the render a
   * pure function of it.
   *
   * Queued rather than replaced: two failures arriving together should both get
   * said, in order, instead of the second silently overwriting the first.
   */
  const [queue, setQueue] = useState<Pending[]>([]);
  const [anim] = useState(() => new Animated.Value(0));
  const current: Pending | null = queue[0] ?? null;

  useEffect(() => {
    present = (request) =>
      new Promise<string | null>((resolve) => {
        setQueue((q) => [...q, { request, resolve }]);
      });
    return () => {
      present = null;
    };
  }, []);

  useEffect(() => {
    if (!current) return;
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 170,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [anim, current]);

  // One `Modal` renders whatever is at the head, so a queued dialog swaps the
  // contents rather than closing and reopening — which is what Android drops
  // when it happens in a single frame.
  const close = (value: string | null) => {
    current?.resolve(value);
    setQueue((q) => q.slice(1));
  };

  if (!current) return null;

  const { title, message, tone = 'info', dismissable = true } = current.request;
  const actions: DialogAction[] = current.request.actions?.length
    ? current.request.actions
    : [{ label: t('common.ok'), intent: 'primary' }];

  const toneSkin = {
    info: { tint: color.primaryTint, fg: color.primary },
    danger: { tint: status.absent.tint, fg: color.dangerDeep },
    success: { tint: status.present.tint, fg: color.successDeep },
  }[tone];

  // Two short buttons sit side by side; anything longer stacks, because a
  // truncated "Delete group" is how people tap the wrong one.
  const sideBySide =
    actions.length === 2 && actions.every((a) => a.label.length <= 12);

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      animationType="fade"
      onRequestClose={() => dismissable && close(null)}>
      {/*
        The backdrop is a plain View with a Pressable *behind* the card, not a
        Press wrapping it. `Press` dims its whole subtree when disabled, so
        wrapping the card in one and disabling it for a non-dismissable confirm
        rendered the entire dialog at 55% opacity — which is exactly what a
        "delete everything?" dialog must not look like.
      */}
      <View style={[styles.scrim, { backgroundColor: scrim }]}>
        {dismissable ? (
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityLabel="Dismiss"
            onPress={() => close(null)}
          />
        ) : null}
        <Animated.View
          style={[
            styles.card,
            shadow.raised,
            {
              backgroundColor: color.surface,
              borderColor: color.border,
              opacity: anim,
              transform: [
                { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
              ],
            },
          ]}>
          <View style={[styles.badge, { backgroundColor: toneSkin.tint }]}>
            <Icon name={TONE_ICON[tone]} size={20} color={toneSkin.fg} />
          </View>

          <Text style={[styles.title, { color: color.ink }]}>{title}</Text>
          {message ? (
            <Text style={[styles.message, { color: color.inkSoft }]}>{message}</Text>
          ) : null}

          <View style={[styles.actions, sideBySide ? styles.actionsRow : null]}>
            {actions.map((action) => {
              const intent = action.intent ?? 'primary';
              const skin =
                intent === 'danger'
                  ? { bg: color.danger, fg: '#fff', border: 'transparent' }
                  : intent === 'quiet'
                    ? { bg: color.fill, fg: color.inkSoft, border: color.border }
                    : { bg: color.primary, fg: '#fff', border: 'transparent' };

              return (
                <Press
                  key={action.label}
                  haptic
                  accessibilityRole="button"
                  onPress={() => close(action.value ?? action.label)}
                  style={[
                    styles.action,
                    sideBySide ? { flex: 1 } : null,
                    {
                      backgroundColor: skin.bg,
                      borderColor: skin.border,
                      borderWidth: intent === 'quiet' ? 1 : 0,
                    },
                  ]}>
                  <Text style={[styles.actionLabel, { color: skin.fg }]} numberOfLines={1}>
                    {action.label}
                  </Text>
                </Press>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (_theme: Theme) =>
  StyleSheet.create({
    scrim: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: space.gutter,
    },
    card: {
      width: '100%',
      maxWidth: 380,
      borderRadius: radius.sheet,
      borderWidth: 1,
      paddingHorizontal: 24,
      paddingTop: 26,
      paddingBottom: 20,
      alignItems: 'center',
    },
    badge: {
      width: 52,
      height: 52,
      borderRadius: radius.hero,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    title: {
      fontFamily: display[600],
      fontSize: 18.5,
      textAlign: 'center',
    },
    message: {
      fontFamily: body[400],
      fontSize: 14,
      lineHeight: 21,
      textAlign: 'center',
      marginTop: 9,
    },
    actions: { alignSelf: 'stretch', gap: 9, marginTop: 22 },
    actionsRow: { flexDirection: 'row' },
    action: {
      height: 48,
      borderRadius: radius.button,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 18,
    },
    actionLabel: { fontFamily: body[700], fontSize: 14.5 },
  });

import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirm } from '@/components/Dialog';
import { updateTeacher } from '@/data/api';
import { Icon } from '@/components/Icon';
import { Screen, useTabInset } from '@/components/layout';
import { SwipeToDelete } from '@/components/SwipeToDelete';
import { Avatar, Badge, Card, EmptyState, IconButton, Press } from '@/components/ui';
import { useGroups, useStore } from '@/data/store';
import { refreshInbox } from '@/data/sync';
import {
  notificationPermissionStatus,
  registerForPush,
  requestNotificationPermission,
} from '@/lib/notifications';
import { useT } from '@/i18n/useT';
import type { Message, Reply } from '@/data/types';
import { timeAgo } from '@/lib/date';
import { audienceKey, channelKey } from '@/lib/messageLabels';
import { replyContextLabel } from '@/lib/replyContext';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, text } from '@/theme/type';

export default function Messages() {
  const t = useT();
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const bottomInset = useTabInset(20);
  const router = useRouter();

  const messages = useStore((s) => s.messages);
  const replies = useStore((s) => s.replies);
  const removeMessage = useStore((s) => s.removeMessage);
  const removeReply = useStore((s) => s.removeReply);
  const removeMessages = useStore((s) => s.removeMessages);
  const removeReplies = useStore((s) => s.removeReplies);

  const [tab, setTab] = useState<'sent' | 'assignments' | 'replies'>('sent');
  const [refreshing, setRefreshing] = useState(false);

  /**
   * Notifications are only ever offered from Profile, next to class reminders,
   * and they are the same OS permission — so a teacher who never turns on
   * reminders is never asked, and silently never hears that a parent wrote
   * back. This asks where the value is obvious, and only while the answer is
   * still `undetermined`: granting or denying ends it for good, so it cannot
   * become a thing that nags.
   */
  const [askPush, setAskPush] = useState(false);

  useEffect(() => {
    let alive = true;
    void notificationPermissionStatus().then((status) => {
      if (alive) setAskPush(status === 'undetermined');
    });
    return () => {
      alive = false;
    };
  }, []);

  const enablePush = async () => {
    const ok = await requestNotificationPermission();
    setAskPush(false);
    if (ok) void registerForPush((pushToken) => updateTeacher({ pushToken }));
  };

  const unread = replies.filter((r) => r.unread).length;
  // Homework is looked for on its own — "what did I set last week" is a
  // different question from "what did I send", and an outbox mixing the two
  // answers neither.
  const sent = messages.filter((m) => !m.isAssignment);
  const assignments = messages.filter((m) => m.isAssignment);

  /**
   * Selection mode.
   *
   * Off by default and entered deliberately, because the alternative — rows
   * that are always selectable — turns every mis-tap while scrolling a term of
   * history into a tick the teacher has to notice and undo. A long press works
   * too, which is what people try first.
   */
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const leaveSelection = () => {
    setPicking(false);
    setChosen(new Set());
  };

  const toggleChosen = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const beginPicking = (id: string) => {
    setPicking(true);
    setChosen(new Set([id]));
  };

  /**
   * Back cancels the selection rather than leaving the screen.
   *
   * Selection mode is a mode, and backing out of a mode is what the gesture
   * means everywhere else on Android. Without this it navigated away with the
   * ticks still set, so returning to Messages showed rows mysteriously
   * selected — or worse, looked like the selection had been acted on.
   *
   * Scoped to focus so it does not swallow Back while a message detail or the
   * composer is on top of this tab.
   */
  useFocusEffect(
    useCallback(() => {
      if (!picking) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        setPicking(false);
        setChosen(new Set());
        return true; // Consumed: do not also pop the screen.
      });
      return () => sub.remove();
    }, [picking]),
  );

  /** Rows the selection applies to — whichever tab is showing. */
  const visible = tab === 'sent' ? sent : tab === 'assignments' ? assignments : replies;

  const deleteChosen = async () => {
    const ids = [...chosen];
    if (!ids.length) return;

    const yes = await confirm({
      title: t('messages.deleteSelectedTitle', { count: ids.length }),
      message:
        tab === 'replies' ? t('messages.deleteRepliesHint') : t('messages.deleteMessageHint'),
      confirmLabel: t('common.delete'),
    });
    if (!yes) return;

    if (tab === 'replies') removeReplies(ids);
    else removeMessages(ids);
    leaveSelection();
  };

  /**
   * Pull to refresh.
   *
   * Delivery receipts and replies both originate outside the app, and the
   * realtime channel is not carried by the PHP reverse proxy (see
   * `docs/reverse-proxy.md`) — so the fallback is a 30s poll that only runs
   * while this screen is foregrounded. A pull is the teacher saying "now".
   */
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshInbox();
    } catch {
      // Offline or the proxy is down. The list simply keeps what it had; an
      // alert here would fire every time the teacher pulls on a bad connection.
    } finally {
      setRefreshing(false);
    }
  }, []);

  return (
    <Screen>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <View style={styles.headerRow}>
          <Text style={[text.pageTitle, styles.ink]} numberOfLines={1}>
            {picking ? t('messages.selectedCount', { count: chosen.size }) : t('messages.title')}
          </Text>

          {picking ? (
            <View style={styles.headerActions}>
              <Press onPress={leaveSelection} hitSlop={8} style={styles.headerLink}>
                <Text style={styles.headerLinkLabel}>{t('common.cancel')}</Text>
              </Press>
              <IconButton
                name="close"
                iconSize={17}
                tint={chosen.size ? color.danger : color.fill}
                fg={chosen.size ? '#fff' : color.faint}
                onPress={() => void deleteChosen()}
              />
            </View>
          ) : (
            <View style={styles.headerActions}>
              {visible.length ? (
                <Press onPress={() => setPicking(true)} hitSlop={8} style={styles.headerLink}>
                  <Text style={styles.headerLinkLabel}>{t('messages.select')}</Text>
                </Press>
              ) : null}
              <IconButton
                name="plusLarge"
                iconSize={19}
                tint={color.primary}
                fg="#fff"
                onPress={() => router.push(tab === 'assignments' ? '/assignment' : '/compose')}
              />
            </View>
          )}
        </View>

        {/* Select-all sits under the title so it cannot be hit by accident. */}
        {picking ? (
          <View style={styles.selectBar}>
            <Press
              onPress={() =>
                setChosen(
                  chosen.size === visible.length ? new Set() : new Set(visible.map((x) => x.id)),
                )
              }
              hitSlop={8}>
              <Text style={styles.headerLinkLabel}>
                {chosen.size === visible.length
                  ? t('messages.clearSelection')
                  : t('messages.selectAll')}
              </Text>
            </Press>
          </View>
        ) : null}

        <View style={styles.tabRow}>
          <TabLink
            label={t('messages.sent')}
            active={tab === 'sent'}
            onPress={() => {
              leaveSelection();
              setTab('sent');
            }}
          />
          <TabLink
            label={t('assign.title')}
            active={tab === 'assignments'}
            onPress={() => {
              leaveSelection();
              setTab('assignments');
            }}
          />
          <TabLink
            label={unread ? `${t('messages.replies')} · ${unread}` : t('messages.replies')}
            active={tab === 'replies'}
            onPress={() => {
              leaveSelection();
              setTab('replies');
            }}
          />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingTop: 18,
          paddingBottom: bottomInset,
          gap: 10,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={color.muted}
            colors={[color.primary]}
            progressBackgroundColor={color.surface}
          />
        }
        showsVerticalScrollIndicator={false}>
        {/*
          A named button rather than relying on the `+` in the header. That
          header icon changes destination with the tab, which is invisible: two
          identical buttons, one of which quietly does something else. This one
          says what it does and is the first thing on the tab.
        */}
        {tab === 'assignments' ? (
          <Press onPress={() => router.push('/assignment')} style={styles.newAssignment}>
            <Icon name="plus" size={15} color={color.primary} />
            <Text style={styles.newAssignmentLabel}>{t('assign.new')}</Text>
          </Press>
        ) : null}

        {tab === 'sent' || tab === 'assignments' ? (
          (tab === 'sent' ? sent : assignments).length ? (
            (tab === 'sent' ? sent : assignments).map((m) =>
              picking ? (
                <Press key={m.id} onPress={() => toggleChosen(m.id)} style={styles.pickRow}>
                  <Tick on={chosen.has(m.id)} />
                  <View style={{ flex: 1 }}>
                    <SentCard message={m} />
                  </View>
                </Press>
              ) : (
                <SwipeToDelete
                  key={m.id}
                  title={t('messages.deleteMessageTitle')}
                  message={t('messages.deleteMessageHint')}
                  onDelete={() => removeMessage(m.id)}>
                  <Press
                    onPress={() => router.push(`/message/${m.id}?kind=sent`)}
                    onLongPress={() => beginPicking(m.id)}>
                    <SentCard message={m} />
                  </Press>
                </SwipeToDelete>
              ),
            )
          ) : (
            <EmptyState
              title={tab === 'assignments' ? t('assign.title') : t('messages.nothingSent')}
              hint={tab === 'assignments' ? t('assign.studentsOnly') : t('messages.outboxHint')}
            />
          )
        ) : (
          <>
            {askPush ? (
              <Card style={styles.notify}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.notifyTitle}>{t('messages.notifyTitle')}</Text>
                  <Text style={styles.notifyBody}>{t('messages.notifyBody')}</Text>
                </View>
                <Press onPress={() => void enablePush()} hitSlop={8} style={styles.notifyAction}>
                  <Text style={styles.notifyActionLabel}>{t('messages.notifyEnable')}</Text>
                </Press>
              </Card>
            ) : null}
            {replies.length ? (
              replies.map((r) =>
                picking ? (
                  <Press key={r.id} onPress={() => toggleChosen(r.id)} style={styles.pickRow}>
                    <Tick on={chosen.has(r.id)} />
                    <View style={{ flex: 1 }}>
                      <ReplyCard reply={r} />
                    </View>
                  </Press>
                ) : (
                  <SwipeToDelete
                    key={r.id}
                    title={t('messages.deleteReplyTitle', { name: r.authorName })}
                    message={t('messages.deleteRepliesHint')}
                    onDelete={() => removeReply(r.id)}>
                    <Press
                      onPress={() => router.push(`/message/${r.id}?kind=reply`)}
                      onLongPress={() => beginPicking(r.id)}>
                      <ReplyCard reply={r} />
                    </Press>
                  </SwipeToDelete>
                ),
              )
            ) : (
              <EmptyState title={t('messages.noReplies')} hint={t('messages.repliesHint')} />
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

/** Selection tick. Empty ring until chosen, so the state is readable at a glance. */
function Tick({ on }: { on: boolean }) {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.tick, on && styles.tickOn]}>
      {on ? <Icon name="check" size={13} color="#fff" /> : null}
    </View>
  );
}

function TabLink({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Press
      onPress={onPress}
      style={[styles.tab, { borderBottomColor: active ? color.primary : 'transparent' }]}>
      <Text
        style={{
          fontFamily: active ? body[700] : body[600],
          fontSize: 14.5,
          color: active ? color.ink : color.mutedLight,
        }}>
        {label}
      </Text>
    </Press>
  );
}

function SentCard({ message }: { message: Message }) {
  const t = useT();
  const { accents, color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const groups = useGroups();
  const targets = groups.filter((g) => message.groupIds.includes(g.id));
  const partial = message.delivered < message.total;

  return (
    <Card style={styles.sentCard}>
      <View style={styles.sentHead}>
        {message.announcement || targets.length === 0 ? (
          <Badge
            label={t('messages.announcement')}
            icon="megaphone"
            bg={accents.amber.tint}
            fg={color.warningDeep}
          />
        ) : (
          targets.map((g) => (
            <Badge
              key={g.id}
              label={g.name}
              dot={accents[g.accent].dot}
              bg={accents[g.accent].tint}
              fg={accents[g.accent].inkDeep}
            />
          ))
        )}
        <Badge
          label={
            message.announcement || targets.length === 0
              ? `${t('messages.allGroups')} · ${t(audienceKey(message.audience))}`
              : t(audienceKey(message.audience))
          }
          bg={color.bg}
          fg={color.muted}
          textStyle={styles.audienceText}
        />
        <Text style={styles.sentTime}>{timeAgo(message.sentAt)}</Text>
      </View>

      <Text style={styles.sentBody}>{message.body}</Text>

      <View style={styles.sentFoot}>
        <View style={styles.deliveryRow}>
          <Icon
            name={partial ? 'warning' : 'check'}
            size={14}
            color={partial ? color.warningDeep : color.successDeep}
          />
          <Text
            style={[
              styles.deliveryLabel,
              { color: partial ? color.warningDeep : color.successDeep },
            ]}>
            {partial
              ? t('messages.deliveredOf', { delivered: message.delivered, total: message.total })
              : t('messages.deliveredAll', { total: message.total })}
          </Text>
        </View>
        <Text style={styles.channels}>
          {message.channels.map((c) => t(channelKey(c))).join(' + ')}
        </Text>
      </View>
    </Card>
  );
}

function ReplyCard({ reply }: { reply: Reply }) {
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  return (
    <Card style={[styles.replyCard, !reply.unread && { opacity: 0.75 }]}>
      <Avatar name={reply.authorName} accent={reply.accent} size={42} radius={radius.button} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.replyHead}>
          <Text style={styles.replyName}>{reply.authorName}</Text>
          <Text style={styles.replyContext}>{replyContextLabel(reply.context, t)}</Text>
          {reply.unread ? <View style={styles.unreadDot} /> : null}
        </View>
        <Text style={styles.replyBody}>{reply.body}</Text>
        <Text style={styles.replyTime}>{timeAgo(reply.at)}</Text>
      </View>
    </Card>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    notify: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
    notifyTitle: { fontFamily: body[700], fontSize: 14, color: color.ink },
    notifyBody: {
      fontFamily: body[400],
      fontSize: 12.5,
      lineHeight: 18,
      color: color.muted,
      marginTop: 3,
    },
    notifyAction: {
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: radius.control,
      backgroundColor: color.primaryTint,
    },
    notifyActionLabel: { fontFamily: body[700], fontSize: 13.5, color: color.primaryInk },

    headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    headerLink: { paddingHorizontal: 8, paddingVertical: 6 },
    headerLinkLabel: { fontFamily: body[700], fontSize: 14, color: color.primary },
    selectBar: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 2 },
    pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    tick: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: color.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tickOn: { backgroundColor: color.primary, borderColor: color.primary },

    newAssignment: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      height: 50,
      borderRadius: radius.button,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: color.dashed,
      marginBottom: 4,
    },
    newAssignmentLabel: { fontFamily: body[700], fontSize: 14, color: color.primary },

    /** Default body ink. Text does not inherit colour from a parent View. */
    ink: { color: color.ink },
    header: {
      backgroundColor: color.surface,
      borderBottomWidth: 1,
      borderBottomColor: color.border,
      paddingHorizontal: space.gutter,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingBottom: 14,
    },
    tabRow: { flexDirection: 'row', gap: 22 },
    tab: { paddingBottom: 12, borderBottomWidth: 2.5 },

    sentCard: { paddingHorizontal: 16, paddingVertical: 15 },
    sentHead: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 9,
    },
    audienceText: { fontFamily: body[600] },
    sentTime: {
      marginLeft: 'auto',
      fontFamily: body[400],
      fontSize: 11.5,
      color: color.faint,
    },
    sentBody: {
      fontFamily: body[400],
      fontSize: 14.5,
      lineHeight: 22.5,
      color: color.ink,
      marginTop: 11,
    },
    sentFoot: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      marginTop: 12,
      paddingTop: 11,
      borderTopWidth: 1,
      borderTopColor: color.divider,
    },
    deliveryRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    deliveryLabel: { fontFamily: body[600], fontSize: 12 },
    channels: { fontFamily: body[600], fontSize: 12, color: color.mutedLight },

    replyCard: {
      flexDirection: 'row',
      gap: 12,
      paddingHorizontal: 15,
      paddingVertical: 14,
    },
    replyHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    replyName: { fontFamily: body[700], fontSize: 14.5, color: color.ink },
    replyContext: {
      flex: 1,
      fontFamily: body[600],
      fontSize: 11,
      color: color.mutedLight,
    },
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: color.primary,
    },
    replyBody: {
      fontFamily: body[400],
      fontSize: 13.5,
      lineHeight: 20.25,
      color: color.inkSoft,
      marginTop: 5,
    },
    replyTime: {
      fontFamily: body[400],
      fontSize: 11.5,
      color: color.faint,
      marginTop: 7,
    },
  });

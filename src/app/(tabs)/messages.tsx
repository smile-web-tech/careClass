import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Screen, useTabInset } from '@/components/layout';
import { Avatar, Badge, Card, EmptyState, IconButton, Press } from '@/components/ui';
import { useGroups, useStore } from '@/data/store';
import { refreshInbox } from '@/data/sync';
import type { Message, Reply } from '@/data/types';
import { timeAgo } from '@/lib/date';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, text } from '@/theme/type';

const AUDIENCE_LABEL = {
  students: 'Students',
  parents: 'Parents',
  both: 'Students + parents',
} as const;

const CHANNEL_LABEL = { sms: 'SMS', email: 'Email', push: 'Push' } as const;

export default function Messages() {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const bottomInset = useTabInset(20);
  const router = useRouter();

  const messages = useStore((s) => s.messages);
  const replies = useStore((s) => s.replies);
  const markRepliesRead = useStore((s) => s.markRepliesRead);

  const [tab, setTab] = useState<'sent' | 'replies'>('sent');
  const [refreshing, setRefreshing] = useState(false);
  const unread = replies.filter((r) => r.unread).length;

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

  // Opening the tab is the read receipt — matches how the badge behaves
  // everywhere else in the app.
  useEffect(() => {
    if (tab === 'replies' && unread > 0) {
      const t = setTimeout(markRepliesRead, 900);
      return () => clearTimeout(t);
    }
  }, [markRepliesRead, tab, unread]);

  return (
    <Screen>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <View style={styles.headerRow}>
          <Text style={[text.pageTitle, styles.ink]}>Messages</Text>
          <IconButton
            name="plusLarge"
            iconSize={19}
            tint={color.primary}
            fg="#fff"
            onPress={() => router.push('/compose')}
          />
        </View>

        <View style={styles.tabRow}>
          <TabLink label="Sent" active={tab === 'sent'} onPress={() => setTab('sent')} />
          <TabLink
            label={unread ? `Replies · ${unread}` : 'Replies'}
            active={tab === 'replies'}
            onPress={() => setTab('replies')}
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
        {tab === 'sent' ? (
          messages.length ? (
            messages.map((m) => <SentCard key={m.id} message={m} />)
          ) : (
            <EmptyState title="Nothing sent yet" hint="Your outbox will show up here" />
          )
        ) : replies.length ? (
          replies.map((r) => <ReplyCard key={r.id} reply={r} />)
        ) : (
          <EmptyState title="No replies" hint="Answers land here as they arrive" />
        )}
      </ScrollView>
    </Screen>
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
            label="Announcement"
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
              ? `All groups · ${AUDIENCE_LABEL[message.audience]}`
              : AUDIENCE_LABEL[message.audience]
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
              ? `${message.delivered} of ${message.total} delivered`
              : `Delivered ${message.delivered}/${message.total}`}
          </Text>
        </View>
        <Text style={styles.channels}>
          {message.channels.map((c) => CHANNEL_LABEL[c]).join(' + ')}
        </Text>
      </View>
    </Card>
  );
}

function ReplyCard({ reply }: { reply: Reply }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Card style={[styles.replyCard, !reply.unread && { opacity: 0.75 }]}>
      <Avatar name={reply.authorName} accent={reply.accent} size={42} radius={radius.button} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.replyHead}>
          <Text style={styles.replyName}>{reply.authorName}</Text>
          <Text style={styles.replyContext}>{reply.context}</Text>
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

/**
 * The full text of one message — a reply received, or one the teacher sent.
 *
 * A screen rather than a dialog. Message bodies run long, a dialog that scrolls
 * is a dialog that should have been a screen, and a real route means the reply
 * can be opened from a notification later without inventing a second path to
 * the same content.
 *
 * Opening a reply is what marks it read. The tab used to mark everything read
 * on sight, which quietly destroyed the only record of what the teacher still
 * owed an answer to.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirm } from '@/components/Dialog';
import { Icon } from '@/components/Icon';
import { Screen, TopBar } from '@/components/layout';
import { Avatar, Badge, Button, Card, Divider, Overline, Txt } from '@/components/ui';
import { useGroups, useStore } from '@/data/store';
import { longDateTime } from '@/lib/date';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, text } from '@/theme/type';

const AUDIENCE_LABEL = {
  students: 'Students',
  parents: 'Parents',
  both: 'Students + parents',
} as const;

const CHANNEL_LABEL = { sms: 'SMS', email: 'Email', push: 'Push' } as const;

export default function MessageDetail() {
  const { id, kind } = useLocalSearchParams<{ id: string; kind?: 'sent' | 'reply' }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { accents, color } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const groups = useGroups();
  const message = useStore((s) => s.messages.find((m) => m.id === id));
  const reply = useStore((s) => s.replies.find((r) => r.id === id));
  const markReplyRead = useStore((s) => s.markReplyRead);
  const removeMessage = useStore((s) => s.removeMessage);
  const removeReply = useStore((s) => s.removeReply);

  // Reading it is the receipt. The store no-ops when it is already read, so
  // this cannot loop.
  useEffect(() => {
    if (reply?.unread) markReplyRead(reply.id);
  }, [markReplyRead, reply?.id, reply?.unread, reply]);

  const remove = async (what: string, run: () => void) => {
    const yes = await confirm({
      title: `Delete ${what}?`,
      message: 'This removes it from your history. It cannot be undone.',
      confirmLabel: 'Delete',
    });
    if (!yes) return;
    run();
    router.back();
  };

  if (!message && !reply) {
    return (
      <Screen>
        <TopBar title="Message" dismiss />
        <View style={styles.missing}>
          <Txt>That message is no longer in your history.</Txt>
          <Button label="Go back" variant="ghost" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  /* ---------------------------------------------------------------- Reply */

  if (reply && kind !== 'sent') {
    return (
      <Screen>
        <TopBar title="Reply" dismiss />
        <ScrollView
          contentContainerStyle={{ padding: space.gutter, paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}>
          <View style={styles.author}>
            <Avatar name={reply.authorName} accent={reply.accent} size={52} radius={radius.tile} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.authorName}>{reply.authorName}</Text>
              {reply.context ? <Text style={styles.authorContext}>{reply.context}</Text> : null}
              <Text style={styles.when}>{longDateTime(reply.at)}</Text>
            </View>
          </View>

          <Card style={styles.bodyCard}>
            <Text style={styles.bodyText} selectable>
              {reply.body}
            </Text>
          </Card>

          <Button
            label="Delete this reply"
            variant="outline"
            height={48}
            style={{ marginTop: 18 }}
            onPress={() => remove("this reply", () => removeReply(reply.id))}
          />
        </ScrollView>
      </Screen>
    );
  }

  /* ----------------------------------------------------------------- Sent */

  if (!message) return null;

  const targets = groups.filter((g) => message.groupIds.includes(g.id));
  const partial = message.delivered < message.total;

  return (
    <Screen>
      <TopBar title="Sent message" dismiss />
      <ScrollView
        contentContainerStyle={{ padding: space.gutter, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}>
        <View style={styles.badgeRow}>
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
          <Badge label={AUDIENCE_LABEL[message.audience]} bg={color.bg} fg={color.muted} />
        </View>

        <Text style={styles.when}>{longDateTime(message.sentAt)}</Text>

        <Card style={styles.bodyCard}>
          <Text style={styles.bodyText} selectable>
            {message.body}
          </Text>
        </Card>

        <Overline style={styles.label}>Delivery</Overline>
        <Card style={{ overflow: 'hidden' }}>
          <View style={styles.row}>
            <View
              style={[
                styles.rowIcon,
                { backgroundColor: partial ? accents.amber.tint : color.primaryTint },
              ]}>
              <Icon
                name={partial ? 'warning' : 'check'}
                size={15}
                color={partial ? color.warningDeep : color.successDeep}
              />
            </View>
            <Text style={styles.rowLabel}>
              {message.delivered} of {message.total} delivered
            </Text>
          </View>
          <Divider inset={62} />
          <View style={styles.row}>
            <View style={[styles.rowIcon, { backgroundColor: color.fill }]}>
              <Icon name="send" size={15} color={color.inkSoft} />
            </View>
            <Text style={styles.rowLabel}>
              {message.channels.map((c) => CHANNEL_LABEL[c]).join(' + ') || 'No channel'}
            </Text>
          </View>
        </Card>

        <Button
          label="Delete from history"
          variant="outline"
          height={48}
          style={{ marginTop: 18 }}
          onPress={() => remove('this message', () => removeMessage(message.id))}
        />
        <Text style={styles.footnote}>
          Deleting only clears your own record. Messages already sent cannot be recalled.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    missing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },

    author: { flexDirection: 'row', gap: 14, alignItems: 'center', marginBottom: 18 },
    authorName: { ...text.pageTitle, fontSize: 20, lineHeight: 26, color: color.ink },
    authorContext: {
      fontFamily: body[600],
      fontSize: 12.5,
      color: color.mutedLight,
      marginTop: 2,
    },

    badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
    when: { fontFamily: body[400], fontSize: 12.5, color: color.faint, marginTop: 3 },

    bodyCard: { paddingHorizontal: 18, paddingVertical: 17, marginTop: 14 },
    bodyText: {
      fontFamily: body[400],
      fontSize: 15.5,
      lineHeight: 24,
      color: color.ink,
    },

    label: { marginTop: 24, marginBottom: 10 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 15, paddingVertical: 13 },
    rowIcon: {
      width: 34,
      height: 34,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowLabel: { flex: 1, fontFamily: body[600], fontSize: 14, color: color.ink },

    footnote: {
      fontFamily: body[400],
      fontSize: 12,
      lineHeight: 17,
      color: color.mutedLight,
      textAlign: 'center',
      marginTop: 10,
    },
  });

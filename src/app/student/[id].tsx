import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AttachmentPreview, type PreviewFile } from '@/components/AttachmentPreview';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/layout';
import {
  Avatar,
  Button,
  Card,
  Divider,
  IconButton,
  Overline,
  Press,
  StatTile,
  Txt,
} from '@/components/ui';
import { useGroups, useRecentSessions, useStudent, useStudentStats } from '@/data/store';
import { hydrate, useStudentPhotoUploading } from '@/data/sync';
import type { Student } from '@/data/types';
import { useT } from '@/i18n/useT';
import { callNumber, emailAddress, smsNumber } from '@/lib/contact';
import { fromKey, longDate, shortDate } from '@/lib/date';
import { photoFile, useStudentPhoto } from '@/lib/studentPhoto';
import { STATUS_KEY } from '@/app/attendance';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, text } from '@/theme/type';

export default function StudentProfile() {
  const t = useT();
  const { accents, color, status } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const student = useStudent(id);
  const groups = useGroups();

  const stats = useStudentStats(student);
  const recent = useRecentSessions(student, 3);

  /** The picture, opened full size. Null while it is closed. */
  const [viewing, setViewing] = useState<PreviewFile | null>(null);

  /*
    Above the early return, because it is a hook.

    Subscribed rather than read once, so taking a new picture on this screen
    makes the header tappable straight away — before this, `face` was captured
    at render and a student who had just been given their first photo still had
    a dead tap target until the screen was left and come back to.
  */
  const photo = useStudentPhoto(id);

  /** True while the picture is queued for the server or on its way there. */
  const uploading = useStudentPhotoUploading(id);

  /*
    Pull down to fetch this student again, picture included.

    The screen where "is my photo actually saved?" gets asked is the screen that
    should be able to answer it. `hydrate` re-reads the account and downloads
    any face this device does not have.
  */
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await hydrate();
    } catch {
      // Offline. What is on screen is still the best copy this device has.
    } finally {
      setRefreshing(false);
    }
  }, []);

  if (!student) {
    return (
      <Screen>
        <View style={styles.missing}>
          <Txt>{t('students.gone')}</Txt>
          <Button label={t('common.goBack')} variant="ghost" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  const memberOf = groups.filter((g) => student.groupIds.includes(g.id));

  /*
    The picture is read off the disk here, not passed down from the list. This
    screen used to draw initials and nothing else, so a student with a photo had
    a face in the register and a pair of letters on their own profile — which
    looks like the photo failed to save.
  */
  const face = photo?.uri ?? null;

  const openPhoto = () => {
    if (!face) return;
    let size = 0;
    try {
      size = photoFile(student.id).size ?? 0;
    } catch {
      // The viewer shows the size as a caption; not knowing it is not a reason
      // to refuse to open the picture.
    }
    setViewing({
      filename: student.name,
      mimeType: 'image/jpeg',
      size,
      uri: face,
    });
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
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
        <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
          <View style={styles.headerBar}>
            <IconButton name="chevronLeft" onPress={() => router.back()} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <IconButton
                name="pencil"
                iconSize={17}
                fg={color.inkSoft}
                onPress={() => router.push(`/student/edit?id=${student.id}`)}
              />
              <IconButton name="more" iconSize={17} fg={color.inkSoft} />
            </View>
          </View>

          <View style={styles.identity}>
            <Press
              onPress={openPhoto}
              disabled={!face}
              accessibilityLabel={face ? t('student.viewPhoto') : undefined}>
              <Avatar
                name={student.name}
                accent={student.accent}
                photoId={student.id}
                size={76}
                radius={radius.sheet}
                fontSize={27}
              />
              {/*
                Over the face, not beside it.

                This is the screen a teacher lands on straight after saving, so
                it is where "has the picture actually gone up?" gets asked. A
                spinner sitting on the corner of the avatar answers it without
                taking any room, and it clears itself the moment the upload
                finishes — including much later, when the phone finds a signal.
              */}
              {uploading ? (
                <View style={styles.photoBusy}>
                  <ActivityIndicator size="small" color="#ffffff" />
                </View>
              ) : null}
            </Press>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.name}>{student.name}</Text>
              <View style={styles.tagRow}>
                {memberOf.map((g) => {
                  const ga = accents[g.accent];
                  return (
                    <Press
                      key={g.id}
                      onPress={() => router.push(`/group/${g.id}`)}
                      style={[styles.tag, { backgroundColor: ga.tint }]}>
                      <Text style={[styles.tagLabel, { color: ga.inkDeep }]}>{g.name}</Text>
                    </Press>
                  );
                })}
              </View>
            </View>
          </View>

          <View style={styles.actionRow}>
            <Button
              grow
              variant="success"
              icon="phone"
              label={t('students.call')}
              onPress={() => callNumber(student.phone)}
            />
            <Button
              grow
              icon="chat"
              label={t('students.message')}
              onPress={() => smsNumber(student.phone)}
            />
            <Press
              onPress={() => student.email && emailAddress(student.email)}
              disabled={!student.email}
              style={styles.mailButton}>
              <Icon name="mail" size={17} color={color.inkSoft} />
            </Press>
          </View>
        </View>

        <View style={styles.statRow}>
          <StatTile
            value={stats.rate != null ? `${stats.rate}%` : '·'}
            label={t('home.attendance')}
            tone={stats.rate != null ? color.success : color.mutedLight}
            fontSize={21}
          />
          {/* Percent, matching the group screen. Raw marks cannot be compared
              across a quiz out of 20 and a final out of 100. */}
          <StatTile
            value={stats.average != null ? `${stats.average}%` : '·'}
            label={t('students.avgScore')}
            tone={stats.average != null ? color.primary : color.mutedLight}
            fontSize={21}
          />
          <StatTile value={String(stats.sessions)} label={t('students.sessions')} fontSize={21} />
        </View>

        <View style={styles.block}>
          <Overline style={{ marginBottom: 10 }}>{t('students.contact')}</Overline>
          <Card style={{ overflow: 'hidden' }}>
            <ContactRow
              icon="phone"
              tint={status.present.tint}
              fg={color.success}
              label={t('nav.students')}
              value={student.phone}
              tabular
              onPress={() => callNumber(student.phone)}
            />
            {student.email ? (
              <>
                <Divider inset={64} />
                <ContactRow
                  icon="mail"
                  tint={color.bg}
                  fg={color.inkSoft}
                  label={t('students.email')}
                  value={student.email}
                  onPress={() => emailAddress(student.email!)}
                />
              </>
            ) : null}
            {/*
              Both guardians, each with whatever we hold. The label carries the
              parent's own name where there is one: "Parent · Merjen" tells the
              teacher who is about to answer, which "Parent" does not.
            */}
            {[
              {
                name: student.parentName,
                phone: student.parentPhone,
                email: student.parentEmail,
                accent: accents.violet,
              },
              {
                name: student.parent2Name,
                phone: student.parent2Phone,
                email: student.parent2Email,
                accent: accents.teal,
              },
            ].flatMap((parent, index) => {
              const label = parent.name
                ? `${t(index === 0 ? 'student.mother' : 'student.father')} · ${parent.name}`
                : t(index === 0 ? 'student.mother' : 'student.father');

              return [
                parent.phone ? (
                  <View key={`p${index}-phone`}>
                    <Divider inset={64} />
                    <ContactRow
                      icon="person"
                      tint={parent.accent.tint}
                      fg={parent.accent.ink}
                      label={label}
                      value={parent.phone}
                      tabular
                      onPress={() => callNumber(parent.phone!)}
                    />
                  </View>
                ) : null,
                parent.email ? (
                  <View key={`p${index}-email`}>
                    <Divider inset={64} />
                    <ContactRow
                      icon="mail"
                      tint={parent.accent.tint}
                      fg={parent.accent.ink}
                      label={`${label} · ${t('students.email')}`}
                      value={parent.email}
                      onPress={() => emailAddress(parent.email!)}
                    />
                  </View>
                ) : null,
              ];
            })}
          </Card>
        </View>

        <StudentDetails student={student} />

        <View style={styles.block}>
          <View style={styles.blockHead}>
            <Overline>{t('students.recentSessions')}</Overline>
            <Press onPress={() => router.push('/(tabs)/calendar')}>
              <Text style={styles.seeAll}>{t('common.seeAll')}</Text>
            </Press>
          </View>
          <Card style={styles.sessionCard}>
            {recent.length === 0 ? (
              <Txt style={styles.noSessions}>{t('students.noSessions')}</Txt>
            ) : (
              recent.map((r, i) => {
                const s = status[r.mark];
                return (
                  <View key={r.key}>
                    {i > 0 ? <Divider /> : null}
                    <View style={styles.sessionRow}>
                      <View style={[styles.sessionDot, { backgroundColor: s.dot }]} />
                      <Text style={styles.sessionLabel}>
                        {shortDate(r.date)} · {r.group.name}
                      </Text>
                      <Text style={[styles.sessionStatus, { color: s.ink }]}>
                        {t(STATUS_KEY[r.mark])}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </Card>
        </View>

        {student.note ? (
          <View style={styles.block}>
            <Overline style={{ marginBottom: 10 }}>{t('students.note')}</Overline>
            <Card style={styles.noteCard}>
              <Text style={styles.noteText}>{student.note}</Text>
            </Card>
          </View>
        ) : null}
      </ScrollView>

      <AttachmentPreview file={viewing} onClose={() => setViewing(null)} />
    </Screen>
  );
}

/**
 * The facts that are not a way of contacting anybody.
 *
 * Rendered only where there is something to show: a card of five empty rows
 * tells a teacher nothing and makes the screen look like a form they have
 * failed to fill in.
 */
function StudentDetails({ student }: { student: Student }) {
  const t = useT();
  const styles = useThemedStyles(makeStyles);

  const rows: { label: string; value: string }[] = [];

  if (student.birthDate) {
    const born = fromKey(student.birthDate);
    rows.push({
      label: t('student.birthDate'),
      value: `${longDate(born)} · ${t('student.age', { age: yearsSince(born) })}`,
    });
  }
  if (student.school) rows.push({ label: t('student.school'), value: student.school });
  if (student.address) rows.push({ label: t('student.address'), value: student.address });
  if (student.documentId) {
    rows.push({ label: t('student.documentId'), value: student.documentId });
  }
  if (student.parentWork) {
    rows.push({
      label: `${t('student.mother')} · ${t('student.work')}`,
      value: student.parentWork,
    });
  }
  if (student.parent2Work) {
    rows.push({
      label: `${t('student.father')} · ${t('student.work')}`,
      value: student.parent2Work,
    });
  }

  if (!rows.length) return null;

  return (
    <View style={styles.block}>
      <Overline style={{ marginBottom: 10 }}>{t('student.details')}</Overline>
      <Card style={{ overflow: 'hidden' }}>
        {rows.map((row, i) => (
          <View key={row.label}>
            {i > 0 ? <Divider inset={15} /> : null}
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{row.label}</Text>
              <Text style={styles.detailValue} numberOfLines={2}>
                {row.value}
              </Text>
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}

/** Whole years, not counting a birthday that has not happened yet this year. */
function yearsSince(born: Date): number {
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const before =
    now.getMonth() < born.getMonth() ||
    (now.getMonth() === born.getMonth() && now.getDate() < born.getDate());
  if (before) age -= 1;
  return Math.max(0, age);
}

function ContactRow({
  icon,
  tint,
  fg,
  label,
  value,
  tabular,
  onPress,
}: {
  icon: 'phone' | 'mail' | 'person';
  tint: string;
  fg: string;
  label: string;
  value: string;
  tabular?: boolean;
  onPress: () => void;
}) {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Press onPress={onPress} style={styles.contactRow}>
      <View style={[styles.contactIcon, { backgroundColor: tint }]}>
        <Icon name={icon} size={16} color={fg} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.contactLabel}>{label}</Text>
        <Text style={[styles.contactValue, tabular ? text.tabular : null]} numberOfLines={1}>
          {value}
        </Text>
      </View>
      <Icon name="disclosure" size={16} color={color.chevron} />
    </Press>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    missing: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
    },

    header: {
      backgroundColor: color.surface,
      borderBottomWidth: 1,
      borderBottomColor: color.border,
      paddingHorizontal: space.gutter,
      paddingBottom: 20,
    },
    headerBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    identity: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
      marginTop: 20,
    },
    // Covers the avatar rather than sitting next to it, so the row does not
    // change width when an upload starts and stops.
    photoBusy: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      borderRadius: radius.sheet,
      backgroundColor: 'rgba(0,0,0,0.42)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    name: { ...text.pageTitle, lineHeight: 27.6, color: color.ink },
    tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 9 },
    tag: {
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: radius.sm + 1,
    },
    tagLabel: { fontFamily: body[600], fontSize: 11.5 },

    actionRow: { flexDirection: 'row', gap: 9, marginTop: 18 },
    mailButton: {
      width: 48,
      height: 48,
      borderRadius: radius.button,
      backgroundColor: color.fill,
      borderWidth: 1,
      borderColor: color.border,
      alignItems: 'center',
      justifyContent: 'center',
    },

    statRow: {
      flexDirection: 'row',
      gap: 10,
      paddingHorizontal: space.gutter,
      paddingTop: 16,
    },

    block: { paddingHorizontal: space.gutter, paddingTop: 20 },
    blockHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    detailRow: { paddingHorizontal: 15, paddingVertical: 13, gap: 3 },
    detailLabel: { fontFamily: body[600], fontSize: 12, color: color.mutedLight },
    detailValue: { fontFamily: body[500], fontSize: 14.5, color: color.ink, lineHeight: 20 },

    seeAll: { fontFamily: body[700], fontSize: 12.5, color: color.primary },

    contactRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 13,
      paddingHorizontal: 15,
      paddingVertical: 13,
    },
    contactIcon: {
      width: 36,
      height: 36,
      borderRadius: radius.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    contactLabel: {
      fontFamily: body[700],
      fontSize: 10.5,
      letterSpacing: 0.84,
      textTransform: 'uppercase',
      color: color.mutedLight,
    },
    contactValue: {
      fontFamily: body[600],
      fontSize: 14.5,
      color: color.ink,
      marginTop: 2,
    },

    sessionCard: { paddingHorizontal: 15, paddingVertical: 6 },
    sessionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 11,
    },
    sessionDot: { width: 9, height: 9, borderRadius: 4.5 },
    sessionLabel: {
      flex: 1,
      fontFamily: body[600],
      fontSize: 14,
      color: color.ink,
    },
    sessionStatus: { fontFamily: body[700], fontSize: 13 },
    noSessions: {
      fontSize: 13.5,
      color: color.mutedLight,
      paddingVertical: 10,
    },

    noteCard: { paddingHorizontal: 15, paddingVertical: 14 },
    noteText: {
      fontFamily: body[400],
      fontSize: 14,
      lineHeight: 21.7,
      color: color.inkSoft,
    },
  });

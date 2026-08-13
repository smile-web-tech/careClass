/**
 * Grades for one group.
 *
 * The question a teacher actually has is "who in this class is struggling",
 * not "what did Amir get on the Unit 3 quiz" — so the default view is the
 * roster ranked by average, with a standing on each row. Individual marks are
 * one tap further in.
 *
 * Averages are percentages, never raw marks. A quiz out of 20 and a final out
 * of 100 cannot be averaged as numbers without silently weighting the final
 * five times heavier, which would quietly mislabel students.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirm, showAlert, showDialog, showError } from '@/components/Dialog';
import { Icon } from '@/components/Icon';
import { Screen, TopBar } from '@/components/layout';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  Overline,
  Press,
  SelectChip,
  StatTile,
} from '@/components/ui';
import { markGradesNotified, sendGrades } from '@/data/api';
import { refreshGrades } from '@/data/sync';
import {
  averagePercent,
  standingOf,
  useGroups,
  useStore,
  useStudents,
  type GradeStanding,
} from '@/data/store';
import type { Assessment, Audience } from '@/data/types';
import { useT } from '@/i18n/useT';
import type { TranslationKey } from '@/i18n';
import { shortDate, fromKey } from '@/lib/date';
import { assessmentKindLabel } from '@/lib/assessmentKind';
import { describeError } from '@/lib/errors';
import { normalisePhone } from '@/lib/phone';
import {
  deviceSmsSupported,
  hasSmsPermission,
  newSmsBatchId,
  requestSmsPermission,
  sendSmsBatch,
  type SmsOutcome,
  type SmsRecipient,
} from '@/lib/deviceSms';
import { defaultGradeTemplate, renderGradeTemplate } from '@/lib/gradeTemplate';
import { SmsRunSheet } from '@/components/SmsRunSheet';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, display, text } from '@/theme/type';

const STANDING_KEY: Record<GradeStanding, TranslationKey> = {
  excellent: 'grades.standingExcellent',
  good: 'grades.standingGood',
  watch: 'grades.standingWatch',
  atRisk: 'grades.standingAtRisk',
};

export default function Grades() {
  const t = useT();
  const { accents, color, status } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ group?: string }>();

  const groups = useGroups();
  const students = useStudents();
  const assessments = useStore((s) => s.assessments);
  const grades = useStore((s) => s.grades);
  const removeAssessment = useStore((s) => s.removeAssessment);

  const [picked, setPicked] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);

  /** Live state of an SMS run, shared with the composer's sheet. */
  const [run, setRun] = useState<{
    total: number;
    results: SmsOutcome[];
    running: boolean;
  } | null>(null);
  const cancelled = useRef(false);

  const teacherName = useStore((s) => s.teacherName);
  const storedTemplate = useStore((s) => s.gradeTemplate);

  // Same derived-default pattern as the composer: follow the data until the
  // teacher picks, so a screen opened before hydration finishes still works.
  const groupId = picked ?? params.group ?? groups[0]?.id ?? null;
  const group = groups.find((g) => g.id === groupId);

  const roster = useMemo(
    () => (groupId ? students.filter((s) => s.groupIds.includes(groupId)) : []),
    [groupId, students],
  );

  const groupAssessments = useMemo(
    () =>
      assessments
        .filter((a) => a.groupId === groupId)
        .sort((a, b) => b.takenOn.localeCompare(a.takenOn)),
    [assessments, groupId],
  );

  const ranked = useMemo(() => {
    return (
      roster
        .map((s) => ({
          student: s,
          average: averagePercent(s.id, grades, assessments, { groupId: groupId ?? undefined }),
          marked: grades.filter(
            (g) => g.studentId === s.id && groupAssessments.some((a) => a.id === g.assessmentId),
          ).length,
        }))
        // Ungraded students sink to the bottom: they are not doing badly, there
        // is simply nothing to say about them yet.
        .sort((a, b) => (b.average ?? -1) - (a.average ?? -1))
    );
  }, [assessments, grades, groupAssessments, groupId, roster]);

  const graded = ranked.filter((r) => r.average !== null);
  const classAverage = graded.length
    ? Math.round((graded.reduce((n, r) => n + (r.average ?? 0), 0) / graded.length) * 10) / 10
    : null;
  const atRisk = graded.filter((r) => standingOf(r.average!) === 'atRisk').length;

  const unreported = useMemo(
    () =>
      groupAssessments.filter((a) => grades.some((g) => g.assessmentId === a.id && !g.notifiedAt)),
    [grades, groupAssessments],
  );

  /**
   * Everyone who should hear about this assessment, and what each of them is
   * told.
   *
   * Built on the device from the local store rather than asked of the server,
   * because the SMS goes out from the teacher's own SIM: the phone needs the
   * numbers and the marks in its hand, and it needs them whether or not there
   * is a connection at the time.
   */
  const smsRecipientsFor = (assessment: Assessment, audience: Audience, template: string) => {
    const kindLabel = assessmentKindLabel(assessment, t);
    const date = shortDate(fromKey(assessment.takenOn));
    const recipients: SmsRecipient[] = [];
    let noPhone = 0;

    for (const grade of grades.filter((g) => g.assessmentId === assessment.id)) {
      const student = students.find((s) => s.id === grade.studentId);
      if (!student) continue;

      const vars = {
        student: student.name,
        group: groups.find((g) => g.id === assessment.groupId)?.name ?? '',
        title: assessment.title,
        kind: kindLabel,
        score: grade.score,
        max: assessment.maxScore,
        percent: (grade.score / assessment.maxScore) * 100,
        date,
        teacher: teacherName,
      };

      if (audience !== 'parents') {
        if (student.phone?.trim()) {
          recipients.push({
            key: `${student.id}:student`,
            studentId: student.id,
            kind: 'student',
            name: student.name,
            phone: normalisePhone(student.phone),
            body: renderGradeTemplate(template, { ...vars, name: student.name }),
          });
        } else {
          noPhone += 1;
        }
      }

      if (audience !== 'students') {
        if (student.parentPhone?.trim()) {
          recipients.push({
            key: `${student.id}:parent`,
            studentId: student.id,
            kind: 'parent',
            name: student.parentName || student.name,
            phone: normalisePhone(student.parentPhone),
            // The parent is addressed by their own name where we have it, but
            // the mark is always described as the student's.
            body: renderGradeTemplate(template, {
              ...vars,
              name: student.parentName || student.name,
            }),
          });
        } else {
          noPhone += 1;
        }
      }
    }

    return { recipients, noPhone };
  };

  const notify = async (assessment: Assessment) => {
    const template = storedTemplate ?? defaultGradeTemplate(t);
    const canText = deviceSmsSupported();

    /*
      Two questions, asked in the order they matter. How it goes out first,
      because email and SMS have different consequences — one is free and
      arrives whenever, the other costs the teacher's own credit and lands on a
      lock screen — and only then who hears it.
    */
    type Channel = 'email' | 'sms' | 'both';
    let channel: Channel = 'email';
    if (canText) {
      const picked = await showDialog({
        title: t('grades.channelTitle'),
        message: t('grades.channelMessage'),
        tone: 'info',
        actions: [
          { label: t('grades.channelEmail'), value: 'email', intent: 'primary' },
          { label: t('grades.channelSms'), value: 'sms', intent: 'primary' },
          { label: t('grades.channelBoth'), value: 'both', intent: 'primary' },
          { label: t('common.notNow'), value: 'cancel', intent: 'quiet' },
        ],
      });
      if (!picked || picked === 'cancel') return;
      channel = picked as Channel;
    }

    // Who hears about a mark is the teacher's call every time, not a setting
    // buried somewhere: a result a 17-year-old wants sent to them alone and one
    // a parent expects to see are the same feature with different consequences.
    const choice = await showDialog({
      title: t('grades.sendTitle', { title: assessment.title }),
      message: t('grades.sendMessage'),
      tone: 'info',
      actions: [
        { label: t('messages.audienceStudents'), value: 'students', intent: 'primary' },
        { label: t('messages.audienceParents'), value: 'parents', intent: 'primary' },
        { label: t('messages.audienceBoth'), value: 'both', intent: 'primary' },
        { label: t('common.notNow'), value: 'cancel', intent: 'quiet' },
      ],
    });
    if (!choice || choice === 'cancel') return;

    const audience = choice as Audience;
    const lines: string[] = [];
    let anySent = false;

    setSending(assessment.id);
    try {
      if (channel !== 'sms') {
        try {
          const report = await sendGrades({
            assessmentId: assessment.id,
            audience,
            template,
            labels: {
              whyStudent: t('grades.mailWhyStudent'),
              whyParent: t('grades.mailWhyParent'),
              stop: t('grades.mailStop'),
              reply: t('grades.mailReply'),
            },
          });
          lines.push(t('grades.notifiedCount', { count: report.notified }));
          if (report.skipped) {
            lines.push(
              t(audience === 'parents' ? 'grades.skippedNoParentEmail' : 'grades.skippedNoEmail', {
                count: report.skipped,
              }),
            );
          }
          if (report.failed) lines.push(t('grades.failedCount', { count: report.failed }));
          lines.push(...report.errors);
          anySent ||= report.notified > 0;
        } catch (e) {
          // Held rather than thrown: the texts are a separate delivery and
          // should still go. The teacher is told at the end.
          lines.push(describeError(e).message);
        }
      }

      if (channel !== 'email') {
        const sent = await textResults(assessment, audience, template, lines);
        anySent ||= sent;
      }

      // The server stamped `notified_at` on whatever it emailed, and the SMS
      // run stamps its own. Re-read, or the screen keeps calling those marks
      // unreported.
      await refreshGrades().catch(() => {});

      await showAlert(
        anySent ? t('grades.resultsSent') : t('messages.nothingSentTitle'),
        lines.filter(Boolean).join('\n\n'),
        anySent ? 'success' : 'danger',
      );
    } catch (e) {
      showError(e, t('grades.couldNotSend'));
    } finally {
      setSending(null);
    }
  };

  /**
   * Text the results from this phone, watched.
   *
   * Returns whether anything went, and appends its own lines to the report the
   * teacher reads at the end.
   */
  const textResults = async (
    assessment: Assessment,
    audience: Audience,
    template: string,
    lines: string[],
  ): Promise<boolean> => {
    if (!hasSmsPermission()) {
      const ok = await showDialog({
        title: t('sms.permissionTitle'),
        message: t('sms.permissionBody'),
        actions: [
          { label: t('common.cancel'), value: 'no', intent: 'quiet' },
          { label: t('sms.continue'), value: 'yes', intent: 'primary' },
        ],
      });
      if (ok !== 'yes') return false;

      const granted = await requestSmsPermission();
      if (!granted.granted) {
        await showAlert(t('sms.permissionTitle'), t('sms.permissionDenied'), 'danger');
        return false;
      }
    }

    const { recipients, noPhone } = smsRecipientsFor(assessment, audience, template);
    if (noPhone) lines.push(t('grades.smsSkippedNoPhone', { count: noPhone }));
    if (!recipients.length) return false;

    cancelled.current = false;
    setRun({ total: recipients.length, results: [], running: true });

    const results = await sendSmsBatch(recipients, {
      batch: newSmsBatchId(),
      shouldStop: () => cancelled.current,
      onProgress: ({ latest }) =>
        setRun((r) => (r ? { ...r, results: [...r.results, latest] } : r)),
    });

    setRun((r) => (r ? { ...r, results, running: false } : r));

    const delivered = results.filter((r) => r.state === 'sent');
    lines.push(t('grades.smsSent', { count: delivered.length }));

    // Only the students something actually reached are marked reported, so a
    // second run re-sends exactly what failed.
    const reached = [...new Set(delivered.map((r) => r.studentId))];
    if (reached.length) {
      await markGradesNotified(assessment.id, reached).catch(() => {});
    }

    return delivered.length > 0;
  };

  const removeWithConfirm = async (assessment: Assessment) => {
    const yes = await confirm({
      title: t('grades.deleteAssessment', { title: assessment.title }),
      message: t('grades.deleteAssessmentMessage'),
      confirmLabel: t('common.delete'),
    });
    if (yes) removeAssessment(assessment.id);
  };

  const standingSkin = (s: GradeStanding) =>
    ({
      excellent: { bg: status.present.tint, fg: color.successDeep },
      good: { bg: color.primaryTint, fg: color.primaryInk },
      watch: { bg: accents.amber.tint, fg: accents.amber.ink },
      atRisk: { bg: status.absent.tint, fg: color.dangerDeep },
    })[s];

  return (
    <Screen>
      <TopBar title={t('nav.grades')} />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingTop: 16,
          paddingBottom: insets.bottom + 40,
        }}
        showsVerticalScrollIndicator={false}>
        {groups.length === 0 ? (
          <EmptyState
            title={t('groups.noneYet')}
            hint={t('grades.addStudentsFirst', { name: '' })}
          />
        ) : (
          <>
            <Overline style={styles.label}>{t('grades.group')}</Overline>
            <View style={styles.chipWrap}>
              {groups.map((g) => (
                <SelectChip
                  key={g.id}
                  label={g.name}
                  dot={accents[g.accent].dot}
                  count={students.filter((s) => s.groupIds.includes(g.id)).length}
                  selected={g.id === groupId}
                  onPress={() => setPicked(g.id)}
                />
              ))}
            </View>

            <View style={styles.statRow}>
              <StatTile
                value={classAverage !== null ? `${classAverage}%` : '·'}
                label={t('grades.classAverage')}
                tone={classAverage !== null ? color.primary : color.mutedLight}
                fontSize={21}
              />
              <StatTile
                value={String(groupAssessments.length)}
                label={t('grades.assessments')}
                fontSize={21}
              />
              <StatTile
                value={String(atRisk)}
                label={t('grades.atRisk')}
                tone={atRisk ? color.dangerDeep : color.mutedLight}
                fontSize={21}
              />
            </View>

            <Button
              grow
              icon="plus"
              label={t('grades.recordMarks')}
              height={50}
              style={{ marginTop: 16 }}
              onPress={() => router.push(`/grades/new?group=${groupId}`)}
              disabled={!groupId || roster.length === 0}
            />
            {roster.length === 0 && groupId ? (
              <Text style={styles.hint}>
                {t('grades.addStudentsFirst', { name: group?.name ?? '' })}
              </Text>
            ) : null}

            {unreported.length ? (
              <Card style={styles.noticeCard}>
                <Icon name="info" size={17} color={accents.amber.ink} />
                <Text style={styles.noticeText}>
                  {unreported.length === 1
                    ? t('grades.unreportedOne')
                    : t('grades.unreportedMany', { count: unreported.length })}
                </Text>
              </Card>
            ) : null}

            {/* ------------------------------------------------ Standings */}

            <Overline style={[styles.label, { marginTop: 24 }]}>{t('nav.students')}</Overline>
            {ranked.length === 0 ? (
              <EmptyState title={t('students.noMatches')} hint={t('grades.noStudentsInGroup')} />
            ) : (
              <Card style={{ overflow: 'hidden' }}>
                {ranked.map((row, i) => {
                  const standing = row.average !== null ? standingOf(row.average) : null;
                  const skin = standing ? standingSkin(standing) : null;
                  return (
                    <View key={row.student.id}>
                      {i > 0 ? <Divider inset={62} /> : null}
                      <Press
                        onPress={() => router.push(`/student/${row.student.id}`)}
                        style={styles.studentRow}>
                        <Avatar
                          name={row.student.name}
                          accent={row.student.accent}
                          size={38}
                          radius={radius.control}
                          fontSize={13}
                        />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.studentName} numberOfLines={1}>
                            {row.student.name}
                          </Text>
                          <Text style={styles.studentMeta}>
                            {row.marked
                              ? t('grades.marksRecorded', { count: row.marked })
                              : t('grades.notGradedYet')}
                          </Text>
                        </View>
                        {row.average !== null && skin && standing ? (
                          <View style={{ alignItems: 'flex-end', gap: 4 }}>
                            <Text style={[styles.average, { color: skin.fg }]}>{row.average}%</Text>
                            <Badge
                              label={t(STANDING_KEY[standing])}
                              bg={skin.bg}
                              fg={skin.fg}
                              textStyle={styles.standingText}
                            />
                          </View>
                        ) : (
                          <Text style={styles.noAverage}>·</Text>
                        )}
                      </Press>
                    </View>
                  );
                })}
              </Card>
            )}

            {/* ---------------------------------------------- Assessments */}

            {groupAssessments.length ? (
              <>
                <Overline style={[styles.label, { marginTop: 24 }]}>
                  {t('grades.assessments')}
                </Overline>
                <Card style={{ overflow: 'hidden' }}>
                  {groupAssessments.map((a, i) => {
                    const marks = grades.filter((g) => g.assessmentId === a.id);
                    const pending = marks.filter((g) => !g.notifiedAt).length;
                    return (
                      <View key={a.id}>
                        {i > 0 ? <Divider inset={15} /> : null}
                        <View style={styles.assessmentRow}>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <View style={styles.assessmentHead}>
                              <Badge
                                label={assessmentKindLabel(a, t)}
                                bg={color.bg}
                                fg={color.muted}
                                textStyle={styles.standingText}
                              />
                              <Text style={styles.assessmentTitle} numberOfLines={1}>
                                {a.title}
                              </Text>
                            </View>
                            <Text style={styles.assessmentMeta}>
                              {shortDate(fromKey(a.takenOn))} · {a.maxScore} ·{' '}
                              {t('grades.marked', { count: marks.length, total: roster.length })}
                            </Text>
                          </View>

                          <Press
                            onPress={() => router.push(`/grades/new?group=${groupId}&id=${a.id}`)}
                            hitSlop={8}
                            style={styles.iconAction}>
                            <Icon name="pencil" size={15} color={color.inkSoft} />
                          </Press>
                          <Press
                            onPress={() => removeWithConfirm(a)}
                            hitSlop={8}
                            style={styles.iconAction}>
                            <Icon name="close" size={15} color={color.dangerDeep} />
                          </Press>
                        </View>

                        {marks.length ? (
                          <Button
                            label={
                              sending === a.id
                                ? t('common.sending')
                                : pending
                                  ? t('grades.sendResultsTo', { count: pending })
                                  : t('grades.sendAgain')
                            }
                            variant={pending ? 'tonal' : 'ghost'}
                            height={40}
                            style={styles.notifyButton}
                            disabled={sending !== null}
                            onPress={() => notify(a)}
                          />
                        ) : null}
                      </View>
                    );
                  })}
                </Card>
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* The same sheet the composer uses. Texting a class of results takes a
          minute of watched progress, and it is the same minute whether the
          message is a reminder or a mark. */}
      <SmsRunSheet
        visible={run !== null}
        total={run?.total ?? 0}
        results={run?.results ?? []}
        running={run?.running ?? false}
        onCancel={() => {
          cancelled.current = true;
        }}
        onClose={() => setRun(null)}
      />
    </Screen>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    label: { marginBottom: 10 },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
    statRow: { flexDirection: 'row', gap: 10 },
    hint: {
      fontFamily: body[400],
      fontSize: 12.5,
      color: color.mutedLight,
      textAlign: 'center',
      marginTop: 8,
    },

    noticeCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      paddingHorizontal: 15,
      paddingVertical: 13,
      marginTop: 14,
    },
    noticeText: { flex: 1, fontFamily: body[600], fontSize: 12.5, color: color.inkSoft },

    studentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 15,
      paddingVertical: 12,
    },
    studentName: { fontFamily: body[700], fontSize: 14.5, color: color.ink },
    studentMeta: { fontFamily: body[400], fontSize: 12, color: color.mutedLight, marginTop: 2 },
    average: { fontFamily: display[600], fontSize: 17, ...text.tabular },
    noAverage: { fontFamily: body[600], fontSize: 15, color: color.faint },
    standingText: { fontFamily: body[700], fontSize: 10.5 },

    assessmentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 15,
      paddingTop: 13,
      paddingBottom: 9,
    },
    assessmentHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    assessmentTitle: { flex: 1, fontFamily: body[700], fontSize: 14, color: color.ink },
    assessmentMeta: {
      fontFamily: body[400],
      fontSize: 11.5,
      color: color.mutedLight,
      marginTop: 4,
    },
    iconAction: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
    },
    notifyButton: { marginHorizontal: 15, marginBottom: 12 },
  });

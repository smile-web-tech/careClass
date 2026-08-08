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
import { useMemo, useState } from 'react';
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
import { sendGrades } from '@/data/api';
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
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, display, text } from '@/theme/type';

const KIND_KEY: Record<Assessment['kind'], TranslationKey> = {
  quiz: 'grades.kindQuiz',
  exam: 'grades.kindExam',
  final: 'grades.kindFinal',
};

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

  const notify = async (assessment: Assessment) => {
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

    setSending(assessment.id);
    try {
      const report = await sendGrades({ assessmentId: assessment.id, audience });
      const lines = [
        t('grades.notifiedCount', { count: report.notified }),
        report.skipped
          ? t(audience === 'parents' ? 'grades.skippedNoParentEmail' : 'grades.skippedNoEmail', {
              count: report.skipped,
            })
          : '',
        report.failed ? t('grades.failedCount', { count: report.failed }) : '',
        ...report.errors,
      ].filter(Boolean);

      // The server stamped `notified_at` on whatever actually went. Re-read it,
      // or the screen keeps calling those marks unreported.
      await refreshGrades().catch(() => {});

      await showAlert(
        report.notified ? t('grades.resultsSent') : t('messages.nothingSentTitle'),
        lines.join('\n\n'),
        report.notified ? 'success' : 'danger',
      );
    } catch (e) {
      showError(e, t('grades.couldNotSend'));
    } finally {
      setSending(null);
    }
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
                                label={t(KIND_KEY[a.kind])}
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

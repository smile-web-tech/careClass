/**
 * What to call an assessment.
 *
 * Two eras of data meet here. Anything created since teachers could name their
 * own types carries `kindLabel` — "Test 2", "Final test", whatever they wrote.
 * Anything older carries the original `quiz | exam | final` enum and has to be
 * translated. Every screen that shows a mark needs the same answer, so it is
 * worked out in one place.
 */
import type { Assessment, AssessmentKind } from '@/data/types';
import type { TranslationKey } from '@/i18n';

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

const LEGACY: Record<AssessmentKind, TranslationKey> = {
  quiz: 'grades.kindQuiz',
  exam: 'grades.kindExam',
  final: 'grades.kindFinal',
};

export function assessmentKindLabel(
  assessment: Pick<Assessment, 'kind' | 'kindLabel'>,
  t: Translate,
): string {
  if (assessment.kindLabel?.trim()) return assessment.kindLabel.trim();
  if (assessment.kind) return t(LEGACY[assessment.kind]);
  // Neither, which should not happen — but a blank chip is better than the
  // word "undefined" next to somebody's mark.
  return '';
}

/**
 * The starting set offered to a group that has no types of its own yet.
 *
 * Suggestions, not rows: nothing is written until the teacher picks one, so a
 * group they never assess does not accumulate three types they never asked
 * for. They are translated, which is also why they are not seeded into the
 * database at sign-up — a teacher who switches language would be stuck with
 * the old one's words.
 */
export const starterTypeNames = (t: Translate): string[] => [
  t('grades.kindQuiz'),
  t('grades.kindExam'),
  t('grades.kindFinal'),
];

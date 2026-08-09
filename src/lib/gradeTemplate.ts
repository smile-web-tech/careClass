/**
 * The message a student or parent gets when a mark is reported.
 *
 * The Edge Function used to compose this itself, in English, with no way to
 * change a word of it. A teacher working in Turkmen all term would have their
 * class receive "You scored 42 out of 50" from an app that had never spoken
 * English to anyone involved. The wording belongs to the teacher.
 *
 * Rendering lives here rather than only on the server because the same text is
 * needed in two places: the function sends the email, and the phone sends the
 * SMS from the teacher's own SIM. One renderer, one set of placeholders, so
 * the two channels cannot drift into saying different things about the same
 * result.
 */
import type { TranslationKey } from '@/i18n';

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

/**
 * What a teacher may write into the template.
 *
 * `{name}` is whoever is being addressed and `{student}` is always the student,
 * which matters for the parent copy: "Dear Aýgül, Aýgül scored 42" is what one
 * placeholder for both would produce.
 */
export const GRADE_PLACEHOLDERS = [
  '{name}',
  '{student}',
  '{group}',
  '{title}',
  '{kind}',
  '{score}',
  '{max}',
  '{percent}',
  '{date}',
  '{teacher}',
] as const;

export type GradeVars = {
  name: string;
  student: string;
  group: string;
  title: string;
  kind: string;
  score: number;
  max: number;
  percent: number;
  date: string;
  teacher: string;
};

/** Whole numbers stay whole: "8/10", never "8.0/10.0". */
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * The starting wording, in the teacher's language.
 *
 * Deliberately free of praise or criticism. A number and its context is a fact;
 * "well done" or "you must try harder" in a message the teacher never actually
 * wrote is a judgement attributed to them that they did not make. Anyone who
 * wants to say it can add it, which is the point of the template being theirs.
 */
export const defaultGradeTemplate = (t: Translate) => t('grades.templateDefault');

export function renderGradeTemplate(template: string, vars: GradeVars): string {
  return template
    .replaceAll('{name}', vars.name)
    .replaceAll('{student}', vars.student)
    .replaceAll('{group}', vars.group)
    .replaceAll('{title}', vars.title)
    .replaceAll('{kind}', vars.kind)
    .replaceAll('{score}', num(vars.score))
    .replaceAll('{max}', num(vars.max))
    .replaceAll('{percent}', String(Math.round(vars.percent * 10) / 10))
    .replaceAll('{date}', vars.date)
    .replaceAll('{teacher}', vars.teacher);
}

/** A worked example for the editor, so the teacher sees what they are writing. */
export function previewGradeTemplate(template: string, t: Translate, teacherName: string): string {
  return renderGradeTemplate(template, {
    name: t('grades.previewStudent'),
    student: t('grades.previewStudent'),
    group: t('grades.previewGroup'),
    title: t('grades.previewTitle'),
    kind: t('grades.kindExam'),
    score: 42,
    max: 50,
    percent: 84,
    date: t('grades.previewDate'),
    teacher: teacherName || t('grades.previewTeacher'),
  });
}

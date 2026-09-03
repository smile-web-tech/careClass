/**
 * Which guardian a message actually goes to.
 *
 * `parent` is the mother — `parentName`, `parentPhone` — and `parent2` the
 * father, matching the columns. Until now only the mother was ever written to:
 * the send read `parentPhone` and nothing read `parent2Phone`, so a child whose
 * family is reached through their father could not be reached at all, and the
 * app reported them as having no guardian rather than as having one it declined
 * to use.
 *
 * Pure and separate from the sending because this is the part with the rules in
 * it, and rules about who receives a text are worth being able to test without
 * a radio.
 */
import type { Student } from '@/data/types';

/** Who the teacher asked for. */
export type ParentTarget = 'mother' | 'father' | 'both';

export type GuardianKind = 'parent' | 'parent2';

type Contactable = Pick<Student, 'parentPhone' | 'parent2Phone'>;

const has = (phone: string | undefined) => !!phone?.trim();

/**
 * The guardians to write to, in the order they should be sent.
 *
 * The teacher's choice first, then a fallback to whichever one exists. Asking
 * for the mother on a child whose only number is the father's sends to the
 * father: the point of choosing is to say who to *prefer*, and a preference
 * that drops the message when it cannot be met is worse than no preference.
 *
 * `both` means both of them that have a number, which with only one on file is
 * that one — the same answer the fallback gives, arrived at without needing to
 * be a special case.
 */
export function guardiansFor(student: Contactable, target: ParentTarget): GuardianKind[] {
  const mother = has(student.parentPhone);
  const father = has(student.parent2Phone);

  if (target === 'both') {
    return [...(mother ? (['parent'] as const) : []), ...(father ? (['parent2'] as const) : [])];
  }

  const first: GuardianKind = target === 'mother' ? 'parent' : 'parent2';
  const other: GuardianKind = target === 'mother' ? 'parent2' : 'parent';
  const have = (k: GuardianKind) => (k === 'parent' ? mother : father);

  if (have(first)) return [first];
  if (have(other)) return [other];
  return [];
}

/**
 * Whether there was a guardian to miss.
 *
 * A student with nobody on file was never a recipient, and counting them as
 * skipped tells the teacher four messages failed when four children simply have
 * no parent recorded. A guardian we hold a name or an address for but no number
 * is the real skip: somebody is there and we cannot text them.
 */
export function hasGuardianOnFile(
  student: Pick<Student, 'parentName' | 'parentEmail' | 'parent2Name' | 'parent2Email'>,
): boolean {
  return !!(student.parentName || student.parentEmail || student.parent2Name || student.parent2Email);
}

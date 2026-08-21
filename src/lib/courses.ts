/**
 * Where a course stands, and what that adds up to for a student.
 *
 * All of this is derived rather than stored, for the reason set out in
 * migration 0019: a course finishes when a date passes, and nothing in this app
 * is running at that moment to write it down. A phone that was switched off for
 * a fortnight has to arrive at the same answer as one that was not, and the
 * only way to guarantee that is to count from the dates every time.
 */
import type { Group, Student } from '@/data/types';
import { toKey } from '@/lib/date';

export type CourseState = 'finished' | 'running' | 'upcoming';

/**
 * Finished, running, or not started yet.
 *
 * Archived counts as finished whatever the dates say. Filing a course away is
 * the teacher stating in as many words that it is over, and that beats an end
 * date they never got round to setting — which, for a group made before dates
 * existed, is most of them.
 */
export function courseState(group: Group, today = toKey(new Date())): CourseState {
  if (group.archivedAt) return 'finished';
  if (group.endsOn && group.endsOn < today) return 'finished';
  if (group.startsOn && group.startsOn > today) return 'upcoming';
  return 'running';
}

export type StudentCourses = {
  finished: Group[];
  running: Group[];
  upcoming: Group[];
};

/** A student's courses, split by where each one stands. */
export function studentCourses(
  student: Pick<Student, 'groupIds'>,
  groups: Group[],
  today = toKey(new Date()),
): StudentCourses {
  const out: StudentCourses = { finished: [], running: [], upcoming: [] };
  for (const g of groups) {
    if (!student.groupIds.includes(g.id)) continue;
    out[courseState(g, today)].push(g);
  }
  return out;
}

/**
 * The level: which course they are on.
 *
 * Finished courses plus one. The plus one is the course in front of them, which
 * is why a student sitting in their first is a level 1 and not a level 0, and
 * why finishing a course moves them up on the day it finishes rather than on
 * the day they happen to be enrolled in the next thing.
 *
 * Running courses are deliberately *not* counted separately. Adding them would
 * make a student taking two classes at once a level higher than one taking a
 * single class, which is not what the word means to a teacher — and it would
 * make the level fall back down when a course ended and they had nothing else
 * on, which is worse than being wrong: it looks like the app forgot.
 *
 * `levelBase` carries what counting cannot see — courses done before this app,
 * or a teacher's correction. Absent is zero, which is the right reading of
 * every student who existed before the column.
 */
export function levelOf(
  student: Pick<Student, 'groupIds' | 'levelBase'>,
  groups: Group[],
  today = toKey(new Date()),
): number {
  return (student.levelBase ?? 0) + studentCourses(student, groups, today).finished.length + 1;
}

/**
 * The base needed to make a student read as `level`.
 *
 * The teacher types the number they mean; this works out what has to be stored
 * behind it so that the number is true today *and* still climbs when they
 * finish their next course. Clamped at zero, because a teacher typing a level
 * lower than the courses already counted here would otherwise store a negative
 * and make every later reading wrong by the difference.
 */
export function baseForLevel(
  level: number,
  student: Pick<Student, 'groupIds'>,
  groups: Group[],
  today = toKey(new Date()),
): number {
  const finished = studentCourses(student, groups, today).finished.length;
  return Math.max(0, Math.round(level) - finished - 1);
}

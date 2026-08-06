import type { AccentName, AttendanceStatus } from '@/theme/tokens';

/** 0 = Sunday … 6 = Saturday, matching `Date#getDay`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** One recurring weekly slot for a group. Times are local `HH:mm`. */
export type Slot = {
  day: Weekday;
  start: string;
  end: string;
};

export type Group = {
  id: string;
  name: string;
  subject: string;
  accent: AccentName;
  room: string;
  slots: Slot[];
};

export type Student = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  parentName?: string;
  parentPhone?: string;
  parentEmail?: string;
  groupIds: string[];
  accent: AccentName;
  note?: string;
  /** Out of 10, as shown on the group and student stat strips. */
  avgScore?: number;
};

/**
 * A concrete class occurrence. Sessions are *derived* from a group's weekly
 * slots rather than stored, so the schedule stays true no matter what date the
 * app is opened on. The id is stable and reconstructible: `groupId@YYYY-MM-DD`.
 */
export type Session = {
  id: string;
  groupId: string;
  /** `YYYY-MM-DD` in local time. */
  date: string;
  start: string;
  end: string;
};

/**
 * A one-off entry on the teacher's own calendar — a parent meeting, an exam, a
 * day off. Distinct from `Session`, which is derived from a group's weekly
 * slots and never stored.
 *
 * Times are local `HH:mm` on `date`, matching how slots are stored, so the
 * calendar can merge both without reconciling timezones. `allDay` ignores them.
 */
export type CalendarEvent = {
  id: string;
  title: string;
  note?: string;
  /** `YYYY-MM-DD` in local time. */
  date: string;
  allDay: boolean;
  start?: string;
  end?: string;
  accent: AccentName;
};

/** Attendance for one session, keyed by student id. */
export type AttendanceRecord = Record<string, AttendanceStatus>;

export type Audience = 'students' | 'parents' | 'both';
export type Channel = 'sms' | 'email' | 'push';

export type Message = {
  id: string;
  /** Empty means "all groups" — an announcement. */
  groupIds: string[];
  audience: Audience;
  channels: Channel[];
  body: string;
  sentAt: number;
  delivered: number;
  total: number;
  announcement?: boolean;
};

export type Reply = {
  id: string;
  authorName: string;
  /** "parent of Amir" or the group name. */
  context: string;
  accent: AccentName;
  body: string;
  at: number;
  unread: boolean;
};

/* -------------------------------------------------------------------------- */
/* Grading                                                                    */
/* -------------------------------------------------------------------------- */

export type AssessmentKind = 'quiz' | 'exam' | 'final';

/**
 * Something a group sat. Scores are stored against it rather than as bare
 * numbers on the student, because "17" only means something next to the
 * `maxScore` it was out of.
 */
export type Assessment = {
  id: string;
  groupId: string;
  kind: AssessmentKind;
  title: string;
  maxScore: number;
  /** `YYYY-MM-DD`, the same key format the schedule uses. */
  takenOn: string;
};

export type Grade = {
  id: string;
  assessmentId: string;
  studentId: string;
  score: number;
  /** Epoch ms when the student was told, or undefined if they have not been. */
  notifiedAt?: number;
};

/**
 * A reusable message body the teacher wrote.
 *
 * The built-in starters are not these: they live in the translation catalogue
 * so they arrive in the teacher's language. This type is only what they saved.
 */
export type MessageTemplate = {
  id: string;
  title: string;
  body: string;
};

export type { AttendanceStatus };

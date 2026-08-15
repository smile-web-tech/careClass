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

  /*
    When the course runs, as opposed to which days of the week it meets.

    `slots` says "Monday and Thursday at four". These two say "for the eight
    weeks beginning in September". Without them a group meets on those days
    forever in both directions, so a course that finished in June still fills
    next January's calendar, and its attendance rate is computed against
    sessions that will never happen.

    Both optional, and both absent means exactly what it always meant: a group
    with no end, which is the right default for a tutor whose classes simply
    continue. Every group that existed before these columns is that.
  */

  /** `YYYY-MM-DD`. The first day the group meets; before it, nothing. */
  startsOn?: string;
  /** `YYYY-MM-DD`, inclusive — the last day it can meet. Absent means ongoing. */
  endsOn?: string;
};

export type Student = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  /** `YYYY-MM-DD`. Drives the birthday reminder. */
  birthDate?: string;
  address?: string;
  school?: string;
  /** Passport or birth certificate. Free text — the formats differ. */
  documentId?: string;

  /** The first guardian. These three predate the second parent's columns. */
  parentName?: string;
  parentPhone?: string;
  parentEmail?: string;
  parentWork?: string;

  parent2Name?: string;
  parent2Phone?: string;
  parent2Email?: string;
  parent2Work?: string;

  groupIds: string[];
  accent: AccentName;
  /**
   * Where the picture sits in storage, once uploaded.
   *
   * The copy on the device is found by student id rather than recorded here —
   * see `photoFile` — so the face is on screen offline whether or not this has
   * reached the server yet.
   */
  photoPath?: string;
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
  /** Homework sent from the Assignments screen, with files attached. */
  isAssignment?: boolean;
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

/**
 * A send the phone did itself, written into the message log after the fact.
 *
 * Everything sent through an Edge Function is recorded by that function as it
 * goes. A text sent from the teacher's own SIM has no server in the loop at
 * all, so nothing recorded it — which is why exam results texted from the phone
 * used to leave no trace anywhere in the app. This is that record, built on the
 * device and pushed up with the rest of the queue.
 *
 * The id is generated here and reused as the row id, so a queued log that is
 * retried after a failed connection replaces itself rather than appearing twice.
 */
export type SentMessageLog = {
  id: string;
  groupIds: string[];
  audience: Audience;
  channels: Channel[];
  /** What the teacher composed, placeholders intact. */
  body: string;
  sentAt: number;
  deliveries: {
    studentId: string;
    recipient: 'student' | 'parent';
    channel: Channel;
    /** The number or address it went to. */
    destination: string;
    /** This recipient's own copy, placeholders filled in. */
    rendered: string;
    /**
     * `queued` is not a pending state here — it is the honest answer when the
     * radio took the message and no report ever came back. Calling that failed
     * would have a teacher re-send a text the parent already has.
     */
    state: 'sent' | 'failed' | 'queued';
    /** Untranslated reason code, when there is one. */
    error?: string;
  }[];
};

export type Reply = {
  id: string;
  authorName: string;
  /**
   * Who the reply is about, when the routing token identified them.
   *
   * Absent on a reply that arrived without one — an older send, or mail that
   * reached the inbound address some other way. The screen uses it to open the
   * student, so absent simply means the avatar is not a link.
   */
  studentId?: string;
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

/**
 * The original three, kept only for assessments filed before teachers could
 * name their own. Nothing new is written with these.
 */
export type AssessmentKind = 'quiz' | 'exam' | 'final';

/**
 * A kind of assessment the teacher named, belonging to one group.
 *
 * Per group rather than per account: a beginners' class and an exam-prep class
 * are assessed differently, and one list covering both is a list nobody wants
 * to scroll while entering marks.
 */
export type AssessmentType = {
  id: string;
  groupId: string;
  name: string;
  /** The teacher's own order. "Test 1, Test 2, Final" is not alphabetical. */
  position: number;
};

/**
 * Something a group sat. Scores are stored against it rather than as bare
 * numbers on the student, because "17" only means something next to the
 * `maxScore` it was out of.
 */
export type Assessment = {
  id: string;
  groupId: string;
  /** Null on anything created since the teacher could name their own types. */
  kind: AssessmentKind | null;
  /**
   * What the teacher called it, copied at creation rather than referenced.
   *
   * Deleting a type must not rewrite the history of every paper filed under
   * it: "Test 2" stays "Test 2" on marks the class already sat.
   */
  kindLabel?: string;
  title: string;
  maxScore: number;
  /**
   * Lowest score counted as a pass, and the line between the two wordings.
   *
   * Per assessment rather than per teacher: a mock exam out of 100 and a
   * vocabulary quiz out of 10 do not share a threshold. Undefined means the
   * teacher set none and every result goes out with the pass wording.
   */
  passMark?: number;
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

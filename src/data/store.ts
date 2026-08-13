import * as Crypto from 'expo-crypto';
import { useMemo } from 'react';
import { create } from 'zustand';

import type {
  Assessment,
  AssessmentType,
  AttendanceRecord,
  AttendanceStatus,
  Audience,
  CalendarEvent,
  Channel,
  Grade,
  Group,
  Message,
  MessageTemplate,
  Reply,
  Session,
  Student,
} from '@/data/types';
import type { Language } from '@/i18n';
import { DEFAULT_LANGUAGE, setActiveLanguage } from '@/i18n';
import { at, toKey } from '@/lib/date';
import { accentNames } from '@/theme';
import type { ReminderLead } from '@/lib/notifications';

/**
 * Attendance is stored sparsely: only sessions the teacher has actually saved
 * live in `attendance`. Everything else is synthesised — see `historicMark`.
 */
export const attendanceKey = (s: Pick<Session, 'groupId' | 'date' | 'start'>) =>
  `${s.groupId}@${s.date}#${s.start}`;

/**
 * Stable pseudo-random attendance for sessions that happened before the app was
 * installed. Deterministic on (student, session) so the history — and every
 * percentage derived from it — stays put across reloads instead of reshuffling
 * on each render.
 *
 * DEMO DATA ONLY. Every caller must gate on `synthesiseHistory()` — inventing
 * attendance for a real student is not a cosmetic problem: it would show a
 * teacher absences that never happened and put them in front of a parent.
 */
export function historicMark(studentId: string, key: string): AttendanceStatus {
  let h = 2166136261;
  const s = `${studentId}|${key}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const roll = (h >>> 0) % 100;
  if (roll < 5) return 'absent';
  if (roll < 12) return 'late';
  return 'present';
}

type NewStudent = {
  /**
   * Optional, and supplied by the form so a photo can be stored against the
   * student before they exist. Minting it here instead would mean the picture
   * is taken under one id and the row saved under another.
   */
  id?: string;
  name: string;
  phone: string;
  email?: string;
  parentName?: string;
  parentPhone?: string;
  parentEmail?: string;
  groupIds: string[];
};

type State = {
  signedIn: boolean;
  /**
   * The Supabase user id the persisted data belongs to.
   *
   * Load-bearing, not bookkeeping. Everything below is one account's data held
   * on the device, and signing out only flipped `signedIn` — so signing back in
   * as somebody else showed the previous teacher's groups and students until
   * the first hydrate finished, and any slice the new account had none of (no
   * templates, no events) kept the old one's forever. Comparing this against
   * the session's id is what makes a switch a switch.
   */
  teacherId: string | null;
  teacherName: string;
  teacherEmail: string | null;
  teacherAvatarUrl: string | null;
  /** 'google' | 'apple' | 'email'. */
  teacherProvider: string;
  /**
   * The teacher's own wording for a reported mark.
   *
   * Null means they have not written one and the translated default applies.
   * Storing null rather than a copy of the default is what lets the default
   * keep improving with the catalogue, and lets it follow a change of
   * language instead of freezing in whichever one was active at sign-up.
   */
  gradeTemplate: string | null;
  /** The wording for a mark below the pass mark. Null uses the app default. */
  gradeTemplateFail: string | null;
  groups: Group[];
  students: Student[];
  /** Saved attendance, keyed by `attendanceKey`. */
  attendance: Record<string, AttendanceRecord>;
  messages: Message[];
  replies: Reply[];
  /** The teacher's own calendar entries — not class sessions. */
  events: CalendarEvent[];
  /** Everything a group has sat, newest first. */
  assessments: Assessment[];
  /** The kinds of assessment each group uses, in the teacher's own order. */
  assessmentTypes: AssessmentType[];
  /** One mark per student per assessment. */
  grades: Grade[];
  /** Reusable message bodies the teacher wrote. Built-ins are not in here. */
  templates: MessageTemplate[];

  /**
   * Interface language, and the language students' emails are written in.
   *
   * Turkmen by default rather than device locale: the app is for Turkmen
   * teachers, and a phone set to Russian is a weaker signal about what a class
   * should receive than the teacher's own explicit choice.
   */
  language: Language;
  /** False until the teacher has been asked, which gates the welcome screen. */
  languageChosen: boolean;

  /**
   * Whether the permissions screen has been through once.
   *
   * A flag rather than a check of the permissions themselves: a teacher who
   * deliberately refused everything must not be asked again on every launch,
   * and the OS cannot tell "refused" from "never asked" for all of them.
   */
  permissionsAsked: boolean;

  /** Local class reminders: off, or how many minutes before the start. */
  remindersOn: boolean;
  reminderLead: ReminderLead;

  signIn: (name?: string) => void;
  signOut: () => void;
  markPermissionsAsked: () => void;
  /**
   * Throw away everything that belongs to an account, keeping only what belongs
   * to the device — the language, and whether the welcome screen has been seen.
   */
  resetAccount: () => void;

  addGroup: (g: Omit<Group, 'id' | 'accent'> & { accent?: Group['accent'] }) => string;
  updateGroup: (id: string, patch: Partial<Omit<Group, 'id'>>) => void;
  removeGroup: (id: string) => void;
  addStudent: (s: NewStudent) => string;
  updateStudent: (id: string, patch: Partial<Student>) => void;
  removeStudent: (id: string) => void;
  /** Set a group's roster to exactly these students, adding and removing. */
  setGroupRoster: (groupId: string, studentIds: string[]) => void;

  saveAttendance: (key: string, record: AttendanceRecord) => void;

  sendMessage: (m: {
    groupIds: string[];
    audience: Audience;
    channels: Channel[];
    body: string;
    total: number;
    announcement?: boolean;
  }) => void;
  markRepliesRead: () => void;
  markReplyRead: (id: string) => void;
  removeReply: (id: string) => void;
  removeMessage: (id: string) => void;
  /** Bulk delete from the selection mode on the Messages tab. */
  removeReplies: (ids: string[]) => void;
  removeMessages: (ids: string[]) => void;

  saveAssessment: (assessment: Assessment, scores: { studentId: string; score: number }[]) => void;
  removeAssessment: (id: string) => void;

  /** Returns the new type's id, so the caller can select it straight away. */
  addAssessmentType: (groupId: string, name: string) => string;
  removeAssessmentType: (id: string) => void;

  addTemplate: (title: string, body: string) => string;
  updateTemplate: (id: string, patch: Partial<Omit<MessageTemplate, 'id'>>) => void;
  removeTemplate: (id: string) => void;

  setLanguage: (language: Language) => void;
  /** Null puts the teacher back on the app's translated default. */
  setGradeTemplate: (template: string | null) => void;
  setGradeTemplateFail: (template: string | null) => void;
  setReminders: (on: boolean, lead?: ReminderLead) => void;

  addEvent: (e: Omit<CalendarEvent, 'id'>) => string;
  updateEvent: (id: string, patch: Partial<Omit<CalendarEvent, 'id'>>) => void;
  removeEvent: (id: string) => void;
};

/**
 * A real UUID, minted here rather than by Postgres.
 *
 * This used to be a short local key like `g-m2x9q1`, and the sync layer swapped
 * it for the server's id once the insert came back. That swap was a bug factory:
 * anything already holding the old id — a route the teacher had just been sent
 * to, a screen on the back stack — was left pointing at a row that no longer
 * existed. Creating a group and landing on "That group no longer exists" was
 * exactly this.
 *
 * Generating the id up front makes it the same value everywhere from the first
 * render, so there is nothing to swap and nothing to go stale. Postgres accepts
 * an explicit primary key perfectly happily; `gen_random_uuid()` is only a
 * default.
 */
const uid = () => Crypto.randomUUID();

/**
 * Optional write-through to the backend.
 *
 * `data/sync.ts` registers itself here at startup. Keeping it a callback rather
 * than an import means the store has no dependency on Supabase at all — the app
 * runs on seed data when no project is configured, and there is no import cycle
 * between the store and the repository layer.
 */
export type StoreMirror = {
  createGroup: (group: Group) => void;
  updateGroup: (id: string, patch: Partial<Omit<Group, 'id'>>) => void;
  deleteGroup: (id: string) => void;
  createStudent: (student: Student) => void;
  updateStudent: (id: string, patch: Partial<Student>) => void;
  archiveStudent: (id: string) => void;
  uploadStudentPhoto: (id: string) => void;
  saveAttendance: (key: string, marks: AttendanceRecord) => void;
  sendMessage: (input: {
    groupIds: string[];
    audience: Audience;
    channels: Channel[];
    body: string;
    announcement?: boolean;
  }) => void;
  setLanguage: (language: Language) => void;
  setGradeTemplate: (template: string | null) => void;
  setGradeTemplateFail: (template: string | null) => void;
  markRepliesRead: () => void;
  markReplyRead: (id: string) => void;
  deleteReply: (id: string) => void;
  deleteMessage: (id: string) => void;
  deleteReplies: (ids: string[]) => void;
  deleteMessages: (ids: string[]) => void;
  saveAssessment: (assessment: Assessment, scores: { studentId: string; score: number }[]) => void;
  deleteAssessment: (id: string) => void;
  createAssessmentType: (type: AssessmentType) => void;
  deleteAssessmentType: (id: string) => void;
  createTemplate: (template: MessageTemplate) => void;
  updateTemplate: (id: string, patch: Partial<Omit<MessageTemplate, 'id'>>) => void;
  deleteTemplate: (id: string) => void;
  createEvent: (event: CalendarEvent) => void;
  updateEvent: (id: string, patch: Partial<Omit<CalendarEvent, 'id'>>) => void;
  deleteEvent: (id: string) => void;
};

let mirror: Partial<StoreMirror> = {};
export const setStoreMirror = (m: Partial<StoreMirror>) => {
  mirror = m;
};

/**
 * The store screens read from.
 *
 * No persistence middleware any more. It lived in AsyncStorage as one JSON
 * blob, rewritten in full on every change, which is fine until the change is
 * the thirtieth mark of a register and the phone is killed halfway through the
 * write. `data/persistence.ts` now loads this from — and saves it to — the
 * SQLite database in `data/localDb.ts`, a collection at a time.
 */
export const useStore = create<State>()((set, get) => ({
  signedIn: false,
  teacherId: null,
  // Empty, not seeded. A public build must never show a new teacher a class
  // of invented students — they look real, they are indistinguishable from
  // a sync that half-worked, and one of them ending up in a message would
  // be unforgivable.
  teacherName: '',
  teacherEmail: null,
  teacherAvatarUrl: null,
  teacherProvider: 'email',
  gradeTemplate: null,
  gradeTemplateFail: null,
  groups: [],
  students: [],
  attendance: {},
  messages: [],
  replies: [],
  events: [],
  assessments: [],
  assessmentTypes: [],
  grades: [],
  templates: [],
  language: DEFAULT_LANGUAGE,
  languageChosen: false,
  permissionsAsked: false,
  remindersOn: false,
  reminderLead: 15,

  signIn: (name) => set((s) => ({ signedIn: true, teacherName: name ?? s.teacherName })),

  // Signing out clears the account's data as well as the flag. Leaving it
  // in place meant the next teacher to sign in on this phone saw the last
  // one's classes — and a shared staffroom phone is exactly how this app
  // gets used.
  markPermissionsAsked: () => set({ permissionsAsked: true }),

  signOut: () => {
    get().resetAccount();
    set({ signedIn: false });
  },

  resetAccount: () =>
    set({
      teacherId: null,
      teacherName: '',
      teacherEmail: null,
      teacherAvatarUrl: null,
      teacherProvider: 'email',
      gradeTemplate: null,
      gradeTemplateFail: null,
      groups: [],
      students: [],
      attendance: {},
      messages: [],
      replies: [],
      events: [],
      assessments: [],
      assessmentTypes: [],
      grades: [],
      templates: [],
      // Reminders are scheduled against groups that have just been dropped,
      // so the schedule is meaningless now. `useClassReminders` re-plans
      // from whatever the next account turns out to have.
      remindersOn: false,
    }),

  addGroup: (g) => {
    const id = uid();
    const group = {
      ...g,
      id,
      accent: g.accent ?? accentNames[get().groups.length % accentNames.length],
    };
    set((s) => ({ groups: [...s.groups, group] }));
    mirror.createGroup?.(group);
    return id;
  },

  /**
   * Edit a group. Slots are replaced wholesale, matching what the API does
   * — see `updateGroup` there for why diffing them would be wrong.
   */
  updateGroup: (id, patch) => {
    set((s) => ({
      groups: s.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    }));
    mirror.updateGroup?.(id, patch);
  },

  /**
   * Remove a group. Students stay — they are people, not memberships — but
   * lose this group from their `groupIds`, mirroring the `student_groups`
   * cascade on the server.
   */
  removeGroup: (id) => {
    set((s) => ({
      groups: s.groups.filter((g) => g.id !== id),
      students: s.students.map((st) =>
        st.groupIds.includes(id) ? { ...st, groupIds: st.groupIds.filter((g) => g !== id) } : st,
      ),
    }));
    mirror.deleteGroup?.(id);
  },

  addStudent: (input) => {
    // The form's id where it gave one, so a photo taken before saving belongs
    // to the right student.
    const id = input.id ?? uid();
    const student: Student = {
      ...input,
      id,
      accent: accentNames[get().students.length % accentNames.length],
    };
    set((s) => ({ students: [...s.students, student] }));
    mirror.createStudent?.(student);
    return id;
  },

  updateStudent: (id, patch) => {
    set((s) => ({
      students: s.students.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    }));
    mirror.updateStudent?.(id, patch);
  },

  removeStudent: (id) => {
    set((s) => ({ students: s.students.filter((x) => x.id !== id) }));
    mirror.archiveStudent?.(id);
  },

  /**
   * Replace a group's roster with exactly `studentIds`.
   *
   * Membership lives on the student (`groupIds`), mirroring the
   * `student_groups` join table, so this walks the students rather than the
   * group. Only the ones whose membership actually changes are written —
   * both to keep the local update small and, more importantly, because each
   * mirrored `updateStudent` rewrites that student's whole membership row
   * set on the server.
   */
  setGroupRoster: (groupId, studentIds) => {
    const wanted = new Set(studentIds);

    const changes = get()
      .students.map((st) => {
        const isMember = st.groupIds.includes(groupId);
        if (isMember === wanted.has(st.id)) return null;
        return {
          id: st.id,
          groupIds: isMember ? st.groupIds.filter((g) => g !== groupId) : [...st.groupIds, groupId],
        };
      })
      .filter((c) => c !== null);

    if (changes.length === 0) return;

    const next = new Map(changes.map((c) => [c.id, c.groupIds]));
    set((s) => ({
      students: s.students.map((st) => {
        const groupIds = next.get(st.id);
        return groupIds ? { ...st, groupIds } : st;
      }),
    }));

    for (const c of changes) mirror.updateStudent?.(c.id, { groupIds: c.groupIds });
  },

  setReminders: (on, lead) =>
    set((s) => ({ remindersOn: on, reminderLead: lead ?? s.reminderLead })),

  addEvent: (input) => {
    const id = uid();
    const event: CalendarEvent = { ...input, id };
    set((s) => ({ events: [...s.events, event] }));
    mirror.createEvent?.(event);
    return id;
  },

  updateEvent: (id, patch) => {
    set((s) => ({
      events: s.events.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
    mirror.updateEvent?.(id, patch);
  },

  removeEvent: (id) => {
    set((s) => ({ events: s.events.filter((e) => e.id !== id) }));
    mirror.deleteEvent?.(id);
  },

  saveAttendance: (key, record) => {
    set((s) => ({ attendance: { ...s.attendance, [key]: record } }));
    mirror.saveAttendance?.(key, record);
  },

  sendMessage: ({ groupIds, audience, channels, body, total, announcement }) => {
    set((s) => ({
      messages: [
        {
          id: uid(),
          groupIds,
          audience,
          channels,
          body,
          total,
          // Optimistic. The Edge Function replaces this with real per-
          // recipient delivery states as the gateways report back.
          delivered: total,
          sentAt: Date.now(),
          announcement,
        },
        ...s.messages,
      ],
    }));
    mirror.sendMessage?.({
      groupIds,
      audience,
      channels,
      body,
      announcement,
    });
  },

  setLanguage: (language) => {
    setActiveLanguage(language);
    set({ language, languageChosen: true });

    // Only mirrored once there is an account to mirror it *to*. The picker
    // also appears on the welcome screen, before anyone has signed in, and
    // queueing a write there produced "session expired, nothing saved" as
    // the first thing a new teacher ever saw — a real error about a real
    // failed write, for a preference that had in fact been saved locally
    // and belongs to the device until an account exists.
    //
    // `hydrate` pushes the pending choice up at sign-in, so nothing is lost.
    if (get().signedIn) mirror.setLanguage?.(language);
  },

  setGradeTemplate: (template) => {
    set({ gradeTemplate: template });
    if (get().signedIn) mirror.setGradeTemplate?.(template);
  },

  setGradeTemplateFail: (template) => {
    set({ gradeTemplateFail: template });
    if (get().signedIn) mirror.setGradeTemplateFail?.(template);
  },

  markRepliesRead: () => {
    set((s) => ({
      replies: s.replies.map((r) => ({ ...r, unread: false })),
    }));
    mirror.markRepliesRead?.();
  },

  /**
   * Reading one reply marks that one read.
   *
   * Opening the tab used to mark every reply read, which meant a teacher
   * glancing at the badge lost the list of what they had not answered yet.
   * The unread mark is only useful if it survives being looked at.
   */
  markReplyRead: (id) => {
    if (!get().replies.some((r) => r.id === id && r.unread)) return;
    set((s) => ({
      replies: s.replies.map((r) => (r.id === id ? { ...r, unread: false } : r)),
    }));
    mirror.markReplyRead?.(id);
  },

  removeReply: (id) => {
    set((s) => ({ replies: s.replies.filter((r) => r.id !== id) }));
    mirror.deleteReply?.(id);
  },

  removeMessage: (id) => {
    set((s) => ({ messages: s.messages.filter((m) => m.id !== id) }));
    mirror.deleteMessage?.(id);
  },

  removeReplies: (ids) => {
    const gone = new Set(ids);
    set((s) => ({ replies: s.replies.filter((r) => !gone.has(r.id)) }));
    mirror.deleteReplies?.(ids);
  },

  removeMessages: (ids) => {
    const gone = new Set(ids);
    set((s) => ({ messages: s.messages.filter((m) => !gone.has(m.id)) }));
    mirror.deleteMessages?.(ids);
  },

  /**
   * Save an assessment and its marks together.
   *
   * Scores replace whatever was there for the same student, matching the
   * upsert on the server — a teacher re-entering a mark is correcting it.
   */
  saveAssessment: (assessment, scores) => {
    set((s) => {
      const others = s.grades.filter((g) => g.assessmentId !== assessment.id);
      const existing = new Map(
        s.grades.filter((g) => g.assessmentId === assessment.id).map((g) => [g.studentId, g]),
      );
      return {
        assessments: [assessment, ...s.assessments.filter((a) => a.id !== assessment.id)],
        grades: [
          ...others,
          ...scores.map(({ studentId, score }) => {
            const prior = existing.get(studentId);
            return {
              id: prior?.id ?? uid(),
              assessmentId: assessment.id,
              studentId,
              score,
              // A corrected mark has not been reported at its new value.
              notifiedAt: prior?.score === score ? prior?.notifiedAt : undefined,
            };
          }),
        ],
      };
    });
    mirror.saveAssessment?.(assessment, scores);
  },

  addTemplate: (title, body) => {
    const template = { id: uid(), title, body };
    set((s) => ({ templates: [...s.templates, template] }));
    mirror.createTemplate?.(template);
    return template.id;
  },

  updateTemplate: (id, patch) => {
    set((s) => ({
      templates: s.templates.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    }));
    mirror.updateTemplate?.(id, patch);
  },

  removeTemplate: (id) => {
    set((s) => ({ templates: s.templates.filter((x) => x.id !== id) }));
    mirror.deleteTemplate?.(id);
  },

  addAssessmentType: (groupId, name) => {
    const id = uid();
    // Appended, not sorted. "Test 1, Test 2, Final" is the order the
    // teacher thinks in, and alphabetical would put Final in the middle.
    const position = get().assessmentTypes.filter((x) => x.groupId === groupId).length;
    const type: AssessmentType = { id, groupId, name, position };
    set((s) => ({ assessmentTypes: [...s.assessmentTypes, type] }));
    mirror.createAssessmentType?.(type);
    return id;
  },

  removeAssessmentType: (id) => {
    set((s) => ({ assessmentTypes: s.assessmentTypes.filter((x) => x.id !== id) }));
    mirror.deleteAssessmentType?.(id);
  },

  removeAssessment: (id) => {
    set((s) => ({
      assessments: s.assessments.filter((a) => a.id !== id),
      grades: s.grades.filter((g) => g.assessmentId !== id),
    }));
    mirror.deleteAssessment?.(id);
  },
}));

/* -------------------------------------------------------------------------- */
/* Derived reads                                                              */
/* -------------------------------------------------------------------------- */

export const useGroups = () => useStore((s) => s.groups);
export const useStudents = () => useStore((s) => s.students);
export const useEvents = () => useStore((s) => s.events);

export const useTemplates = () => useStore((s) => s.templates);
export const useAssessments = () => useStore((s) => s.assessments);
export const useGrades = () => useStore((s) => s.grades);

/** How a percentage reads to a teacher scanning a list. */
export type GradeStanding = 'excellent' | 'good' | 'watch' | 'atRisk';

export function standingOf(percent: number): GradeStanding {
  if (percent >= 85) return 'excellent';
  if (percent >= 70) return 'good';
  if (percent >= 50) return 'watch';
  return 'atRisk';
}

/**
 * A student's average across assessments, as a percentage.
 *
 * Percentage rather than raw marks, because a quiz out of 20 and a final out of
 * 100 cannot be averaged as numbers without silently weighting the final five
 * times heavier. Each mark is normalised against its own `maxScore` first.
 *
 * Returns null when there is nothing to average — which the UI must show as
 * "not graded yet" rather than as a zero, since those mean opposite things.
 */
export function averagePercent(
  studentId: string,
  grades: Grade[],
  assessments: Assessment[],
  filter?: { groupId?: string; kind?: Assessment['kind'] },
): number | null {
  const byId = new Map(assessments.map((a) => [a.id, a]));
  const mine = grades.filter((g) => {
    if (g.studentId !== studentId) return false;
    const a = byId.get(g.assessmentId);
    if (!a) return false;
    if (filter?.groupId && a.groupId !== filter.groupId) return false;
    if (filter?.kind && a.kind !== filter.kind) return false;
    return true;
  });

  if (!mine.length) return null;

  const total = mine.reduce((sum, g) => {
    const a = byId.get(g.assessmentId)!;
    return sum + (g.score / a.maxScore) * 100;
  }, 0);
  return Math.round((total / mine.length) * 10) / 10;
}

export const useGroup = (id?: string) => useStore((s) => s.groups.find((g) => g.id === id));

export const useStudent = (id?: string) => useStore((s) => s.students.find((x) => x.id === id));

/**
 * Roster for one group, in seed order.
 *
 * The filter deliberately happens *outside* the selector: a selector that
 * builds a new array on every call fails zustand's snapshot equality check and
 * puts React into an infinite render loop.
 */
export const useRoster = (groupId?: string) => {
  const students = useStore((s) => s.students);
  return useMemo(
    () => students.filter((x) => !!groupId && x.groupIds.includes(groupId)),
    [groupId, students],
  );
};

export const useUnreadReplies = () => useStore((s) => s.replies.filter((r) => r.unread).length);

/**
 * True only when the app is running on seed data. Real accounts must never see
 * invented attendance — an unmarked session is unmarked, not a guess.
 */
/**
 * Whether past sessions may be back-filled with invented marks.
 *
 * Always false now. It existed for the seed data the app used to ship with, and
 * a public build has none — inventing attendance for a real student is not a
 * cosmetic problem, it would show a teacher absences that never happened and
 * put them in front of a parent.
 */
export const synthesiseHistory = () => false;

/**
 * Attendance for a session: the saved record if the teacher has touched it,
 * otherwise all-present, ready to be adjusted. On demo data, past sessions are
 * backfilled so the history screens have something to show.
 */
export function attendanceFor(
  key: string,
  roster: Student[],
  saved: Record<string, AttendanceRecord>,
  sessionEnd?: Date,
): AttendanceRecord {
  const stored = saved[key];
  if (stored) return stored;

  const inPast = sessionEnd ? sessionEnd.getTime() < Date.now() : false;
  const backfill = inPast && synthesiseHistory();
  const out: AttendanceRecord = {};
  for (const s of roster) out[s.id] = backfill ? historicMark(s.id, key) : 'present';
  return out;
}

/** Whether a session already has a teacher-saved record. */
export const isAttendanceSaved = (key: string) => !!useStore.getState().attendance[key];

/**
 * Attendance rate for a student (or a whole group) over the trailing `weeks`.
 *
 * Only sessions that were actually marked count. `rate` is null when there is
 * nothing to average — screens render that as "—" rather than inventing a
 * flattering 100%.
 */
export function attendanceRate(
  studentIds: string[],
  groupIds: string[],
  weeks = 8,
): { rate: number | null; sessions: number } {
  const { groups, attendance } = useStore.getState();
  const invent = synthesiseHistory();
  const now = new Date();
  let hits = 0;
  let total = 0;
  let sessions = 0;

  for (const g of groups) {
    if (!groupIds.includes(g.id)) continue;
    for (let d = 0; d < weeks * 7; d++) {
      const day = new Date(now);
      day.setDate(day.getDate() - d);
      const dow = day.getDay();
      for (const slot of g.slots) {
        if (slot.day !== dow) continue;
        const dateKey = toKey(day);
        if (at(dateKey, slot.end).getTime() > now.getTime()) continue;
        const key = `${g.id}@${dateKey}#${slot.start}`;
        const record = attendance[key];
        if (!record && !invent) continue; // Never marked — not evidence of anything.
        sessions++;
        for (const sid of studentIds) {
          // A register can exist without an entry for this student — they
          // joined after it was taken. Falling back to `historicMark` there
          // invented a mark for a real person on a real date.
          const mark = record?.[sid] ?? (invent ? historicMark(sid, key) : undefined);
          if (!mark) continue;
          total++;
          if (mark !== 'absent') hits++;
        }
      }
    }
  }

  return { rate: total ? Math.round((hits / total) * 100) : null, sessions };
}

/**
 * Attendance for one group on one day.
 *
 * Separate from `attendanceRate`, which averages eight weeks. A group screen
 * opened on a teaching day should answer "who is here today", and an eight-week
 * average cannot: it barely moves when someone is missing this morning, which
 * is exactly the thing worth noticing.
 *
 * Returns null when there is no session that day or it has not been marked —
 * both of which must read as "nothing to say", never as 0%.
 */
export function attendanceOnDay(
  groupId: string,
  date = new Date(),
): { rate: number | null; present: number; total: number; today: boolean } {
  const { groups, attendance, students } = useStore.getState();
  const group = groups.find((g) => g.id === groupId);
  const empty = { rate: null, present: 0, total: 0, today: false };
  if (!group) return empty;

  const dateKey = toKey(date);
  const slot = group.slots.find((s) => s.day === date.getDay());
  if (!slot) return empty;

  const record = attendance[`${groupId}@${dateKey}#${slot.start}`];
  if (!record) return empty;

  const roster = students.filter((s) => s.groupIds.includes(groupId));
  let present = 0;
  let total = 0;
  for (const s of roster) {
    const mark = record[s.id];
    if (!mark) continue;
    total++;
    if (mark !== 'absent') present++;
  }

  return {
    rate: total ? Math.round((present / total) * 100) : null,
    present,
    total,
    today: true,
  };
}

/**
 * A group's average, as a percentage, across every mark its students hold.
 *
 * Averages the students' own averages rather than every raw mark, so one
 * student who sat six tests does not outweigh five who sat one each — the
 * number is meant to describe the class, not the pile of paper.
 */
export function groupAveragePercent(groupId: string): number | null {
  const { students, grades, assessments } = useStore.getState();
  const roster = students.filter((s) => s.groupIds.includes(groupId));

  const averages = roster
    .map((s) => averagePercent(s.id, grades, assessments, { groupId }))
    .filter((n): n is number => n !== null);

  if (!averages.length) return null;
  return Math.round((averages.reduce((a, b) => a + b, 0) / averages.length) * 10) / 10;
}

/** Recent past sessions for one student, newest first. */
export function recentSessionsFor(student: Student, limit = 3) {
  const { groups, attendance } = useStore.getState();
  const invent = synthesiseHistory();
  const now = new Date();
  const out: {
    key: string;
    date: Date;
    group: Group;
    mark: AttendanceStatus;
  }[] = [];

  for (let d = 0; d < 60 && out.length < limit * 4; d++) {
    const day = new Date(now);
    day.setDate(day.getDate() - d);
    const dateKey = toKey(day);
    for (const g of groups) {
      if (!student.groupIds.includes(g.id)) continue;
      for (const slot of g.slots) {
        if (slot.day !== day.getDay()) continue;
        const end = at(dateKey, slot.end);
        if (end.getTime() > now.getTime()) continue;
        const key = `${g.id}@${dateKey}#${slot.start}`;
        const mark = attendance[key]?.[student.id];
        if (!mark && !invent) continue; // Show what was recorded, nothing more.
        out.push({
          key,
          date: end,
          group: g,
          mark: mark ?? historicMark(student.id, key),
        });
      }
    }
  }

  return out.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, limit);
}

/**
 * Keys of every session of these groups that has already finished, within the
 * trailing window. Derived from the schedule alone, so it answers "how many
 * classes have there been" whether or not anyone took a register.
 */
function pastSessionKeys(groups: Group[], groupIds: string[], weeks: number, now = new Date()) {
  const keys: string[] = [];
  for (const g of groups) {
    if (!groupIds.includes(g.id)) continue;
    for (let d = 0; d < weeks * 7; d++) {
      const day = new Date(now);
      day.setDate(day.getDate() - d);
      for (const slot of g.slots) {
        if (slot.day !== day.getDay()) continue;
        const dateKey = toKey(day);
        if (at(dateKey, slot.end).getTime() > now.getTime()) continue;
        keys.push(`${g.id}@${dateKey}#${slot.start}`);
      }
    }
  }
  return keys;
}

/**
 * The three numbers on a student's profile, recomputed whenever their sources
 * change.
 *
 * A hook rather than a plain function on purpose. The previous code called
 * `attendanceRate()` inside a `useMemo` keyed on the student object, but that
 * function reads the store imperatively: marking a register or entering a grade
 * changes neither the student nor their identity, so the memo never
 * invalidated and the tiles kept whatever they showed when the screen opened.
 *
 * The three numbers answer deliberately different questions:
 *
 *  - `sessions` — classes actually held. Schedule-derived, so it is a real
 *    number from the first week, not a zero waiting on paperwork.
 *  - `rate` — attendance across the sessions someone marked. Null when none
 *    were: an unmarked register is missing evidence, not a 0%.
 *  - `average` — marks normalised per assessment (see `averagePercent`), never
 *    the legacy `students.avg_score` column, which the grading feature does not
 *    write and which therefore sat empty on every real account.
 */
export function useStudentStats(student?: Student, weeks = 8) {
  const groups = useStore((s) => s.groups);
  const attendance = useStore((s) => s.attendance);
  const grades = useStore((s) => s.grades);
  const assessments = useStore((s) => s.assessments);

  return useMemo(() => {
    if (!student) return { rate: null, sessions: 0, marked: 0, average: null };

    const keys = pastSessionKeys(groups, student.groupIds, weeks);
    let present = 0;
    let marked = 0;

    for (const key of keys) {
      // Only this student's own mark counts. A register that predates them
      // simply has no entry, and inventing one would show a teacher absences
      // that never happened.
      const mark = attendance[key]?.[student.id];
      if (!mark) continue;
      marked++;
      if (mark !== 'absent') present++;
    }

    return {
      rate: marked ? Math.round((present / marked) * 100) : null,
      sessions: keys.length,
      marked,
      average: averagePercent(student.id, grades, assessments),
    };
  }, [student, groups, attendance, grades, assessments, weeks]);
}

/**
 * Recent marked sessions for a student, as a hook.
 *
 * Same staleness problem as the stats above: `recentSessionsFor` reads the
 * store imperatively, so the list did not refresh after taking a register.
 */
export function useRecentSessions(student?: Student, limit = 3) {
  const attendance = useStore((s) => s.attendance);
  const groups = useStore((s) => s.groups);

  return useMemo(
    () => (student ? recentSessionsFor(student, limit) : []),
    // `recentSessionsFor` reads these from the store; they are dependencies
    // even though they are not named in the call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [student, limit, attendance, groups],
  );
}

/** Absences for a student in a group over the trailing `weeks` — the roster badge. */
export function absenceCount(studentId: string, groupId: string, weeks = 6) {
  const { groups, attendance } = useStore.getState();
  const g = groups.find((x) => x.id === groupId);
  if (!g) return 0;
  const invent = synthesiseHistory();
  const now = new Date();
  let n = 0;

  for (let d = 0; d < weeks * 7; d++) {
    const day = new Date(now);
    day.setDate(day.getDate() - d);
    const dateKey = toKey(day);
    for (const slot of g.slots) {
      if (slot.day !== day.getDay()) continue;
      if (at(dateKey, slot.end).getTime() > now.getTime()) continue;
      const key = `${g.id}@${dateKey}#${slot.start}`;
      const mark = attendance[key]?.[studentId] ?? (invent ? historicMark(studentId, key) : null);
      if (mark === 'absent') n++;
    }
  }
  return n;
}

export type { Group, Message, Reply, Student, Session, AttendanceStatus };

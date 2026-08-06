import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { seedGroups, seedMessages, seedReplies, seedStudents, teacher } from '@/data/seed';
import type {
  Assessment,
  AttendanceRecord,
  AttendanceStatus,
  Audience,
  CalendarEvent,
  Channel,
  Grade,
  Group,
  Message,
  Reply,
  Session,
  Student,
} from '@/data/types';
import { at, toKey } from '@/lib/date';
import { hasSupabase } from '@/lib/supabase';
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
   * Explore-without-an-account mode. Everything works against the seed data and
   * nothing is mirrored to Supabase — see `enqueue` in `data/sync.ts`. Entered
   * from the sign-in screen's skip button, which only renders in dev builds.
   */
  demo: boolean;
  teacherName: string;
  teacherEmail: string | null;
  teacherAvatarUrl: string | null;
  /** 'google' | 'apple' | 'email' | 'demo'. */
  teacherProvider: string;
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
  /** One mark per student per assessment. */
  grades: Grade[];

  /** Local class reminders: off, or how many minutes before the start. */
  remindersOn: boolean;
  reminderLead: ReminderLead;

  signIn: (name?: string) => void;
  signOut: () => void;
  enterDemoMode: () => void;

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

  saveAssessment: (
    assessment: Assessment,
    scores: { studentId: string; score: number }[],
  ) => void;
  removeAssessment: (id: string) => void;

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
  saveAttendance: (key: string, marks: AttendanceRecord) => void;
  sendMessage: (input: {
    groupIds: string[];
    audience: Audience;
    channels: Channel[];
    body: string;
    announcement?: boolean;
  }) => void;
  markRepliesRead: () => void;
  markReplyRead: (id: string) => void;
  deleteReply: (id: string) => void;
  deleteMessage: (id: string) => void;
  saveAssessment: (
    assessment: Assessment,
    scores: { studentId: string; score: number }[],
  ) => void;
  deleteAssessment: (id: string) => void;
  createEvent: (event: CalendarEvent) => void;
  updateEvent: (id: string, patch: Partial<Omit<CalendarEvent, 'id'>>) => void;
  deleteEvent: (id: string) => void;
};

let mirror: Partial<StoreMirror> = {};
export const setStoreMirror = (m: Partial<StoreMirror>) => {
  mirror = m;
};

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      signedIn: false,
      demo: false,
      teacherName: teacher.name,
      teacherEmail: teacher.email,
      teacherAvatarUrl: null,
      teacherProvider: 'demo',
      groups: seedGroups,
      students: seedStudents,
      attendance: {},
      messages: seedMessages,
      replies: seedReplies,
      events: [],
      assessments: [],
      grades: [],
      remindersOn: false,
      reminderLead: 15,

      signIn: (name) => set((s) => ({ signedIn: true, teacherName: name ?? s.teacherName })),
      signOut: () => set({ signedIn: false, demo: false }),
      enterDemoMode: () => set({ signedIn: true, demo: true }),

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
            st.groupIds.includes(id)
              ? { ...st, groupIds: st.groupIds.filter((g) => g !== id) }
              : st,
          ),
        }));
        mirror.deleteGroup?.(id);
      },

      addStudent: (input) => {
        const id = uid();
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
              groupIds: isMember
                ? st.groupIds.filter((g) => g !== groupId)
                : [...st.groupIds, groupId],
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
            assessments: [
              assessment,
              ...s.assessments.filter((a) => a.id !== assessment.id),
            ],
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

      removeAssessment: (id) => {
        set((s) => ({
          assessments: s.assessments.filter((a) => a.id !== id),
          grades: s.grades.filter((g) => g.assessmentId !== id),
        }));
        mirror.deleteAssessment?.(id);
      },
    }),
    {
      name: 'classcare-v1',
      storage: createJSONStorage(() => AsyncStorage),
      // Seeded collections are code, not user data — only persist what changed.
      partialize: (s) => ({
        signedIn: s.signedIn,
        demo: s.demo,
        teacherName: s.teacherName,
        teacherEmail: s.teacherEmail,
        teacherAvatarUrl: s.teacherAvatarUrl,
        teacherProvider: s.teacherProvider,
        groups: s.groups,
        students: s.students,
        attendance: s.attendance,
        messages: s.messages,
        replies: s.replies,
        events: s.events,
        assessments: s.assessments,
        grades: s.grades,
        remindersOn: s.remindersOn,
        reminderLead: s.reminderLead,
      }),
    },
  ),
);

/* -------------------------------------------------------------------------- */
/* Derived reads                                                              */
/* -------------------------------------------------------------------------- */

export const useGroups = () => useStore((s) => s.groups);
export const useStudents = () => useStore((s) => s.students);
export const useEvents = () => useStore((s) => s.events);

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
export const synthesiseHistory = () => useStore.getState().demo || !hasSupabase;

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
          const mark = record?.[sid] ?? historicMark(sid, key);
          total++;
          if (mark !== 'absent') hits++;
        }
      }
    }
  }

  return { rate: total ? Math.round((hits / total) * 100) : null, sessions };
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

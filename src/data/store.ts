import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { seedGroups, seedMessages, seedReplies, seedStudents, teacher } from '@/data/seed';
import type {
  AttendanceRecord,
  AttendanceStatus,
  Audience,
  Channel,
  Group,
  Message,
  Reply,
  Session,
  Student,
} from '@/data/types';
import { at, toKey } from '@/lib/date';
import { hasSupabase } from '@/lib/supabase';
import { accentNames } from '@/theme';

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

  signIn: (name?: string) => void;
  signOut: () => void;
  enterDemoMode: () => void;

  addGroup: (g: Omit<Group, 'id' | 'accent'> & { accent?: Group['accent'] }) => string;
  addStudent: (s: NewStudent) => string;
  updateStudent: (id: string, patch: Partial<Student>) => void;
  removeStudent: (id: string) => void;

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
};

const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Optional write-through to the backend.
 *
 * `data/sync.ts` registers itself here at startup. Keeping it a callback rather
 * than an import means the store has no dependency on Supabase at all — the app
 * runs on seed data when no project is configured, and there is no import cycle
 * between the store and the repository layer.
 */
export type StoreMirror = {
  createGroup: (group: Omit<Group, 'id'>, localId: string) => void;
  createStudent: (student: Omit<Student, 'id'>, localId: string) => void;
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

      signIn: (name) => set((s) => ({ signedIn: true, teacherName: name ?? s.teacherName })),
      signOut: () => set({ signedIn: false, demo: false }),
      enterDemoMode: () => set({ signedIn: true, demo: true }),

      addGroup: (g) => {
        const id = uid('g');
        const group = {
          ...g,
          id,
          accent: g.accent ?? accentNames[get().groups.length % accentNames.length],
        };
        set((s) => ({ groups: [...s.groups, group] }));
        mirror.createGroup?.(group, id);
        return id;
      },

      addStudent: (input) => {
        const id = uid('s');
        const student: Student = {
          ...input,
          id,
          accent: accentNames[get().students.length % accentNames.length],
        };
        set((s) => ({ students: [...s.students, student] }));
        mirror.createStudent?.(student, id);
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

      saveAttendance: (key, record) => {
        set((s) => ({ attendance: { ...s.attendance, [key]: record } }));
        mirror.saveAttendance?.(key, record);
      },

      sendMessage: ({ groupIds, audience, channels, body, total, announcement }) => {
        set((s) => ({
          messages: [
            {
              id: uid('m'),
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
      }),
    },
  ),
);

/* -------------------------------------------------------------------------- */
/* Derived reads                                                              */
/* -------------------------------------------------------------------------- */

export const useGroups = () => useStore((s) => s.groups);
export const useStudents = () => useStore((s) => s.students);

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

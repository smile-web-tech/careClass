import * as api from '@/data/api';
import { setStoreMirror, useStore, type StoreMirror } from '@/data/store';
import type { AttendanceStatus, CalendarEvent, Group, Student } from '@/data/types';
import { hasSupabase } from '@/lib/supabase';

/**
 * The bridge between the local store and Supabase.
 *
 * The store stays the single source of truth the UI reads from — screens never
 * await the network. Writes apply locally first and are mirrored to Supabase in
 * the background, which is what makes taking attendance work on the flaky wifi
 * of a rented classroom. `hydrate()` pulls the authoritative state back.
 *
 * With no backend configured every function here is a no-op and the app runs
 * entirely on the seed data.
 */

let pending: Promise<unknown> = Promise.resolve();

/** Serialise remote writes so a rapid save/edit pair cannot land out of order. */
function enqueue(work: () => Promise<unknown>) {
  if (!hasSupabase) return;
  // Demo mode has no session; firing these would just log a wall of 401s.
  if (useStore.getState().demo) return;
  pending = pending.then(work).catch((e) => {
    // Surfacing this properly (a retry queue + an offline banner) is the next
    // step; losing the error silently would be worse than logging it.
    console.warn('[classcare] remote write failed:', e);
  });
}

/** Replace local state with what the server has. Call after sign-in and on focus. */
export async function hydrate() {
  if (!hasSupabase) return;

  const [teacher, groups, students, attendance, messages, replies] = await Promise.all([
    api.fetchTeacher(),
    api.fetchGroups(),
    api.fetchStudents(),
    api.fetchAttendance(),
    api.fetchMessages(),
    api.fetchReplies(),
  ]);

  // Fetched separately and tolerantly: `calendar_events` arrived in migration
  // 0002, so a project still on 0001 returns "relation does not exist". Inside
  // the Promise.all above that one rejection would discard the groups, students
  // and attendance that loaded perfectly well beside it.
  let events: Awaited<ReturnType<typeof api.fetchEvents>> | null = null;
  try {
    events = await api.fetchEvents();
  } catch (e) {
    console.warn('[classcare] events unavailable — apply migration 0002:', e);
  }

  useStore.setState({
    groups,
    students,
    attendance,
    messages,
    replies,
    // Keep whatever is already local when the table is not there yet.
    ...(events ? { events } : {}),
    ...(teacher && {
      teacherName: teacher.name || useStore.getState().teacherName,
      teacherEmail: teacher.email,
      teacherAvatarUrl: teacher.avatarUrl,
      teacherProvider: teacher.provider,
    }),
  });
}

export const remote: StoreMirror = {
  createGroup: (group, localId: string) =>
    enqueue(async () => {
      const saved = await api.createGroup(group);
      // Swap the optimistic local id for the server's so later writes address
      // the right row.
      useStore.setState((s) => ({
        groups: s.groups.map((g) => (g.id === localId ? { ...g, id: saved.id } : g)),
        students: s.students.map((st) =>
          st.groupIds.includes(localId)
            ? {
                ...st,
                groupIds: st.groupIds.map((id) => (id === localId ? saved.id : id)),
              }
            : st,
        ),
      }));
    }),

  updateGroup: (id: string, patch: Partial<Omit<Group, 'id'>>) =>
    enqueue(() => api.updateGroup(id, patch)),

  deleteGroup: (id: string) => enqueue(() => api.deleteGroup(id)),

  createStudent: (student: Omit<Student, 'id'>, localId: string): void =>
    enqueue(async () => {
      const saved = await api.createStudent(student);
      useStore.setState((s) => ({
        students: s.students.map((x) => (x.id === localId ? { ...x, id: saved.id } : x)),
      }));
    }),

  updateStudent: (id: string, patch: Partial<Student>) =>
    enqueue(() => api.updateStudent(id, patch)),

  archiveStudent: (id: string) => enqueue(() => api.archiveStudent(id)),

  saveAttendance: (key: string, marks: Record<string, AttendanceStatus>) =>
    enqueue(() => {
      // key === `${groupId}@${YYYY-MM-DD}#${HH:MM}`
      const [groupId, rest] = key.split('@');
      const [date, start] = rest.split('#');
      return api.saveAttendance(groupId, date, start, marks);
    }),

  sendMessage: (input) =>
    enqueue(async () => {
      await api.sendMessage(input);
      // The function computes the real recipient count and delivery states, so
      // re-read rather than trusting the optimistic row.
      useStore.setState({ messages: await api.fetchMessages() });
    }),

  markRepliesRead: () => enqueue(() => api.markRepliesRead()),

  createEvent: (event: Omit<CalendarEvent, 'id'>, localId: string) =>
    enqueue(async () => {
      const saved = await api.createEvent(event);
      // Swap the optimistic local id for the server's, so a later edit or
      // delete addresses the real row rather than a id that never existed.
      useStore.setState((s) => ({
        events: s.events.map((e) => (e.id === localId ? { ...e, id: saved.id } : e)),
      }));
    }),

  updateEvent: (id: string, patch: Partial<Omit<CalendarEvent, 'id'>>) =>
    enqueue(() => api.updateEvent(id, patch)),

  deleteEvent: (id: string) => enqueue(() => api.deleteEvent(id)),
};

/** Install the write-through mirror. Called once from the root layout. */
export function installSync() {
  if (hasSupabase) setStoreMirror(remote);
}

/** Keep the inbox badge honest — replies arrive from webhooks, not from us. */
export function watchInbox() {
  if (!hasSupabase) return () => {};
  return api.subscribeToInbox(async () => {
    const [messages, replies] = await Promise.all([api.fetchMessages(), api.fetchReplies()]);
    useStore.setState({ messages, replies });
  });
}

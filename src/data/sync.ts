import * as api from '@/data/api';
import { setStoreMirror, useStore, type StoreMirror } from '@/data/store';
import { useSyncStatus } from '@/data/syncStatus';
import type {
  Assessment,
  AttendanceStatus,
  CalendarEvent,
  Group,
  MessageTemplate,
  Student,
} from '@/data/types';
import { isLanguage, setActiveLanguage, type Language } from '@/i18n';
import { describeError, isOfflineError } from '@/lib/errors';
import { hasSupabase, supabaseUrl } from '@/lib/supabase';

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

/* -------------------------------------------------------------------------- */
/* Write queue                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Pending remote writes, oldest first.
 *
 * This used to be a promise chain whose `.catch` logged and moved on, which is
 * how a group could exist on the device and nowhere else: the teacher created
 * it on a dead connection, the write was dropped, nothing said so, and the
 * failure only surfaced days later as "that group does not exist on the server"
 * when they tried to message it.
 *
 * Now a write that fails because the server is unreachable stays at the head of
 * the queue and is retried — on a timer, when the app is brought forward, and
 * when the teacher taps Retry. Order is preserved throughout, because a rapid
 * create-then-edit pair applied backwards is worse than either failing.
 *
 * Not persisted across launches, and that is deliberate: `hydrate()` replaces
 * local state with the server's on every start, so a queue that outlived the
 * process would be trying to push changes the app had already thrown away.
 */
type QueuedWrite = { run: () => Promise<unknown>; label: string; attempts: number };

const queue: QueuedWrite[] = [];
let draining = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/** Backoff, capped. Long enough to be polite, short enough to feel automatic. */
const retryDelay = (attempts: number) => Math.min(2 ** attempts * 1000, 30_000);

function publish() {
  useSyncStatus.getState().report({ pending: queue.length });
}

function scheduleRetry(attempts: number) {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void drain();
  }, retryDelay(attempts));
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;

  try {
    while (queue.length) {
      const job = queue[0];
      try {
        await job.run();
        queue.shift();
        publish();
        useSyncStatus.getState().report({ offline: false });
      } catch (e) {
        if (isOfflineError(e)) {
          // Keep it. The change is still good; the network is not.
          job.attempts += 1;
          useSyncStatus.getState().report({ offline: true });
          scheduleRetry(job.attempts);
          return;
        }

        // Retrying will not fix a rejected write — a violated constraint, an
        // expired session, a row the teacher may not touch. Drop it so one bad
        // write cannot wedge every good one behind it, and say what happened.
        queue.shift();
        publish();
        const described = describeError(e);
        console.warn(`[classcare] ${job.label} failed permanently:`, described.detail);
        useSyncStatus.getState().report({
          offline: false,
          failure: `${job.label} could not be saved. ${described.message}`,
        });
      }
    }
  } finally {
    draining = false;
  }
}

/**
 * Queue a remote write.
 *
 * `label` is shown to the teacher if the write is ultimately rejected, so it
 * reads as a thing they did — "New group", not "createGroup".
 */
function enqueue(work: () => Promise<unknown>, label: string) {
  if (!hasSupabase) return;
  queue.push({ run: work, label, attempts: 0 });
  publish();
  void drain();
}

/**
 * Can the server be reached right now?
 *
 * Used to refuse a create outright rather than accepting it locally and finding
 * out later. Attendance is different and stays optimistic — marking a register
 * on classroom wifi is the whole reason the app works offline — but a group or
 * a student created on a dead connection is a trap: it looks saved, and the
 * failure surfaces days later as "that group does not exist on the server".
 *
 * `/auth/v1/health` needs no credentials and is one of the paths the PHP
 * reverse proxy carries, so this measures the route the app actually uses
 * rather than the internet in general.
 */
export async function isReachable(timeoutMs = 5000): Promise<boolean> {
  if (!hasSupabase) return true;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    // Any HTTP answer proves the round trip. A 401 or a 404 still means the
    // phone reached the server, which is the only question being asked.
    await fetch(`${supabaseUrl}/auth/v1/health`, { signal: abort.signal });
    useSyncStatus.getState().report({ offline: false });
    return true;
  } catch {
    useSyncStatus.getState().report({ offline: true });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Try the queue again now — app foreground, and the Retry button via
 * `retryNow`.
 *
 * Resolves once the queue is empty or has stalled again, so the caller can show
 * a spinner for as long as it is actually doing something.
 */
export async function flushWrites() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  await drain();
  return queue.length === 0;
}

/**
 * What the Retry button does.
 *
 * Draining the queue is not enough on its own: the offline flag is also raised
 * by `isReachable()` refusing a create, and that path queues nothing. Retry
 * would then run a `while (queue.length)` loop zero times, change nothing, and
 * leave the banner up — a button that visibly does nothing. So re-probe first,
 * which is what actually clears the flag, and only then push any pending work.
 */
export async function retryNow() {
  const online = await isReachable();
  if (!online) return false;
  await flushWrites();
  return true;
}

/** Replace local state with what the server has. Call after sign-in and on focus. */
export async function hydrate() {
  if (!hasSupabase) return;

  const [teacher, groups, students, attendance, messages, replies, assessments, grades, templates] =
    await Promise.all([
      api.fetchTeacher(),
      api.fetchGroups(),
      api.fetchStudents(),
      api.fetchAttendance(),
      api.fetchMessages(),
      api.fetchReplies(),
      api.fetchAssessments(),
      api.fetchGrades(),
      api.fetchTemplates(),
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
    assessments,
    grades,
    templates,
    // Keep whatever is already local when the table is not there yet.
    ...(events ? { events } : {}),
    ...(teacher && {
      teacherName: teacher.name || useStore.getState().teacherName,
      teacherEmail: teacher.email,
      teacherAvatarUrl: teacher.avatarUrl,
      teacherProvider: teacher.provider,
    }),
  });

  if (teacher) reconcileLanguage(teacher.language);
}

/**
 * Settle which language wins once an account is in the picture.
 *
 * Before sign-in the picker writes locally only — see `setLanguage` — so this
 * is where a choice made on the welcome screen finally reaches the account.
 * Without it that choice would live on the device forever and the Edge
 * Functions would keep writing to parents in the wrong language.
 *
 * A deliberate pick beats the stored value, including on a second device: the
 * teacher changing it is a newer statement of intent than a column written
 * months ago. Only an untouched install adopts what the server holds.
 */
function reconcileLanguage(remote: string | null) {
  const { language, languageChosen } = useStore.getState();

  if (languageChosen) {
    if (remote !== language) enqueue(() => api.updateTeacher({ language }), 'Language');
    return;
  }

  if (remote && remote !== language && isLanguage(remote)) {
    setActiveLanguage(remote);
    useStore.setState({ language: remote, languageChosen: true });
  }
}

export const remote: StoreMirror = {
  // No id rewriting here any more: the store mints a UUID and the row is
  // inserted under it, so the id the UI already holds is the real one.
  createGroup: (group: Group) => enqueue(() => api.createGroup(group), 'New group'),

  updateGroup: (id: string, patch: Partial<Omit<Group, 'id'>>) =>
    enqueue(() => api.updateGroup(id, patch), 'Group changes'),

  deleteGroup: (id: string) => enqueue(() => api.deleteGroup(id), 'Deleting the group'),

  createStudent: (student: Student) => enqueue(() => api.createStudent(student), 'New student'),

  updateStudent: (id: string, patch: Partial<Student>) =>
    enqueue(() => api.updateStudent(id, patch), 'Student changes'),

  archiveStudent: (id: string) => enqueue(() => api.archiveStudent(id), 'Removing the student'),

  saveAttendance: (key: string, marks: Record<string, AttendanceStatus>) =>
    enqueue(() => {
      // key === `${groupId}@${YYYY-MM-DD}#${HH:MM}`
      const [groupId, rest] = key.split('@');
      const [date, start] = rest.split('#');
      return api.saveAttendance(groupId, date, start, marks);
    }, 'Attendance'),

  sendMessage: (input) =>
    enqueue(async () => {
      await api.sendMessage(input);
      // The function computes the real recipient count and delivery states, so
      // re-read rather than trusting the optimistic row.
      useStore.setState({ messages: await api.fetchMessages() });
    }, 'Your message'),

  setLanguage: (language: Language) => enqueue(() => api.updateTeacher({ language }), 'Language'),

  markRepliesRead: () => enqueue(() => api.markRepliesRead(), 'Marking replies read'),

  markReplyRead: (id: string) => enqueue(() => api.markReplyRead(id), 'Marking a reply read'),

  deleteReply: (id: string) => enqueue(() => api.deleteReply(id), 'Deleting the reply'),

  deleteMessage: (id: string) => enqueue(() => api.deleteMessage(id), 'Deleting the message'),
  deleteReplies: (ids: string[]) => enqueue(() => api.deleteReplies(ids), 'Deleting replies'),
  deleteMessages: (ids: string[]) => enqueue(() => api.deleteMessages(ids), 'Deleting messages'),

  saveAssessment: (assessment: Assessment, scores: { studentId: string; score: number }[]) =>
    enqueue(() => api.saveAssessment(assessment, scores), 'Grades'),

  deleteAssessment: (id: string) => enqueue(() => api.deleteAssessment(id), 'Deleting the grades'),

  createTemplate: (template: MessageTemplate) =>
    enqueue(() => api.createTemplate(template), 'New template'),

  updateTemplate: (id: string, patch: Partial<Omit<MessageTemplate, 'id'>>) =>
    enqueue(() => api.updateTemplate(id, patch), 'Template changes'),

  deleteTemplate: (id: string) => enqueue(() => api.deleteTemplate(id), 'Deleting the template'),

  createEvent: (event: CalendarEvent) => enqueue(() => api.createEvent(event), 'New event'),

  updateEvent: (id: string, patch: Partial<Omit<CalendarEvent, 'id'>>) =>
    enqueue(() => api.updateEvent(id, patch), 'Event changes'),

  deleteEvent: (id: string) => enqueue(() => api.deleteEvent(id), 'Deleting the event'),
};

/** Install the write-through mirror. Called once from the root layout. */
export function installSync() {
  if (hasSupabase) setStoreMirror(remote);
}

/**
 * Re-read the outbox and inbox.
 *
 * Both arrive from outside the app — delivery receipts from the gateways,
 * replies from whatever writes to `replies` — so nothing the teacher does
 * locally can bring them in. Hence a manual pull as well as the subscription.
 */
export async function refreshInbox() {
  if (!hasSupabase) return;
  const [messages, replies] = await Promise.all([api.fetchMessages(), api.fetchReplies()]);
  useStore.setState({ messages, replies });
}

/**
 * Re-read grades after the server has changed them behind the app's back.
 *
 * `send-grades` stamps `notified_at` on the rows it managed to send, and the
 * store has no way to know which those were — a partial send stamps some and
 * not others. Without this the grading screen keeps saying "unreported" about
 * marks the student has already been told, which is worse than saying nothing:
 * it invites the teacher to send the same result twice.
 */
export async function refreshGrades() {
  if (!hasSupabase) return;
  useStore.setState({ grades: await api.fetchGrades() });
}

/** Keep the inbox badge honest — replies arrive from webhooks, not from us. */
export function watchInbox() {
  if (!hasSupabase) return () => {};
  return api.subscribeToInbox(refreshInbox);
}

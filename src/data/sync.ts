import * as api from '@/data/api';
import { loadSnapshot, readOutbox, replaceOutbox, writeSetting } from '@/data/localDb';
import { setStoreMirror, useStore, type StoreMirror } from '@/data/store';
import { useSyncStatus } from '@/data/syncStatus';
import type {
  Assessment,
  AssessmentType,
  AttendanceStatus,
  Audience,
  CalendarEvent,
  Channel,
  Group,
  MessageTemplate,
  SentMessageLog,
  Student,
} from '@/data/types';
import { isLanguage, setActiveLanguage, type Language, type TranslationKey } from '@/i18n';
import { translateNow } from '@/i18n/useT';
import { describeError, isOfflineError } from '@/lib/errors';
import { photoFile, syncMissingPhotos, uploadPhoto } from '@/lib/studentPhoto';
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
 * One pending change, described rather than closed over.
 *
 * The queue used to hold `() => Promise` closures, which cannot be written to
 * disk — so everything waiting to sync died with the process. On a connection
 * that comes and goes for days that is the whole feature missing: a teacher
 * takes a register in a basement classroom, the app is killed by the OS before
 * they surface, and the register is gone. Worse, `hydrate()` then pulled the
 * server's version over the top, so the loss was silent and total.
 *
 * Describing each write as data instead makes it storable, replayable in order
 * after a relaunch, and countable for the button on the home screen.
 */
export type Op =
  | { kind: 'group.create'; group: Group }
  | { kind: 'group.update'; id: string; patch: Partial<Omit<Group, 'id'>> }
  | { kind: 'group.delete'; id: string }
  | { kind: 'student.create'; student: Student }
  | { kind: 'student.update'; id: string; patch: Partial<Student> }
  | { kind: 'student.archive'; id: string }
  /**
   * Send a student's picture up and record the path on their row.
   *
   * A queued op rather than an upload at save time: the photo is taken in a
   * classroom as often as not, and the teacher should not have to be online to
   * put a face on a student. The file is already on the device; this is only
   * the trip to the server.
   */
  | { kind: 'student.photo'; id: string }
  | { kind: 'attendance.save'; key: string; marks: Record<string, AttendanceStatus> }
  | {
      kind: 'message.send';
      input: {
        groupIds: string[];
        audience: Audience;
        channels: Channel[];
        body: string;
        announcement?: boolean;
      };
    }
  /**
   * A send the device made itself, on its way to the message log.
   *
   * Carries its own row id, so replaying it after a failed connection updates
   * the same record rather than logging the send twice.
   */
  | { kind: 'message.log'; entry: SentMessageLog }
  | { kind: 'message.delete'; id: string }
  | { kind: 'messages.delete'; ids: string[] }
  | { kind: 'reply.read'; id: string }
  | { kind: 'replies.read' }
  | { kind: 'reply.delete'; id: string }
  | { kind: 'replies.delete'; ids: string[] }
  | {
      kind: 'assessment.save';
      assessment: Assessment;
      scores: { studentId: string; score: number }[];
    }
  | { kind: 'assessment.delete'; id: string }
  | { kind: 'assessmentType.create'; type: AssessmentType }
  | { kind: 'assessmentType.delete'; id: string }
  | { kind: 'template.create'; template: MessageTemplate }
  | { kind: 'template.update'; id: string; patch: Partial<Omit<MessageTemplate, 'id'>> }
  | { kind: 'template.delete'; id: string }
  | { kind: 'event.create'; event: CalendarEvent }
  | { kind: 'event.update'; id: string; patch: Partial<Omit<CalendarEvent, 'id'>> }
  | { kind: 'event.delete'; id: string }
  | { kind: 'teacher.language'; language: Language }
  | { kind: 'teacher.gradeTemplate'; template: string | null }
  | { kind: 'teacher.gradeTemplateFail'; template: string | null };

/**
 * Upload one student's picture, then point their row at it.
 *
 * Two steps, in this order. A row that names a file which is not there yet
 * would have every other device trying to download nothing.
 *
 * A student whose photo has since been deleted from the device is not an
 * error: the teacher removed it, the row is cleared, and the op is done.
 */
async function uploadStudentPhoto(studentId: string) {
  if (!photoFile(studentId).exists) {
    await api.updateStudent(studentId, { photoPath: undefined });
    useStore.setState((state) => ({
      students: state.students.map((s) =>
        s.id === studentId ? { ...s, photoPath: undefined } : s,
      ),
    }));
    return;
  }

  const path = await uploadPhoto(studentId);
  await api.updateStudent(studentId, { photoPath: path });
  useStore.setState((state) => ({
    students: state.students.map((s) => (s.id === studentId ? { ...s, photoPath: path } : s)),
  }));
}

/** Perform one queued change against the server. */
function perform(op: Op): Promise<unknown> {
  switch (op.kind) {
    case 'group.create':
      return api.createGroup(op.group);
    case 'group.update':
      return api.updateGroup(op.id, op.patch);
    case 'group.delete':
      return api.deleteGroup(op.id);
    case 'student.create':
      return api.createStudent(op.student);
    case 'student.update':
      return api.updateStudent(op.id, op.patch);
    case 'student.archive':
      return api.archiveStudent(op.id);
    case 'student.photo':
      return uploadStudentPhoto(op.id);
    case 'attendance.save': {
      // key === `${groupId}@${YYYY-MM-DD}#${HH:MM}`
      const [groupId, rest] = op.key.split('@');
      const [date, start] = rest.split('#');
      return api.saveAttendance(groupId, date, start, op.marks);
    }
    case 'message.send':
      return api.sendMessage(op.input).then(async () => {
        // The function computes the real recipient count and delivery states,
        // so re-read rather than trusting the optimistic row.
        useStore.setState({ messages: await api.fetchMessages() });
      });
    case 'message.log':
      return api.logSentMessage(op.entry);
    case 'message.delete':
      return api.deleteMessage(op.id);
    case 'messages.delete':
      return api.deleteMessages(op.ids);
    case 'reply.read':
      return api.markReplyRead(op.id);
    case 'replies.read':
      return api.markRepliesRead();
    case 'reply.delete':
      return api.deleteReply(op.id);
    case 'replies.delete':
      return api.deleteReplies(op.ids);
    case 'assessment.save':
      return api.saveAssessment(op.assessment, op.scores);
    case 'assessment.delete':
      return api.deleteAssessment(op.id);
    case 'assessmentType.create':
      return api.createAssessmentType(op.type);
    case 'assessmentType.delete':
      return api.deleteAssessmentType(op.id);
    case 'template.create':
      return api.createTemplate(op.template);
    case 'template.update':
      return api.updateTemplate(op.id, op.patch);
    case 'template.delete':
      return api.deleteTemplate(op.id);
    case 'event.create':
      return api.createEvent(op.event);
    case 'event.update':
      return api.updateEvent(op.id, op.patch);
    case 'event.delete':
      return api.deleteEvent(op.id);
    case 'teacher.language':
      return api.updateTeacher({ language: op.language });
    case 'teacher.gradeTemplate':
      return api.updateTeacher({ gradeTemplate: op.template });
    case 'teacher.gradeTemplateFail':
      return api.updateTeacher({ gradeTemplateFail: op.template });
  }
}

/**
 * What the teacher calls the thing that failed.
 *
 * Shown as "Attendance could not be saved", so it has to read as something they
 * did rather than as a function name — and in their own language, which the
 * previous English labels were not.
 */
function labelOf(op: Op): string {
  const key: TranslationKey = op.kind.startsWith('group.')
    ? 'sync.item.group'
    : op.kind.startsWith('student.')
      ? 'sync.item.student'
      : op.kind.startsWith('attendance.')
        ? 'sync.item.attendance'
        : op.kind.startsWith('assessment')
          ? 'sync.item.grades'
          : op.kind.startsWith('template.')
            ? 'sync.item.template'
            : op.kind.startsWith('event.')
              ? 'sync.item.event'
              : op.kind.startsWith('repl')
                ? 'sync.item.reply'
                : op.kind === 'teacher.language'
                  ? 'sync.item.language'
                  : op.kind.startsWith('teacher.gradeTemplate')
                    ? 'sync.item.template'
                    : 'sync.item.message';
  return translateNow(key);
}

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
 * when the teacher taps Sync. Order is preserved throughout, because a rapid
 * create-then-edit pair applied backwards is worse than either failing.
 */
type QueuedWrite = { op: Op; attempts: number };

const queue: QueuedWrite[] = [];
let draining = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/** Backoff, capped. Long enough to be polite, short enough to feel automatic. */
const retryDelay = (attempts: number) => Math.min(2 ** attempts * 1000, 30_000);

/* ------------------------------ persistence ------------------------------ */

const OWNER_KEY = 'outbox_owner';

/**
 * Whose queue this is.
 *
 * Stored beside the ops and checked on restore, because replaying one
 * teacher's unsent changes under another's session would write their students
 * into the wrong account — the failure mode that matters most on a phone two
 * people share.
 */
let queueOwner: string | null = null;

/** Guards against reading the saved queue more than once in a process. */
let restored = false;

let writing: Promise<void> = Promise.resolve();

/** Persist the queue. Chained so two rapid writes cannot land out of order. */
function persistQueue() {
  // Fall back to the store when nothing has claimed the queue yet. Without
  // this, a write made between app start and the session arriving would be
  // saved under `null` and then discarded on the next launch as belonging to
  // somebody else — the one case where the safety check would destroy the very
  // work it exists to protect.
  queueOwner = queueOwner ?? useStore.getState().teacherId;

  const ops = queue.map((q) => q.op);
  const owner = queueOwner;

  writing = writing
    .then(async () => {
      await replaceOutbox(ops);
      await writeSetting(OWNER_KEY, owner);
    })
    .catch((e) => console.warn('[classcare] could not save the outbox:', e));
}

/**
 * Bring back what was still waiting when the app last closed, and adopt the
 * account it belongs to.
 *
 * Called once the session is known, before `hydrate()`, so pending work is
 * pushed before the server's version of the world is pulled over the top.
 */
export async function restoreQueue(teacherId: string | null) {
  queueOwner = teacherId;

  // Once per process. `SIGNED_IN` can fire again on a re-auth, and reading the
  // table a second time would push every pending op into the queue twice — two
  // registers, two groups, from one tap.
  if (restored) return;
  restored = true;

  try {
    const snapshot = await loadSnapshot();
    const saved = await readOutbox();
    if (!saved.length) return;

    // Someone else's unsent work. It must never be replayed under this
    // account: it would file their students into the wrong teacher's classes.
    const owner = (snapshot.settings[OWNER_KEY] as string | null | undefined) ?? null;
    if (owner !== teacherId) {
      await replaceOutbox([]);
      return;
    }

    for (const row of saved) queue.push({ op: row.op as Op, attempts: 0 });
    publish();
    if (queue.length) void drain();
  } catch (e) {
    console.warn('[classcare] could not read the outbox:', e);
  }
}

/** Drop everything pending. For signing out, and for switching accounts. */
export async function clearQueue() {
  queue.length = 0;
  queueOwner = null;
  // A fresh account may have its own saved queue waiting; let it be read.
  restored = false;
  publish();
  useSyncStatus.getState().report({ offline: false, failure: null });
  try {
    await replaceOutbox([]);
    await writeSetting(OWNER_KEY, null);
  } catch {
    // Nothing to do about it, and the in-memory queue is already empty.
  }
}

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

  useSyncStatus.getState().report({ syncing: true });
  try {
    while (queue.length) {
      const job = queue[0];
      try {
        await perform(job.op);
        queue.shift();
        persistQueue();
        publish();
        useSyncStatus.getState().report({ offline: false, lastSyncedAt: Date.now() });
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
        persistQueue();
        publish();
        const described = describeError(e);
        console.warn(`[classcare] ${job.op.kind} failed permanently:`, described.detail);
        useSyncStatus.getState().report({
          offline: false,
          failure: translateNow('sync.couldNotSave', {
            what: labelOf(job.op),
            reason: described.message,
          }),
        });
      }
    }
  } finally {
    draining = false;
    useSyncStatus.getState().report({ syncing: false });
  }
}

/**
 * Does this change completely replace one already waiting?
 *
 * A register the teacher corrects four times before leaving the room is one
 * pending change, not four: the last save contains everything the earlier ones
 * said. Without this the count on the home screen climbs with every tap and
 * reads as a backlog, when it is one register — and on a connection that is
 * down all afternoon, four copies of the same write go up instead of one.
 *
 * Only ever applied to writes where the newer one is a complete statement of
 * the same target. Creates, deletes and sends are never folded: each is a
 * separate act with its own effect.
 */
function supersedes(a: Op, b: Op): boolean {
  if (a.kind !== b.kind) return false;

  switch (a.kind) {
    case 'attendance.save':
      return a.key === (b as typeof a).key;
    case 'teacher.language':
    case 'teacher.gradeTemplate':
    case 'teacher.gradeTemplateFail':
    case 'replies.read':
      return true;
    case 'reply.read':
      return a.id === (b as typeof a).id;
    default:
      return false;
  }
}

/**
 * Fold a patch into one already queued for the same row.
 *
 * `group.update` and friends carry a partial, so the newer one does not
 * necessarily contain the older — a rename followed by a room change must keep
 * both. Merging in order is what preserves that while still counting as one
 * pending change.
 */
function mergePatch(existing: Op, incoming: Op): Op | null {
  if (existing.kind !== incoming.kind) return null;

  switch (existing.kind) {
    case 'group.update':
    case 'student.update':
    case 'template.update':
    case 'event.update': {
      const next = incoming as typeof existing;
      if (existing.id !== next.id) return null;
      return { ...existing, patch: { ...existing.patch, ...next.patch } } as Op;
    }
    default:
      return null;
  }
}

/** Queue a change for the server, and try to push it straight away. */
function enqueue(op: Op) {
  if (!hasSupabase) return;

  /*
    The head of the queue is in flight while draining, so it is not ours to
    rewrite — the request may already be on the wire. Everything behind it is
    still just an intention.
  */
  const firstFree = draining ? 1 : 0;

  for (let i = queue.length - 1; i >= firstFree; i--) {
    const queued = queue[i];

    if (supersedes(op, queued.op)) {
      queued.op = op;
      queued.attempts = 0;
      persistQueue();
      publish();
      void drain();
      return;
    }

    const merged = mergePatch(queued.op, op);
    if (merged) {
      queued.op = merged;
      queued.attempts = 0;
      persistQueue();
      publish();
      void drain();
      return;
    }

    // Only fold into the most recent write touching the same thing. Scanning
    // past an unrelated op is fine; scanning past one that reorders the result
    // is not, so stop at anything that touches the same row in another way.
    if (touchesSameTarget(op, queued.op)) break;
  }

  queue.push({ op, attempts: 0 });
  persistQueue();
  publish();
  void drain();
}

/** Whether two ops are about the same row, whatever they do to it. */
function touchesSameTarget(a: Op, b: Op): boolean {
  const idOf = (op: Op): string | null =>
    'id' in op ? op.id : 'group' in op ? op.group.id : 'student' in op ? op.student.id : null;

  const target = idOf(a);
  return target !== null && target === idOf(b);
}

/**
 * Can the server be reached right now?
 *
 * Nothing is refused on the strength of this any more — every write is kept
 * locally and queued. It answers one question: is it worth trying the queue
 * right now, or should the Sync button say so and leave the work where it is.
 *
 * `/auth/v1/health` needs no credentials and is one of the paths the PHP
 * reverse proxy carries, so this measures the route the app actually uses
 * rather than the internet in general.
 *
 * Twelve seconds, not five. A first request on a Turkmen mobile connection
 * routinely spends several seconds on DNS and the TLS handshake alone, and
 * calling that offline is how the app told teachers they had no internet while
 * everything else was working.
 */
export async function isReachable(timeoutMs = 12_000): Promise<boolean> {
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

/**
 * What the Sync button on the home screen does: push, then pull.
 *
 * Both halves matter, and they are not the same job. Pushing is the teacher's
 * own work reaching the server. Pulling is the register they took on their
 * other phone, the reply that arrived, the delivery receipts — none of which
 * the app learns about while the connection is down.
 *
 * Never throws: this is a button, and an unhandled rejection behind a button is
 * a screen that goes blank. The outcome comes back as a word the caller can put
 * on the screen.
 */
export async function syncNow(): Promise<'done' | 'offline' | 'failed'> {
  if (!hasSupabase) return 'done';

  useSyncStatus.getState().report({ syncing: true });
  try {
    if (!(await isReachable())) return 'offline';

    const drained = await flushWrites();
    if (!drained) return 'offline';

    await hydrate();
    useSyncStatus.getState().report({ lastSyncedAt: Date.now(), offline: false });
    return 'done';
  } catch (e) {
    if (isOfflineError(e)) {
      useSyncStatus.getState().report({ offline: true });
      return 'offline';
    }
    console.warn('[classcare] sync failed:', describeError(e).detail);
    return 'failed';
  } finally {
    useSyncStatus.getState().report({ syncing: false });
  }
}

/**
 * Replace local state with what the server has. Call after sign-in and on focus.
 *
 * Push before pulling, always. This function overwrites every local collection,
 * so running it with unsent work in the queue would replace a register taken
 * offline with the server's empty version of the same session and then push the
 * queue, which by then describes rows the store no longer shows. If the queue
 * cannot be drained — which means the connection is down — nothing is pulled at
 * all: local state is the only correct state until the phone can talk again.
 */
export async function hydrate() {
  if (!hasSupabase) return;

  if (queue.length) {
    const drained = await flushWrites();
    if (!drained) return;
  }

  const [
    teacher,
    groups,
    students,
    attendance,
    messages,
    replies,
    assessments,
    assessmentTypes,
    grades,
    templates,
  ] = await Promise.all([
    api.fetchTeacher(),
    api.fetchGroups(),
    api.fetchStudents(),
    api.fetchAttendance(),
    api.fetchMessages(),
    api.fetchReplies(),
    api.fetchAssessments(),
    api.fetchAssessmentTypes(),
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
    assessmentTypes,
    grades,
    templates,
    // Keep whatever is already local when the table is not there yet.
    ...(events ? { events } : {}),
    ...(teacher && {
      teacherName: teacher.name || useStore.getState().teacherName,
      teacherEmail: teacher.email,
      teacherAvatarUrl: teacher.avatarUrl,
      teacherProvider: teacher.provider,
      gradeTemplate: teacher.gradeTemplate,
      gradeTemplateFail: teacher.gradeTemplateFail,
    }),
  });

  if (teacher) reconcileLanguage(teacher.language);

  /*
    Keep the account's timezone matching the phone.

    Everything the app schedules is built from local `Date` values, so reminders
    already follow whatever the handset says the time is — a teacher who travels
    or whose phone corrects itself gets the right time with no help from this.
    The column is what the *server* would have to reason from, and it was only
    ever written when somebody happened to edit their name in Profile, so it sat
    at 'UTC' for most accounts.
  */
  if (teacher) {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && zone !== teacher.timezone) {
      api.updateTeacher({ timezone: zone }).catch(() => {
        // Cosmetic. Nothing on the device depends on it.
      });
    }
  }

  // Faces this device has never seen: a second phone, or a reinstall. Not
  // awaited — nothing on screen is waiting for it, and on a poor connection it
  // is the slowest part of a sync by far.
  void syncMissingPhotos(students).catch(() => {});
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
    if (remote !== language) enqueue({ kind: 'teacher.language', language });
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
  createGroup: (group: Group) => enqueue({ kind: 'group.create', group }),

  updateGroup: (id: string, patch: Partial<Omit<Group, 'id'>>) =>
    enqueue({ kind: 'group.update', id, patch }),

  deleteGroup: (id: string) => enqueue({ kind: 'group.delete', id }),

  createStudent: (student: Student) => enqueue({ kind: 'student.create', student }),

  updateStudent: (id: string, patch: Partial<Student>) =>
    enqueue({ kind: 'student.update', id, patch }),

  archiveStudent: (id: string) => enqueue({ kind: 'student.archive', id }),

  uploadStudentPhoto: (id: string) => enqueue({ kind: 'student.photo', id }),

  saveAttendance: (key: string, marks: Record<string, AttendanceStatus>) =>
    enqueue({ kind: 'attendance.save', key, marks }),

  sendMessage: (input) => enqueue({ kind: 'message.send', input }),

  logMessage: (entry) => enqueue({ kind: 'message.log', entry }),

  setLanguage: (language: Language) => enqueue({ kind: 'teacher.language', language }),

  setGradeTemplate: (template: string | null) =>
    enqueue({ kind: 'teacher.gradeTemplate', template }),

  setGradeTemplateFail: (template: string | null) =>
    enqueue({ kind: 'teacher.gradeTemplateFail', template }),

  markRepliesRead: () => enqueue({ kind: 'replies.read' }),

  markReplyRead: (id: string) => enqueue({ kind: 'reply.read', id }),

  deleteReply: (id: string) => enqueue({ kind: 'reply.delete', id }),

  deleteMessage: (id: string) => enqueue({ kind: 'message.delete', id }),
  deleteReplies: (ids: string[]) => enqueue({ kind: 'replies.delete', ids }),
  deleteMessages: (ids: string[]) => enqueue({ kind: 'messages.delete', ids }),

  saveAssessment: (assessment: Assessment, scores: { studentId: string; score: number }[]) =>
    enqueue({ kind: 'assessment.save', assessment, scores }),

  deleteAssessment: (id: string) => enqueue({ kind: 'assessment.delete', id }),

  createAssessmentType: (type: AssessmentType) => enqueue({ kind: 'assessmentType.create', type }),

  deleteAssessmentType: (id: string) => enqueue({ kind: 'assessmentType.delete', id }),

  createTemplate: (template: MessageTemplate) => enqueue({ kind: 'template.create', template }),

  updateTemplate: (id: string, patch: Partial<Omit<MessageTemplate, 'id'>>) =>
    enqueue({ kind: 'template.update', id, patch }),

  deleteTemplate: (id: string) => enqueue({ kind: 'template.delete', id }),

  createEvent: (event: CalendarEvent) => enqueue({ kind: 'event.create', event }),

  updateEvent: (id: string, patch: Partial<Omit<CalendarEvent, 'id'>>) =>
    enqueue({ kind: 'event.update', id, patch }),

  deleteEvent: (id: string) => enqueue({ kind: 'event.delete', id }),
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

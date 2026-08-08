import type {
  Assessment,
  MessageTemplate,
  AttendanceRecord,
  AttendanceStatus,
  Audience,
  CalendarEvent,
  Channel,
  Grade,
  Group,
  Message,
  Reply,
  Student,
  Weekday,
} from '@/data/types';
import type {
  AssessmentRow,
  AttendanceRow,
  CalendarEventRow,
  GradeRow,
  GroupRow,
  GroupSlotRow,
  MessageTemplateRow,
  MessageRow,
  ReplyRow,
  StudentRow,
  TeacherRow,
} from '@/lib/database.types';
import { AppState } from 'react-native';

import { translateNow } from '@/i18n/useT';
import { supabase } from '@/lib/supabase';

/**
 * The repository layer: the only place that knows about table names and row
 * shapes. Screens keep speaking the domain types in `data/types.ts`, so
 * swapping the local store for the network is a change confined to `store.ts`.
 */

/* -------------------------------------------------------------------------- */
/* Mappers                                                                    */
/* -------------------------------------------------------------------------- */

/** Postgres `time` comes back as `HH:MM:SS`; the app works in `HH:MM`. */
const hhmm = (t: string) => t.slice(0, 5);

const toGroup = (row: GroupRow, slots: GroupSlotRow[]): Group => ({
  id: row.id,
  name: row.name,
  subject: row.subject,
  room: row.room,
  accent: row.accent,
  slots: slots
    .filter((s) => s.group_id === row.id)
    .map((s) => ({
      day: s.weekday as Weekday,
      start: hhmm(s.starts_at),
      end: hhmm(s.ends_at),
    })),
});

const toStudent = (row: StudentRow, groupIds: string[]): Student => ({
  id: row.id,
  name: row.name,
  phone: row.phone,
  email: row.email ?? undefined,
  parentName: row.parent_name ?? undefined,
  parentPhone: row.parent_phone ?? undefined,
  parentEmail: row.parent_email ?? undefined,
  accent: row.accent,
  note: row.note ?? undefined,
  avgScore: row.avg_score ?? undefined,
  groupIds,
});

const toMessage = (
  row: MessageRow,
  groupIds: string[],
  delivered: number,
  total: number,
): Message => ({
  id: row.id,
  groupIds,
  audience: row.audience,
  channels: row.channels,
  body: row.body,
  sentAt: new Date(row.sent_at).getTime(),
  delivered,
  total,
  announcement: row.announcement,
  isAssignment: row.is_assignment ?? false,
});

const toReply = (row: ReplyRow, accent: Reply['accent']): Reply => ({
  id: row.id,
  authorName: row.author_name,
  context: row.context,
  accent,
  body: row.body,
  at: new Date(row.received_at).getTime(),
  unread: row.read_at == null,
});

/** Supabase returns `{ data, error }`; throw so callers can use try/catch. */
function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data as T;
}

const requireUser = async () => {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Not signed in');
  return data.user.id;
};

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function fetchGroups(): Promise<Group[]> {
  const [groups, slots] = await Promise.all([
    supabase.from('groups').select('*').is('archived_at', null).order('created_at'),
    supabase.from('group_slots').select('*'),
  ]);
  const groupRows = unwrap(groups);
  const slotRows = unwrap(slots);
  return groupRows.map((g) => toGroup(g, slotRows));
}

export async function fetchStudents(): Promise<Student[]> {
  const [students, links] = await Promise.all([
    supabase.from('students').select('*').is('archived_at', null).order('name'),
    supabase.from('student_groups').select('student_id, group_id'),
  ]);
  const studentRows = unwrap(students);
  const linkRows = unwrap(links);

  const byStudent = new Map<string, string[]>();
  for (const l of linkRows) {
    const list = byStudent.get(l.student_id) ?? [];
    list.push(l.group_id);
    byStudent.set(l.student_id, list);
  }
  return studentRows.map((s) => toStudent(s, byStudent.get(s.id) ?? []));
}

/**
 * Saved attendance, keyed the same way the app keys it locally
 * (`groupId@YYYY-MM-DD#HH:MM`), so the store can merge server rows straight in.
 */
export async function fetchAttendance(since?: Date): Promise<Record<string, AttendanceRecord>> {
  let q = supabase.from('attendance').select('*');
  if (since) q = q.gte('session_date', since.toISOString().slice(0, 10));

  const rows = unwrap(await q);
  const out: Record<string, AttendanceRecord> = {};
  for (const r of rows as AttendanceRow[]) {
    const key = `${r.group_id}@${r.session_date}#${hhmm(r.starts_at)}`;
    (out[key] ??= {})[r.student_id] = r.status;
  }
  return out;
}

export async function fetchMessages(limit = 50): Promise<Message[]> {
  const rows = unwrap(
    await supabase
      .from('messages')
      .select('*, message_groups(group_id), message_deliveries(state)')
      .order('sent_at', { ascending: false })
      .limit(limit),
  ) as (MessageRow & {
    message_groups: { group_id: string }[];
    message_deliveries: { state: string }[];
  })[];

  return rows.map((r) =>
    toMessage(
      r,
      r.message_groups.map((g) => g.group_id),
      r.message_deliveries.filter((d) => d.state === 'delivered' || d.state === 'sent').length,
      r.message_deliveries.length,
    ),
  );
}

export async function fetchReplies(limit = 50): Promise<Reply[]> {
  const rows = unwrap(
    await supabase
      .from('replies')
      .select('*, students(accent)')
      .order('received_at', { ascending: false })
      .limit(limit),
  ) as (ReplyRow & { students: { accent: Reply['accent'] } | null })[];

  return rows.map((r) => toReply(r, r.students?.accent ?? 'blue'));
}

export type TeacherProfile = {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  timezone: string;
  /** 'google' | 'apple' | 'email' — how this session was established. */
  provider: string;
  createdAt: string;
  /** Null until the teacher picks one; the device's choice then fills it in. */
  language: string | null;
};

export async function fetchTeacher(): Promise<TeacherProfile | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  // `maybeSingle`, not `single`: a missing row is a state to handle, and
  // `single` reports it as an error. That turned "no profile row" into a
  // rejected promise, which took the whole `Promise.all` in `hydrate()` with
  // it — so the app silently stopped reconciling with the server entirely and
  // ran on local state forever. The fallback below was never reached.
  const row = unwrap(
    await supabase.from('teachers').select('*').eq('id', auth.user.id).maybeSingle(),
  ) as TeacherRow | null;

  if (!row) {
    const profile = {
      id: auth.user.id,
      name: (auth.user.user_metadata?.full_name as string) ?? '',
      email: auth.user.email ?? null,
      avatarUrl: (auth.user.user_metadata?.avatar_url as string) ?? null,
      timezone: 'UTC',
      provider: auth.user.app_metadata?.provider ?? 'email',
      createdAt: auth.user.created_at,
      // A row that does not exist yet has chosen nothing; the device's pick wins.
      language: null,
    };

    // Create it rather than returning a convincing-looking profile that exists
    // nowhere. Every other table's `teacher_id` is a foreign key onto this row,
    // so without it the account can read fine and cannot save anything — which
    // surfaces much later as "New group could not be saved".
    //
    // The signup trigger normally does this; an account created before that
    // trigger existed never got one. RLS permits it: the `own profile` policy
    // checks `id = auth.uid()`, which is exactly this row.
    const { error } = await supabase.from('teachers').insert({
      id: profile.id,
      name: profile.name,
      email: profile.email,
      avatar_url: profile.avatarUrl,
    });
    // 23505 means another device won the race and created it first. Fine.
    if (error && error.code !== '23505') {
      console.warn('[classcare] could not create the profile row:', error.message);
    }

    return profile;
  }

  return {
    id: row.id,
    // The trigger copies the name from the provider at signup, but Apple only
    // sends it once — fall back to whatever auth still holds.
    name: row.name || (auth.user.user_metadata?.full_name as string) || '',
    email: row.email ?? auth.user.email ?? null,
    avatarUrl: row.avatar_url ?? (auth.user.user_metadata?.avatar_url as string) ?? null,
    timezone: row.timezone,
    provider: auth.user.app_metadata?.provider ?? 'email',
    createdAt: row.created_at,
    language: row.language ?? null,
  };
}

export async function updateTeacher(patch: {
  name?: string;
  timezone?: string;
  pushToken?: string;
  language?: string;
}) {
  const teacherId = await requireUser();
  unwrap(
    await supabase
      .from('teachers')
      .update({
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.timezone !== undefined && { timezone: patch.timezone }),
        ...(patch.pushToken !== undefined && { push_token: patch.pushToken }),
        ...(patch.language !== undefined && { language: patch.language }),
      })
      .eq('id', teacherId)
      .select(),
  );
  if (patch.name !== undefined) {
    await supabase.auth.updateUser({ data: { full_name: patch.name } });
  }
}

/**
 * Wipe everything this teacher owns.
 *
 * One delete is enough: every table cascades from `teachers`. The auth user
 * itself survives — removing that needs the admin API, which means a secret
 * key, which means a server. Documented rather than half-done.
 */
export async function deleteAccountData() {
  const teacherId = await requireUser();
  unwrap(await supabase.from('teachers').delete().eq('id', teacherId).select());
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Insert a group under the id the store already minted.
 *
 * The id is supplied rather than left to `gen_random_uuid()` so that the value
 * the UI navigated to is the value in the database. Letting Postgres choose
 * meant the client had to swap ids afterwards, and anything still holding the
 * old one — a route, a screen on the back stack — broke.
 */
export async function createGroup(group: Group): Promise<Group> {
  const teacherId = await requireUser();

  const row = unwrap(
    await supabase
      .from('groups')
      .insert({
        id: group.id,
        teacher_id: teacherId,
        name: group.name,
        subject: group.subject,
        room: group.room,
        accent: group.accent,
      })
      .select()
      .single(),
  ) as GroupRow;

  if (group.slots.length) {
    unwrap(
      await supabase
        .from('group_slots')
        .insert(
          group.slots.map((s) => ({
            group_id: row.id,
            teacher_id: teacherId,
            weekday: s.day,
            starts_at: s.start,
            ends_at: s.end,
          })),
        )
        .select(),
    );
  }

  return { ...group, id: row.id };
}

/* -------------------------------------------------------------------------- */
/* Calendar events                                                            */
/* -------------------------------------------------------------------------- */

const toEvent = (r: CalendarEventRow): CalendarEvent => ({
  id: r.id,
  title: r.title,
  note: r.note ?? undefined,
  date: r.event_date,
  allDay: r.all_day,
  start: r.starts_at ?? undefined,
  end: r.ends_at ?? undefined,
  accent: r.accent,
});

export async function fetchEvents(): Promise<CalendarEvent[]> {
  const rows = unwrap(
    await supabase.from('calendar_events').select('*').order('event_date'),
  ) as CalendarEventRow[];
  return rows.map(toEvent);
}

/** Insert under the store's id — see `createGroup` for why. */
export async function createEvent(event: CalendarEvent): Promise<CalendarEvent> {
  const teacherId = await requireUser();
  const row = unwrap(
    await supabase
      .from('calendar_events')
      .insert({
        id: event.id,
        teacher_id: teacherId,
        title: event.title,
        note: event.note ?? null,
        event_date: event.date,
        all_day: event.allDay,
        // The table's `times_present` constraint requires both or neither.
        starts_at: event.allDay ? null : (event.start ?? null),
        ends_at: event.allDay ? null : (event.end ?? null),
        accent: event.accent,
      })
      .select()
      .single(),
  ) as CalendarEventRow;
  return toEvent(row);
}

export async function updateEvent(id: string, patch: Partial<Omit<CalendarEvent, 'id'>>) {
  const teacherId = await requireUser();
  const fields: Partial<CalendarEventRow> = {};
  if (patch.title !== undefined) fields.title = patch.title;
  if (patch.note !== undefined) fields.note = patch.note ?? null;
  if (patch.date !== undefined) fields.event_date = patch.date;
  if (patch.accent !== undefined) fields.accent = patch.accent;
  if (patch.allDay !== undefined) {
    fields.all_day = patch.allDay;
    // Clearing the times alongside the flag keeps `times_present` satisfied
    // even when the caller only flips all-day on.
    if (patch.allDay) {
      fields.starts_at = null;
      fields.ends_at = null;
    }
  }
  if (patch.start !== undefined && !patch.allDay) fields.starts_at = patch.start ?? null;
  if (patch.end !== undefined && !patch.allDay) fields.ends_at = patch.end ?? null;

  if (!Object.keys(fields).length) return;
  unwrap(
    await supabase.from('calendar_events').update(fields).eq('id', id).eq('teacher_id', teacherId),
  );
}

export async function deleteEvent(id: string) {
  const teacherId = await requireUser();
  unwrap(await supabase.from('calendar_events').delete().eq('id', id).eq('teacher_id', teacherId));
}

/**
 * Edit a group in place.
 *
 * Slots are replaced wholesale rather than diffed. A group has at most a
 * handful, and the alternative — matching old rows to new by weekday — silently
 * does the wrong thing the moment a teacher moves a class from Tuesday to
 * Thursday. Delete-then-insert is unambiguous.
 *
 * Attendance is keyed by `groupId@date#start`, so moving a slot's start time
 * orphans that slot's history. That is the honest outcome: those records belong
 * to sessions that, as far as the schedule is now concerned, never happened.
 */
export async function updateGroup(id: string, patch: Partial<Omit<Group, 'id'>>) {
  const teacherId = await requireUser();

  const fields: Partial<GroupRow> = {};
  if (patch.name !== undefined) fields.name = patch.name;
  if (patch.subject !== undefined) fields.subject = patch.subject;
  if (patch.room !== undefined) fields.room = patch.room;
  if (patch.accent !== undefined) fields.accent = patch.accent;

  if (Object.keys(fields).length) {
    // The teacher_id filter is belt-and-braces: RLS already blocks other rows,
    // but this makes the intent explicit and fails loudly rather than silently
    // updating nothing.
    unwrap(await supabase.from('groups').update(fields).eq('id', id).eq('teacher_id', teacherId));
  }

  if (patch.slots) {
    unwrap(await supabase.from('group_slots').delete().eq('group_id', id));
    if (patch.slots.length) {
      unwrap(
        await supabase.from('group_slots').insert(
          patch.slots.map((s) => ({
            group_id: id,
            teacher_id: teacherId,
            weekday: s.day,
            starts_at: s.start,
            ends_at: s.end,
          })),
        ),
      );
    }
  }
}

/**
 * Delete a group and everything hanging off it.
 *
 * `group_slots`, `student_groups`, `attendance` and `message_groups` all
 * declare `on delete cascade`, so this one statement removes the schedule, the
 * roster links and the attendance history. Students themselves survive — they
 * are people, not group members, and may well be in another class.
 */
export async function deleteGroup(id: string) {
  const teacherId = await requireUser();
  unwrap(await supabase.from('groups').delete().eq('id', id).eq('teacher_id', teacherId));
}

/** Insert under the store's id — see `createGroup` for why. */
export async function createStudent(student: Student): Promise<Student> {
  const teacherId = await requireUser();

  const row = unwrap(
    await supabase
      .from('students')
      .insert({
        id: student.id,
        teacher_id: teacherId,
        name: student.name,
        phone: student.phone,
        email: student.email ?? null,
        parent_name: student.parentName ?? null,
        parent_phone: student.parentPhone ?? null,
        parent_email: student.parentEmail ?? null,
        accent: student.accent,
        note: student.note ?? null,
      })
      .select()
      .single(),
  ) as StudentRow;

  if (student.groupIds.length) {
    unwrap(
      await supabase
        .from('student_groups')
        .insert(
          student.groupIds.map((group_id) => ({
            student_id: row.id,
            group_id,
            teacher_id: teacherId,
          })),
        )
        .select(),
    );
  }

  return { ...student, id: row.id };
}

export async function updateStudent(id: string, patch: Partial<Student>) {
  unwrap(
    await supabase
      .from('students')
      .update({
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.phone !== undefined && { phone: patch.phone }),
        ...(patch.email !== undefined && { email: patch.email ?? null }),
        ...(patch.parentName !== undefined && {
          parent_name: patch.parentName ?? null,
        }),
        ...(patch.parentPhone !== undefined && {
          parent_phone: patch.parentPhone ?? null,
        }),
        ...(patch.parentEmail !== undefined && {
          parent_email: patch.parentEmail ?? null,
        }),
        ...(patch.note !== undefined && { note: patch.note ?? null }),
      })
      .eq('id', id)
      .select(),
  );

  if (patch.groupIds) {
    const teacherId = await requireUser();
    unwrap(await supabase.from('student_groups').delete().eq('student_id', id).select());
    if (patch.groupIds.length) {
      unwrap(
        await supabase
          .from('student_groups')
          .insert(
            patch.groupIds.map((group_id) => ({
              student_id: id,
              group_id,
              teacher_id: teacherId,
            })),
          )
          .select(),
      );
    }
  }
}

/** Soft delete — history stays intact so past attendance still adds up. */
export async function archiveStudent(id: string) {
  unwrap(
    await supabase
      .from('students')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', id)
      .select(),
  );
}

/**
 * Upsert a whole session's marks in one round trip. The unique constraint on
 * (group, date, start, student) makes re-saving idempotent, which matters
 * because attendance is often corrected mid-lesson.
 */
export async function saveAttendance(
  groupId: string,
  date: string,
  start: string,
  marks: Record<string, AttendanceStatus>,
) {
  const teacherId = await requireUser();
  const rows = Object.entries(marks).map(([student_id, status]) => ({
    teacher_id: teacherId,
    group_id: groupId,
    student_id,
    session_date: date,
    starts_at: start,
    status,
    marked_at: new Date().toISOString(),
  }));
  if (!rows.length) return;

  unwrap(
    await supabase
      .from('attendance')
      .upsert(rows, {
        onConflict: 'group_id,session_date,starts_at,student_id',
      })
      .select(),
  );
}

/**
 * What the Edge Function actually managed to do.
 *
 * `skipped` counts recipients dropped before dispatch because the contact
 * detail that channel needs is not on file — a student with no email address
 * cannot be emailed. That used to be invisible: the send returned 200 with
 * nothing queued and the teacher was told it went out.
 */
export type SendReport = {
  messageId: string;
  queued: number;
  sent: number;
  failed: number;
  skipped: { sms: number; email: number; push: number };
  /** Distinct gateway errors, deduplicated — one bad key repeats 11 times. */
  errors: string[];
};

/**
 * Hand a message to the server for fan-out over a gateway.
 *
 * This is the path for email, and for SMS when a commercial gateway is
 * configured. SMS sent from the teacher's own SIM does not come through here —
 * the device does the sending and `recordDeviceSms` writes down what happened.
 */
export async function sendMessage(input: {
  groupIds: string[];
  studentIds?: string[];
  audience: Audience;
  channels: Channel[];
  body: string;
  announcement?: boolean;
  /**
   * Storage paths in the `attachments` bucket, never URLs — the function signs
   * them itself after checking they belong to this teacher.
   */
  attachments?: { path: string; filename: string; mimeType: string; size: number }[];
  /** Marks the row as homework rather than an ordinary message. */
  isAssignment?: boolean;
}) {
  const { data, error } = await supabase.functions.invoke('send-message', {
    body: input,
  });
  if (error) throw new Error(await functionErrorMessage(error));
  return data as SendReport;
}

/**
 * Write down an SMS run that the device performed itself.
 *
 * The Edge Function normally creates the message and its deliveries as a side
 * effect of sending. When the teacher's own SIM does the sending there is no
 * server involved, so the log has to be written here — otherwise the Messages
 * tab would show nothing and the teacher would have no record of what the class
 * was told.
 *
 * Rows go in with their real outcome rather than `queued`: by the time this is
 * called every message has already succeeded or failed, and a row that says
 * `queued` forever is worse than no row.
 */
export async function recordDeviceSms(input: {
  groupIds: string[];
  audience: Audience;
  body: string;
  announcement?: boolean;
  deliveries: {
    studentId: string;
    recipient: 'student' | 'parent';
    destination: string;
    rendered: string;
    /**
     * `queued` is the honest state for a message handed to the radio that never
     * reported back — cancelled mid-flight, or the network went quiet. It may
     * still arrive, and `markSmsDelivery` upgrades it if a report turns up.
     */
    state: 'sent' | 'failed' | 'queued';
    error?: string;
  }[];
}): Promise<string> {
  const teacherId = await requireUser();

  const message = unwrap(
    await supabase
      .from('messages')
      .insert({
        teacher_id: teacherId,
        body: input.body,
        audience: input.audience,
        channels: ['sms'],
        announcement: input.announcement ?? false,
      })
      .select()
      .single(),
  ) as MessageRow;

  if (input.groupIds.length) {
    unwrap(
      await supabase
        .from('message_groups')
        .insert(input.groupIds.map((id) => ({ message_id: message.id, group_id: id })))
        .select(),
    );
  }

  if (input.deliveries.length) {
    unwrap(
      await supabase
        .from('message_deliveries')
        .insert(
          input.deliveries.map((d) => ({
            message_id: message.id,
            teacher_id: teacherId,
            student_id: d.studentId,
            recipient: d.recipient,
            channel: 'sms' as const,
            destination: d.destination,
            rendered: d.rendered,
            state: d.state,
            error: d.error ?? null,
          })),
        )
        .select(),
    );
  }

  return message.id;
}

/**
 * Record what the network said about one SMS, minutes after it went out.
 *
 * The sent-broadcast only proves the tower accepted the message. Whether it
 * reached the handset is a second answer that arrives later, and it is the one
 * that catches a SIM out of credit or a number that no longer exists — both of
 * which look like a clean send at the moment of sending.
 *
 * Best-effort by design: the row already says `sent`, the teacher has moved on,
 * and a failed update here should not surface as an error over their work.
 */
export async function markSmsDelivery(input: {
  messageId: string;
  studentId: string;
  recipient: 'student' | 'parent';
  delivered: boolean;
  reason?: string;
}): Promise<void> {
  const { error } = await supabase
    .from('message_deliveries')
    .update({
      state: input.delivered ? 'delivered' : 'failed',
      error: input.delivered ? null : (input.reason ?? 'not_delivered'),
    })
    .eq('message_id', input.messageId)
    .eq('student_id', input.studentId)
    .eq('recipient', input.recipient)
    .eq('channel', 'sms');

  if (error) console.warn('[classcare] could not record a delivery report:', error.message);
}

/**
 * Dig the real reason out of a failed Edge Function call.
 *
 * `FunctionsHttpError.message` is always the same sentence — "Edge Function
 * returned a non-2xx status code" — and the thing the teacher needs ("no email
 * address on file for these students") is in the response body, which
 * supabase-js hands over untouched as `context`.
 */
async function functionErrorMessage(error: unknown) {
  const response = (error as { context?: Response }).context;
  if (response && typeof response.json === 'function') {
    try {
      const body = await response.json();
      // A `code` means the server anticipated this and the app has words for
      // it; the English `error` is the fallback for anything it has not met.
      if (body?.code === 'sms_not_configured') return translateNow('sms.notConfigured');
      if (body?.error) return String(body.error);
    } catch {
      // Body was not JSON, or already consumed — fall back to the generic text.
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export type StoredAttachment = {
  id: string;
  storagePath: string;
  filename: string;
  mimeType: string;
  size: number;
};

/**
 * Files a student sent back with their reply.
 *
 * Fetched per reply rather than joined onto the inbox: most replies carry
 * nothing, and pulling every attachment row on every refresh to display a
 * paperclip on two of them is the wrong trade on a slow connection.
 */
export async function fetchReplyAttachments(replyId: string): Promise<StoredAttachment[]> {
  const rows = unwrap(
    await supabase
      .from('reply_attachments')
      .select('*')
      .eq('reply_id', replyId)
      .order('created_at'),
  ) as {
    id: string;
    storage_path: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
  }[];

  return rows.map((r) => ({
    id: r.id,
    storagePath: r.storage_path,
    filename: r.filename,
    mimeType: r.mime_type,
    size: r.size_bytes,
  }));
}

/**
 * Files that went out attached to a message the teacher sent.
 *
 * The sent-message screen is the only lasting record of what a class was
 * actually given — the email is in the recipient's inbox, not the teacher's —
 * so this is what makes "which worksheet did I send them last Tuesday" a
 * question the app can answer.
 *
 * Fetched per message for the same reason as the reply version: most messages
 * carry nothing.
 */
export async function fetchMessageAttachments(messageId: string): Promise<StoredAttachment[]> {
  const rows = unwrap(
    await supabase
      .from('message_attachments')
      .select('*')
      .eq('message_id', messageId)
      .order('created_at'),
  ) as {
    id: string;
    storage_path: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
  }[];

  return rows.map((r) => ({
    id: r.id,
    storagePath: r.storage_path,
    filename: r.filename,
    mimeType: r.mime_type,
    size: r.size_bytes,
  }));
}

export async function markRepliesRead() {
  unwrap(
    await supabase
      .from('replies')
      .update({ read_at: new Date().toISOString() })
      .is('read_at', null)
      .select(),
  );
}

/** Mark exactly one reply read — opening it is the receipt, not opening the tab. */
export async function markReplyRead(id: string) {
  unwrap(
    await supabase
      .from('replies')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)
      .is('read_at', null)
      .select(),
  );
}

export async function deleteReply(id: string) {
  const teacherId = await requireUser();
  unwrap(await supabase.from('replies').delete().eq('id', id).eq('teacher_id', teacherId));
}

/**
 * Remove a sent message from the history.
 *
 * `message_groups` and `message_deliveries` both cascade from `messages`, so
 * this takes the delivery receipts with it. Nothing is unsent — the SMS and the
 * email have already left — this only clears the teacher's own record of it.
 */
export async function deleteMessage(id: string) {
  const teacherId = await requireUser();
  unwrap(await supabase.from('messages').delete().eq('id', id).eq('teacher_id', teacherId));
}

/**
 * Delete many at once.
 *
 * One statement rather than a loop of single deletes: clearing a term's worth
 * of history over a Turkmen mobile connection would otherwise be forty round
 * trips, any of which can fail and leave the list half-cleared.
 */
export async function deleteMessages(ids: string[]) {
  if (!ids.length) return;
  const teacherId = await requireUser();
  unwrap(await supabase.from('messages').delete().in('id', ids).eq('teacher_id', teacherId));
}

export async function deleteReplies(ids: string[]) {
  if (!ids.length) return;
  const teacherId = await requireUser();
  unwrap(await supabase.from('replies').delete().in('id', ids).eq('teacher_id', teacherId));
}

/* -------------------------------------------------------------------------- */
/* Message templates                                                          */
/* -------------------------------------------------------------------------- */

const toTemplate = (row: MessageTemplateRow): MessageTemplate => ({
  id: row.id,
  title: row.title,
  body: row.body,
});

export async function fetchTemplates(): Promise<MessageTemplate[]> {
  const rows = unwrap(
    await supabase.from('message_templates').select('*').order('created_at'),
  ) as MessageTemplateRow[];
  return rows.map(toTemplate);
}

/** Insert under the store's id — see `createGroup` for why. */
export async function createTemplate(template: MessageTemplate) {
  const teacherId = await requireUser();
  unwrap(
    await supabase
      .from('message_templates')
      .insert({
        id: template.id,
        teacher_id: teacherId,
        title: template.title,
        body: template.body,
      })
      .select(),
  );
}

export async function updateTemplate(id: string, patch: Partial<MessageTemplate>) {
  unwrap(
    await supabase
      .from('message_templates')
      .update({
        ...(patch.title !== undefined && { title: patch.title }),
        ...(patch.body !== undefined && { body: patch.body }),
      })
      .eq('id', id)
      .select(),
  );
}

export async function deleteTemplate(id: string) {
  const teacherId = await requireUser();
  unwrap(
    await supabase.from('message_templates').delete().eq('id', id).eq('teacher_id', teacherId),
  );
}

/* -------------------------------------------------------------------------- */
/* Grading                                                                    */
/* -------------------------------------------------------------------------- */

const toAssessment = (row: AssessmentRow): Assessment => ({
  id: row.id,
  groupId: row.group_id,
  kind: row.kind,
  title: row.title,
  maxScore: Number(row.max_score),
  takenOn: row.taken_on,
});

const toGrade = (row: GradeRow): Grade => ({
  id: row.id,
  assessmentId: row.assessment_id,
  studentId: row.student_id,
  // `numeric` arrives as a string over PostgREST; a string here would sort and
  // average as text, which is the kind of bug that shows up as 9 > 80.
  score: Number(row.score),
  notifiedAt: row.notified_at ? new Date(row.notified_at).getTime() : undefined,
});

export async function fetchAssessments(): Promise<Assessment[]> {
  const rows = unwrap(
    await supabase.from('assessments').select('*').order('taken_on', { ascending: false }),
  ) as AssessmentRow[];
  return rows.map(toAssessment);
}

export async function fetchGrades(): Promise<Grade[]> {
  const rows = unwrap(await supabase.from('grades').select('*')) as GradeRow[];
  return rows.map(toGrade);
}

/**
 * Save an assessment and its marks in one go.
 *
 * Upserted on `(assessment_id, student_id)`, which is what turns re-entering a
 * mark into a correction rather than a second row. Teachers fix typos.
 */
export async function saveAssessment(
  assessment: Assessment,
  scores: { studentId: string; score: number }[],
): Promise<void> {
  const teacherId = await requireUser();

  unwrap(
    await supabase
      .from('assessments')
      .upsert({
        id: assessment.id,
        teacher_id: teacherId,
        group_id: assessment.groupId,
        kind: assessment.kind,
        title: assessment.title,
        max_score: assessment.maxScore,
        taken_on: assessment.takenOn,
      })
      .select(),
  );

  if (!scores.length) return;

  unwrap(
    await supabase
      .from('grades')
      .upsert(
        scores.map((s) => ({
          teacher_id: teacherId,
          assessment_id: assessment.id,
          student_id: s.studentId,
          score: s.score,
        })),
        { onConflict: 'assessment_id,student_id' },
      )
      .select(),
  );
}

export async function deleteAssessment(id: string) {
  const teacherId = await requireUser();
  unwrap(await supabase.from('assessments').delete().eq('id', id).eq('teacher_id', teacherId));
}

export type GradeReport = {
  assessmentId: string;
  notified: number;
  failed: number;
  skipped: number;
  errors: string[];
};

/** Tell each graded student (or their guardian) what they scored. */
export async function sendGrades(input: {
  assessmentId: string;
  audience: Audience;
}): Promise<GradeReport> {
  const { data, error } = await supabase.functions.invoke('send-grades', { body: input });
  if (error) throw new Error(await functionErrorMessage(error));
  return data as GradeReport;
}

/* -------------------------------------------------------------------------- */
/* Realtime                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Replies and delivery receipts arrive from webhooks, not from anything the
 * teacher did — so the only way the badge is ever right is to subscribe.
 */
/**
 * Watch for inbound replies and delivery-state changes.
 *
 * Uses Realtime where it is available, and falls back to polling where it is
 * not. That fallback exists because the app reaches Supabase through a PHP
 * reverse proxy on shared hosting (see `docs/reverse-proxy.md`) — PHP cannot
 * hold a WebSocket open, so `/realtime/v1` is not carried.
 *
 * Polling costs one small query per interval, and only while the app is in the
 * foreground: a background timer would drain battery to learn about a reply the
 * teacher cannot see anyway.
 */
export function subscribeToInbox(onChange: () => void) {
  if (realtimeAvailable()) {
    const channel = supabase
      .channel('inbox')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'replies' }, onChange)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'message_deliveries' },
        onChange,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  // Only refire `onChange` when something actually changed, so a poll that
  // finds nothing new does not re-render the inbox every 30 seconds.
  let lastSeen: string | null = null;

  const check = async () => {
    try {
      const { data } = await supabase
        .from('replies')
        .select('id, received_at')
        .order('received_at', { ascending: false })
        .limit(1);
      const newest = data?.[0]?.received_at ?? null;
      if (newest !== lastSeen) {
        // Skip the very first read: it establishes the baseline rather than
        // signalling an arrival.
        if (lastSeen !== null) onChange();
        lastSeen = newest;
      }
    } catch {
      // Offline or proxy hiccup. The next tick tries again.
    }
  };

  const start = () => {
    if (timer) return;
    void check();
    timer = setInterval(check, POLL_MS);
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const sub = AppState.addEventListener('change', (s) => (s === 'active' ? start() : stop()));
  if (AppState.currentState === 'active') start();

  return () => {
    stop();
    sub.remove();
  };
}

/** How often to check for replies when Realtime is unavailable. */
const POLL_MS = 30_000;

/**
 * Realtime needs a WebSocket. The PHP proxy cannot carry one, so it is disabled
 * whenever the configured URL is not a `*.supabase.co` host.
 */
function realtimeAvailable() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  return /\.supabase\.(co|in)$/.test(new URL(url).hostname);
}

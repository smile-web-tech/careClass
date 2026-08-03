import type {
  AttendanceRecord,
  AttendanceStatus,
  Audience,
  Channel,
  Group,
  Message,
  Reply,
  Student,
  Weekday,
} from '@/data/types';
import type {
  AttendanceRow,
  GroupRow,
  GroupSlotRow,
  MessageRow,
  ReplyRow,
  StudentRow,
  TeacherRow,
} from '@/lib/database.types';
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
  accent: row.accent,
  note: row.note ?? undefined,
  avgScore: row.avg_score ?? undefined,
  groupIds,
});

const toMessage = (row: MessageRow, groupIds: string[], delivered: number, total: number): Message => ({
  id: row.id,
  groupIds,
  audience: row.audience,
  channels: row.channels,
  body: row.body,
  sentAt: new Date(row.sent_at).getTime(),
  delivered,
  total,
  announcement: row.announcement,
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
};

export async function fetchTeacher(): Promise<TeacherProfile | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const row = unwrap(
    await supabase.from('teachers').select('*').eq('id', auth.user.id).single(),
  ) as TeacherRow | null;
  // The signup trigger creates this row; if it somehow hasn't, fall back to
  // auth rather than blowing up the whole hydrate.
  if (!row) {
    return {
      id: auth.user.id,
      name: (auth.user.user_metadata?.full_name as string) ?? '',
      email: auth.user.email ?? null,
      avatarUrl: (auth.user.user_metadata?.avatar_url as string) ?? null,
      timezone: 'UTC',
      provider: auth.user.app_metadata?.provider ?? 'email',
      createdAt: auth.user.created_at,
    };
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
  };
}

export async function updateTeacher(patch: {
  name?: string;
  timezone?: string;
  pushToken?: string;
}) {
  const teacherId = await requireUser();
  unwrap(
    await supabase
      .from('teachers')
      .update({
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.timezone !== undefined && { timezone: patch.timezone }),
        ...(patch.pushToken !== undefined && { push_token: patch.pushToken }),
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

export async function createGroup(group: Omit<Group, 'id'>): Promise<Group> {
  const teacherId = await requireUser();

  const row = unwrap(
    await supabase
      .from('groups')
      .insert({
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
      await supabase.from('group_slots').insert(
        group.slots.map((s) => ({
          group_id: row.id,
          teacher_id: teacherId,
          weekday: s.day,
          starts_at: s.start,
          ends_at: s.end,
        })),
      ).select(),
    );
  }

  return { ...group, id: row.id };
}

export async function createStudent(student: Omit<Student, 'id'>): Promise<Student> {
  const teacherId = await requireUser();

  const row = unwrap(
    await supabase
      .from('students')
      .insert({
        teacher_id: teacherId,
        name: student.name,
        phone: student.phone,
        email: student.email ?? null,
        parent_name: student.parentName ?? null,
        parent_phone: student.parentPhone ?? null,
        accent: student.accent,
        note: student.note ?? null,
      })
      .select()
      .single(),
  ) as StudentRow;

  if (student.groupIds.length) {
    unwrap(
      await supabase.from('student_groups').insert(
        student.groupIds.map((group_id) => ({
          student_id: row.id,
          group_id,
          teacher_id: teacherId,
        })),
      ).select(),
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
        ...(patch.parentName !== undefined && { parent_name: patch.parentName ?? null }),
        ...(patch.parentPhone !== undefined && { parent_phone: patch.parentPhone ?? null }),
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
        await supabase.from('student_groups').insert(
          patch.groupIds.map((group_id) => ({ student_id: id, group_id, teacher_id: teacherId })),
        ).select(),
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
      .upsert(rows, { onConflict: 'group_id,session_date,starts_at,student_id' })
      .select(),
  );
}

/**
 * Hand a message to the server for fan-out.
 *
 * Sending never happens on the device: iOS and Android both refuse to let an
 * app dispatch SMS silently, and per-recipient placeholder substitution across
 * a whole group would mean opening the native composer once per student. The
 * Edge Function renders each message and calls the SMS/email/push providers.
 */
export async function sendMessage(input: {
  groupIds: string[];
  studentIds?: string[];
  audience: Audience;
  channels: Channel[];
  body: string;
  announcement?: boolean;
}) {
  const { data, error } = await supabase.functions.invoke('send-message', { body: input });
  if (error) throw new Error(error.message);
  return data as { messageId: string; queued: number };
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

/* -------------------------------------------------------------------------- */
/* Realtime                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Replies and delivery receipts arrive from webhooks, not from anything the
 * teacher did — so the only way the badge is ever right is to subscribe.
 */
export function subscribeToInbox(onChange: () => void) {
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

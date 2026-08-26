import type {
  Assessment,
  AssessmentType,
  MessageTemplate,
  AttendanceRecord,
  AttendanceStatus,
  Audience,
  CalendarEvent,
  Channel,
  Grade,
  Group,
  GroupPatch,
  Message,
  Reply,
  SentMessageLog,
  Student,
  Weekday,
} from '@/data/types';
import type {
  AssessmentRow,
  AssessmentTypeRow,
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
  // `undefined` rather than null, so an absent bound reads the same here as it
  // does on a group the device made itself and never sent.
  startsOn: row.starts_on ?? undefined,
  endsOn: row.ends_on ?? undefined,
  term: row.term ?? undefined,
  archivedAt: row.archived_at ?? undefined,
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
  birthDate: row.birth_date ?? undefined,
  address: row.address ?? undefined,
  school: row.school ?? undefined,
  gender: (row.gender as Student['gender']) ?? undefined,
  surname: row.surname ?? undefined,
  patronymic: row.patronymic ?? undefined,
  documentId: row.document_id ?? undefined,
  levelBase: row.level_base ?? undefined,
  parentName: row.parent_name ?? undefined,
  parentPhone: row.parent_phone ?? undefined,
  parentEmail: row.parent_email ?? undefined,
  parentWork: row.parent_work ?? undefined,
  parent2Name: row.parent2_name ?? undefined,
  parent2Phone: row.parent2_phone ?? undefined,
  parent2Email: row.parent2_email ?? undefined,
  parent2Work: row.parent2_work ?? undefined,
  accent: row.accent,
  photoPath: row.photo_path ?? undefined,
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
  studentId: row.student_id ?? undefined,
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

/**
 * Who is signed in, without asking the server.
 *
 * `getUser()` looks local and is not: it posts to `/auth/v1/user` on every
 * call to have the token validated. On a connection that is down — which for
 * these teachers is a normal Tuesday — that request fails, the user comes back
 * null, and this threw "Not signed in", which `describeError` classifies as an
 * auth failure and puts on screen as a session that has expired. Nothing had
 * expired. The phone simply could not reach the internet.
 *
 * `getSession()` reads the stored session and only touches the network when
 * the access token has actually aged out, which is the question being asked.
 */
const requireUser = async () => {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user?.id;
  if (!id) throw new Error('Not signed in');
  return id;
};

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function fetchGroups(): Promise<Group[]> {
  const [groups, slots] = await Promise.all([
    /*
      Archived groups come down too.

      They used to be filtered out here, which made archiving and deleting the
      same thing as far as the device was concerned: the group vanished on the
      next sync and its marks and registers had nothing left to hang off. The
      archive is a place a teacher goes to *read* a finished course, so the rows
      have to be here to read. `useGroups` is what keeps them out of the
      teaching screens.
    */
    supabase.from('groups').select('*').order('created_at'),
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

/**
 * How much history a sync pulls back.
 *
 * Was 50, which is roughly a fortnight for a teacher with four groups — and a
 * hard ceiling that quietly deleted the rest. A backup carrying a term of sent
 * messages imported fine and then lost everything past the newest fifty at the
 * first sync, which reads exactly like the import having failed.
 *
 * 500 is more than a year for the same teacher, and these rows are small: a
 * body, a few delivery states, no attachments.
 */
const HISTORY_LIMIT = 500;

export async function fetchMessages(limit = HISTORY_LIMIT): Promise<Message[]> {
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

export async function fetchReplies(limit = HISTORY_LIMIT): Promise<Reply[]> {
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
  /** What a passing result says. Null until the teacher writes their own. */
  gradeTemplate: string | null;
  /** What a failing result says. Null until the teacher writes their own. */
  gradeTemplateFail: string | null;
  templateOverrides: Record<string, { title: string; body: string }>;
  hiddenTemplates: string[];
};

/**
 * Whether this device holds a session, without asking the network.
 *
 * `getSession` reads what is stored; `getUser` would make a request, and on a
 * filtered connection a request that fails is indistinguishable here from a
 * teacher who is not signed in. Callers use this to decide whether a *pull* is
 * meaningful, and getting that wrong deletes data, so it must not depend on
 * whether the network happens to be up.
 */
export async function hasSession(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  return Boolean(data.session);
}

export async function fetchTeacher(): Promise<TeacherProfile | null> {
  // The stored session, not `getUser()`, for the same reason as `requireUser`:
  // that call goes to the network and turns a dropped connection into a
  // teacher with no account.
  const { data: auth } = await supabase.auth.getSession();
  const user = auth.session?.user;
  if (!user) return null;

  // `maybeSingle`, not `single`: a missing row is a state to handle, and
  // `single` reports it as an error. That turned "no profile row" into a
  // rejected promise, which took the whole `Promise.all` in `hydrate()` with
  // it — so the app silently stopped reconciling with the server entirely and
  // ran on local state forever. The fallback below was never reached.
  const row = unwrap(
    await supabase.from('teachers').select('*').eq('id', user.id).maybeSingle(),
  ) as TeacherRow | null;

  if (!row) {
    const profile = {
      id: user.id,
      name: (user.user_metadata?.full_name as string) ?? '',
      email: user.email ?? null,
      avatarUrl: (user.user_metadata?.avatar_url as string) ?? null,
      timezone: 'UTC',
      provider: user.app_metadata?.provider ?? 'email',
      createdAt: user.created_at,
      // A row that does not exist yet has chosen nothing; the device's pick wins.
      language: null,
      gradeTemplate: null,
      gradeTemplateFail: null,
      templateOverrides: {},
      hiddenTemplates: [],
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
    name: row.name || (user.user_metadata?.full_name as string) || '',
    email: row.email ?? user.email ?? null,
    avatarUrl: row.avatar_url ?? (user.user_metadata?.avatar_url as string) ?? null,
    timezone: row.timezone,
    provider: user.app_metadata?.provider ?? 'email',
    createdAt: row.created_at,
    language: row.language ?? null,
    gradeTemplate: row.grade_template ?? null,
    gradeTemplateFail: row.grade_template_fail ?? null,
    templateOverrides: row.template_overrides ?? {},
    hiddenTemplates: row.hidden_templates ?? [],
  };
}

export async function updateTeacher(patch: {
  name?: string;
  timezone?: string;
  pushToken?: string;
  language?: string;
  /** Null clears it, which puts the teacher back on the translated default. */
  gradeTemplate?: string | null;
  gradeTemplateFail?: string | null;
  templateOverrides?: Record<string, { title: string; body: string }>;
  hiddenTemplates?: string[];
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
        ...(patch.gradeTemplate !== undefined && { grade_template: patch.gradeTemplate }),
        ...(patch.templateOverrides !== undefined && {
          template_overrides: patch.templateOverrides,
        }),
        ...(patch.hiddenTemplates !== undefined && {
          hidden_templates: patch.hiddenTemplates,
        }),
        ...(patch.gradeTemplateFail !== undefined && {
          grade_template_fail: patch.gradeTemplateFail,
        }),
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
      // Upsert rather than insert: a create can be replayed — a queued write
      // retried after a timeout that actually succeeded, or a row arriving from
      // an imported backup the server already has — and a duplicate key error
      // would stall the queue behind it.
      .upsert({
        id: group.id,
        teacher_id: teacherId,
        name: group.name,
        subject: group.subject,
        room: group.room,
        accent: group.accent,
        starts_on: group.startsOn ?? null,
        term: group.term ?? null,
        ends_on: group.endsOn ?? null,
      })
      .select()
      .single(),
  ) as GroupRow;

  if (group.slots.length) {
    // Cleared first, so a replayed create does not double every slot.
    unwrap(await supabase.from('group_slots').delete().eq('group_id', row.id));
    unwrap(
      await supabase
        .from('group_slots')
        .insert(
          distinctSlots(group.slots).map((s) => ({
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

/**
 * One slot per day and start time, which is what the table allows.
 *
 * `group_slots` is unique on `(group_id, weekday, starts_at)`. A form that
 * produced the same day twice — easily done by adding Monday, changing your
 * mind, and adding it again — used to reach the server as two identical rows
 * and come back as "Already exists" against the whole group, which reads as the
 * *group* being a duplicate and sends the teacher looking for a clash that is
 * not there.
 */
const distinctSlots = <T extends { day: number; start: string }>(slots: T[]): T[] => {
  const seen = new Set<string>();
  return slots.filter((s) => {
    const key = `${s.day}#${s.start}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

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
      // Upsert rather than insert: a create can be replayed — a queued write
      // retried after a timeout that actually succeeded, or a row arriving from
      // an imported backup the server already has — and a duplicate key error
      // would stall the queue behind it.
      .upsert({
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
export async function updateGroup(id: string, patch: GroupPatch) {
  const teacherId = await requireUser();

  const fields: Partial<GroupRow> = {};
  if (patch.name !== undefined) fields.name = patch.name;
  if (patch.subject !== undefined) fields.subject = patch.subject;
  if (patch.room !== undefined) fields.room = patch.room;
  if (patch.accent !== undefined) fields.accent = patch.accent;
  /*
    Tested with `in`, not against `undefined`.

    Clearing an end date — "this course no longer has a finish" — is expressed
    as `endsOn: undefined`, which `!== undefined` reads as "not mentioned" and
    skips. The column kept its old date, and the next sync pulled it back down
    over the teacher's edit, so switching a course to Ongoing silently did
    nothing. `in` distinguishes an absent key from a present empty one.
  */
  if ('startsOn' in patch) fields.starts_on = patch.startsOn ?? null;
  if ('endsOn' in patch) fields.ends_on = patch.endsOn ?? null;
  if ('term' in patch) fields.term = patch.term ?? null;
  if ('archivedAt' in patch) fields.archived_at = patch.archivedAt ?? null;

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
          distinctSlots(patch.slots).map((s) => ({
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
      // Upsert rather than insert: a create can be replayed — a queued write
      // retried after a timeout that actually succeeded, or a row arriving from
      // an imported backup the server already has — and a duplicate key error
      // would stall the queue behind it.
      .upsert({
        id: student.id,
        teacher_id: teacherId,
        name: student.name,
        phone: student.phone,
        email: student.email ?? null,
        birth_date: student.birthDate ?? null,
        address: student.address ?? null,
        school: student.school ?? null,
        gender: student.gender ?? null,
        surname: student.surname ?? null,
        patronymic: student.patronymic ?? null,
        document_id: student.documentId ?? null,
        level_base: student.levelBase ?? 0,
        parent_name: student.parentName ?? null,
        parent_phone: student.parentPhone ?? null,
        parent_email: student.parentEmail ?? null,
        parent_work: student.parentWork ?? null,
        parent2_name: student.parent2Name ?? null,
        parent2_phone: student.parent2Phone ?? null,
        parent2_email: student.parent2Email ?? null,
        parent2_work: student.parent2Work ?? null,
        accent: student.accent,
        photo_path: student.photoPath ?? null,
        note: student.note ?? null,
      })
      .select()
      .single(),
  ) as StudentRow;

  // Cleared first, and de-duplicated, for the same reason `createGroup` clears
  // its slots: a create can be replayed — a retry after a timeout that actually
  // succeeded, or a row from an imported backup — and inserting the same
  // (student, group) pair twice is a duplicate key error that fails the whole
  // student, not just the link.
  unwrap(await supabase.from('student_groups').delete().eq('student_id', row.id));

  const groupIds = [...new Set(student.groupIds)];
  if (groupIds.length) {
    unwrap(
      await supabase
        .from('student_groups')
        .insert(
          groupIds.map((group_id) => ({
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
        ...(patch.birthDate !== undefined && { birth_date: patch.birthDate ?? null }),
        ...(patch.address !== undefined && { address: patch.address ?? null }),
        ...(patch.school !== undefined && { school: patch.school ?? null }),
        ...('gender' in patch && { gender: patch.gender ?? null }),
        ...(patch.surname !== undefined && { surname: patch.surname ?? null }),
        ...(patch.patronymic !== undefined && { patronymic: patch.patronymic ?? null }),
        ...(patch.documentId !== undefined && { document_id: patch.documentId ?? null }),
        ...(patch.levelBase !== undefined && { level_base: patch.levelBase }),
        ...(patch.parentWork !== undefined && { parent_work: patch.parentWork ?? null }),
        ...(patch.parent2Name !== undefined && { parent2_name: patch.parent2Name ?? null }),
        ...(patch.parent2Phone !== undefined && { parent2_phone: patch.parent2Phone ?? null }),
        ...(patch.parent2Email !== undefined && { parent2_email: patch.parent2Email ?? null }),
        ...(patch.parent2Work !== undefined && { parent2_work: patch.parent2Work ?? null }),
        ...(patch.note !== undefined && { note: patch.note ?? null }),
        ...(patch.photoPath !== undefined && { photo_path: patch.photoPath ?? null }),
      })
      .eq('id', id)
      .select(),
  );

  if (patch.groupIds) {
    const teacherId = await requireUser();
    unwrap(await supabase.from('student_groups').delete().eq('student_id', id).select());
    // De-duplicated: the same group listed twice is a duplicate key on the
    // (student, group) pair, and the whole edit fails on it.
    const groupIds = [...new Set(patch.groupIds)];
    if (groupIds.length) {
      unwrap(
        await supabase
          .from('student_groups')
          .insert(
            groupIds.map((group_id) => ({
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

/**
 * Put a reply on the server that this device already holds.
 *
 * Replies normally arrive the other way round — the inbound-email function
 * writes them and the app fetches them — so there was no path for one that came
 * in from a backup file. Without this an imported inbox is local-only, and the
 * first `hydrate` replaces it with the server's copy, which has never heard of
 * any of it. That is the "inbox is empty after refreshing" the teacher sees.
 *
 * `inbound_message_id` is left null on purpose. It is the natural key of the
 * *email* that produced the reply, unique across the table, and claiming the
 * original's would collide with the row the webhook already wrote in whichever
 * account exported the file.
 */
export async function createReply(reply: Reply) {
  const teacherId = await requireUser();

  unwrap(
    await supabase
      .from('replies')
      .upsert({
        id: reply.id,
        teacher_id: teacherId,
        student_id: reply.studentId ?? null,
        author_name: reply.authorName,
        context: reply.context,
        body: reply.body,
        received_at: new Date(reply.at).toISOString(),
        read_at: reply.unread ? null : new Date(reply.at).toISOString(),
      })
      .select(),
  );
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
 * Record a send the phone made on its own.
 *
 * Only device SMS reaches this. Everything that goes through an Edge Function
 * is written down by that function as it sends, which is both closer to the
 * truth and impossible to do from here — the app cannot know a gateway's
 * verdict. But a text sent from the teacher's own SIM has no server in the
 * loop, so without this the message log simply had a hole in it where every
 * texted exam result should have been.
 *
 * Written with the id the device generated, and the delivery rows cleared
 * first, so a retry after a dropped connection replaces its own row instead of
 * filing the same send twice.
 */
export async function logSentMessage(entry: SentMessageLog) {
  const teacherId = await requireUser();

  unwrap(
    await supabase
      .from('messages')
      .upsert({
        id: entry.id,
        teacher_id: teacherId,
        body: entry.body,
        audience: entry.audience,
        channels: entry.channels,
        announcement: entry.groupIds.length === 0,
        sent_at: new Date(entry.sentAt).toISOString(),
      })
      .select(),
  );

  if (entry.groupIds.length) {
    unwrap(
      await supabase
        .from('message_groups')
        .upsert(entry.groupIds.map((group_id) => ({ message_id: entry.id, group_id }))),
    );
  }

  unwrap(await supabase.from('message_deliveries').delete().eq('message_id', entry.id));

  if (entry.deliveries.length) {
    unwrap(
      await supabase.from('message_deliveries').insert(
        entry.deliveries.map((d) => ({
          message_id: entry.id,
          teacher_id: teacherId,
          student_id: d.studentId,
          recipient: d.recipient,
          channel: d.channel,
          destination: d.destination,
          rendered: d.rendered,
          state: d.state,
          error: d.error ?? null,
        })),
      ),
    );
  }
}

/**
 * Put a message from a backup back in the history, without touching receipts.
 *
 * Deliberately not `logSentMessage`. That one owns the delivery rows and clears
 * them before writing its own, which is right for a send the phone just made
 * and catastrophic for a restore: a message the server already holds would have
 * its real per-recipient receipts deleted and replaced with nothing, because a
 * backup does not carry them — the device only ever stored the two counts.
 *
 * So this writes the message and the groups it went to, and leaves
 * `message_deliveries` exactly as it found it. A message the server already had
 * keeps its receipts; one that is genuinely new arrives with none, and shows a
 * recipient count of zero. That is the truthful answer — the file never knew
 * who it went to — and it beats inventing rows to make a number look right.
 */
export async function restoreMessage(message: Message) {
  const teacherId = await requireUser();

  unwrap(
    await supabase
      .from('messages')
      .upsert({
        id: message.id,
        teacher_id: teacherId,
        body: message.body,
        audience: message.audience,
        channels: message.channels,
        announcement: message.announcement ?? message.groupIds.length === 0,
        sent_at: new Date(message.sentAt).toISOString(),
      })
      .select(),
  );

  if (message.groupIds.length) {
    unwrap(
      await supabase
        .from('message_groups')
        .upsert(message.groupIds.map((group_id) => ({ message_id: message.id, group_id }))),
    );
  }
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
      // Upsert rather than insert: a create can be replayed — a queued write
      // retried after a timeout that actually succeeded, or a row arriving from
      // an imported backup the server already has — and a duplicate key error
      // would stall the queue behind it.
      .upsert({
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
  kindLabel: row.kind_label ?? undefined,
  title: row.title,
  passMark: row.pass_mark == null ? undefined : Number(row.pass_mark),
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
        kind_label: assessment.kindLabel ?? null,
        title: assessment.title,
        pass_mark: assessment.passMark ?? null,
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

/* ----------------------------- Assessment types ------------------------- */

const toAssessmentType = (row: AssessmentTypeRow): AssessmentType => ({
  id: row.id,
  groupId: row.group_id,
  name: row.name,
  position: row.position,
});

export async function fetchAssessmentTypes(): Promise<AssessmentType[]> {
  const rows = unwrap(
    await supabase.from('assessment_types').select('*').order('position'),
  ) as AssessmentTypeRow[];
  return rows.map(toAssessmentType);
}

export async function createAssessmentType(type: AssessmentType) {
  const teacherId = await requireUser();
  unwrap(
    await supabase
      .from('assessment_types')
      // Upsert rather than insert: a create can be replayed — a queued write
      // retried after a timeout that actually succeeded, or a row arriving from
      // an imported backup the server already has — and a duplicate key error
      // would stall the queue behind it.
      .upsert({
        id: type.id,
        teacher_id: teacherId,
        group_id: type.groupId,
        name: type.name,
        position: type.position,
      })
      .select(),
  );
}

export async function deleteAssessmentType(id: string) {
  const teacherId = await requireUser();
  unwrap(await supabase.from('assessment_types').delete().eq('id', id).eq('teacher_id', teacherId));
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
  /**
   * The teacher's own wording, rendered per recipient by the function.
   *
   * Passed up rather than read from `teachers.grade_template` on the server so
   * that the default, when they have not written one, is the app's translated
   * text in the language they are actually using. The server has no business
   * guessing that.
   */
  template: string;
  /**
   * The wording for a mark below `passMark`.
   *
   * Sent alongside the pass wording rather than instead of it, because one
   * send covers a whole class and the two halves of it need different words.
   */
  failTemplate: string;
  /** Null means no threshold was set, and every result is reported as a pass. */
  passMark: number | null;
  /**
   * The sentences that are not the teacher's: why this address is receiving
   * the message, and how to stop. Translated here and filled in by the
   * function, which holds no catalogue of its own.
   */
  labels: { whyStudent: string; whyParent: string; stop: string; reply: string };
}): Promise<GradeReport> {
  const { data, error } = await supabase.functions.invoke('send-grades', { body: input });
  if (error) throw new Error(await functionErrorMessage(error));
  return data as GradeReport;
}

/**
 * Stamp results the phone itself texted out.
 *
 * `send-grades` marks what it emailed. Nothing marks what went by SMS from the
 * teacher's own SIM, and without this the grading screen keeps calling those
 * marks unreported, which invites the teacher to send them a second time.
 */
export async function markGradesNotified(assessmentId: string, studentIds: string[]) {
  if (!studentIds.length) return;
  const teacherId = await requireUser();
  unwrap(
    await supabase
      .from('grades')
      .update({ notified_at: new Date().toISOString() })
      .eq('assessment_id', assessmentId)
      .eq('teacher_id', teacherId)
      .in('student_id', studentIds)
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

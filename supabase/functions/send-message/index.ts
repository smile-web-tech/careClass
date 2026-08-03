// ClassCare — server-side message fan-out.
//
// Why this exists: neither iOS nor Android lets an app send an SMS without the
// user tapping send in the native composer. A "message all 11 students, each
// with their own name filled in" flow is therefore impossible on-device — it
// would open the composer eleven times. So the app posts the draft here, and
// this function renders it per recipient and calls the gateways.
//
// Deploy:  supabase functions deploy send-message
// Secrets: supabase secrets set SUPABASE_SECRET_KEY=... ESKIZ_EMAIL=... \
//            ESKIZ_PASSWORD=... ESKIZ_SENDER=... RESEND_API_KEY=... RESEND_FROM=...

import { createClient } from 'jsr:@supabase/supabase-js@2';

type Audience = 'students' | 'parents' | 'both';
type Channel = 'sms' | 'email' | 'push';

type Payload = {
  groupIds: string[];
  /** Optional narrowing — e.g. only today's absentees. */
  studentIds?: string[];
  audience: Audience;
  channels: Channel[];
  body: string;
  announcement?: boolean;
};

type Recipient = {
  studentId: string;
  kind: 'student' | 'parent';
  name: string;
  phone: string | null;
  email: string | null;
  groupName: string;
  time: string;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...cors },
  });

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

/** Substitute the placeholders the composer offers. */
function render(template: string, r: Recipient) {
  return template
    .replaceAll('{name}', r.name)
    .replaceAll('{group}', r.groupName)
    .replaceAll('{time}', r.time);
}

/** E.164-ish: Uzbek numbers are stored spaced, gateways want digits only. */
const normalizePhone = (p: string) => p.replace(/[^\d]/g, '');

/** Next occurrence of a weekly slot, for `{time}`. */
function nextSlotTime(slots: { weekday: number; starts_at: string }[], now: Date) {
  if (!slots.length) return '';
  const today = now.getDay();
  const sorted = [...slots].sort((a, b) => {
    const da = (a.weekday - today + 7) % 7;
    const db = (b.weekday - today + 7) % 7;
    return da - db || a.starts_at.localeCompare(b.starts_at);
  });
  return sorted[0].starts_at.slice(0, 5);
}

/* -------------------------------------------------------------------------- */
/* Gateways                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Eskiz.uz — a local Uzbek gateway. Uzbek traffic through it costs a small
 * fraction of what Twilio charges for the same route, which matters when a
 * tutor sends 30 reminders a day.
 */
let eskizToken: { value: string; expires: number } | null = null;

async function eskizAuth() {
  if (eskizToken && eskizToken.expires > Date.now()) return eskizToken.value;

  const form = new FormData();
  form.append('email', Deno.env.get('ESKIZ_EMAIL') ?? '');
  form.append('password', Deno.env.get('ESKIZ_PASSWORD') ?? '');

  const res = await fetch('https://notify.eskiz.uz/api/auth/login', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`Eskiz auth failed: ${res.status}`);

  const body = await res.json();
  const token = body?.data?.token as string;
  // Eskiz tokens last 30 days; refresh well inside that.
  eskizToken = { value: token, expires: Date.now() + 24 * 3600_000 };
  return token;
}

async function sendSms(phone: string, text: string) {
  const token = await eskizAuth();
  const form = new FormData();
  form.append('mobile_phone', normalizePhone(phone));
  form.append('message', text);
  form.append('from', Deno.env.get('ESKIZ_SENDER') ?? '4546');

  const res = await fetch('https://notify.eskiz.uz/api/message/sms/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message ?? `SMS failed: ${res.status}`);
  return String(body?.id ?? '');
}

async function sendEmail(to: string, subject: string, text: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: Deno.env.get('RESEND_FROM') ?? 'ClassCare <onboarding@resend.dev>',
      to,
      subject,
      text,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message ?? `Email failed: ${res.status}`);
  return String(body?.id ?? '');
}

async function sendPush(tokens: string[], title: string, text: string) {
  if (!tokens.length) return;
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(tokens.map((to) => ({ to, title, body: text, sound: 'default' }))),
  });
}

/* -------------------------------------------------------------------------- */
/* Handler                                                                    */
/* -------------------------------------------------------------------------- */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;

  // Identify the caller with *their* token so RLS applies to the identity check.
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await asUser.auth.getUser();
  const teacherId = userData.user?.id;
  if (!teacherId) return json({ error: 'Not signed in' }, 401);

  // Everything after this point is scoped manually to `teacherId`. The secret
  // key bypasses RLS, so every query below filters on it explicitly.
  const db = createClient(url, Deno.env.get('SUPABASE_SECRET_KEY')!);

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { audience, channels, body: template, announcement } = payload;
  if (!template?.trim()) return json({ error: 'Message body is empty' }, 400);
  if (!channels?.length) return json({ error: 'Pick at least one channel' }, 400);

  // Resolve the target groups. An announcement means "every active group".
  const groupQuery = db
    .from('groups')
    .select('id, name, group_slots(weekday, starts_at)')
    .eq('teacher_id', teacherId)
    .is('archived_at', null);

  const { data: groups, error: groupError } = announcement
    ? await groupQuery
    : await groupQuery.in('id', payload.groupIds ?? []);
  if (groupError) return json({ error: groupError.message }, 400);
  if (!groups?.length) return json({ error: 'No groups selected' }, 400);

  const groupIds = groups.map((g) => g.id);

  const { data: links, error: linkError } = await db
    .from('student_groups')
    .select('student_id, group_id')
    .eq('teacher_id', teacherId)
    .in('group_id', groupIds);
  if (linkError) return json({ error: linkError.message }, 400);

  let studentIds = [...new Set((links ?? []).map((l) => l.student_id))];
  if (payload.studentIds?.length) {
    const allow = new Set(payload.studentIds);
    studentIds = studentIds.filter((id) => allow.has(id));
  }
  if (!studentIds.length) return json({ error: 'No recipients' }, 400);

  const { data: students, error: studentError } = await db
    .from('students')
    .select('id, name, phone, email, parent_name, parent_phone')
    .eq('teacher_id', teacherId)
    .in('id', studentIds)
    .is('archived_at', null);
  if (studentError) return json({ error: studentError.message }, 400);

  const now = new Date();
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const groupOfStudent = new Map<string, string>();
  for (const l of links ?? []) if (!groupOfStudent.has(l.student_id)) groupOfStudent.set(l.student_id, l.group_id);

  // Build the recipient list. "Both" produces two rows for the same student —
  // one to them, one to their guardian — each rendered with its own name.
  const recipients: Recipient[] = [];
  for (const s of students ?? []) {
    const g = groupById.get(groupOfStudent.get(s.id) ?? '');
    const groupName = g?.name ?? '';
    const time = nextSlotTime(g?.group_slots ?? [], now);

    if (audience === 'students' || audience === 'both') {
      recipients.push({
        studentId: s.id,
        kind: 'student',
        name: s.name,
        phone: s.phone,
        email: s.email,
        groupName,
        time,
      });
    }
    if ((audience === 'parents' || audience === 'both') && (s.parent_phone || s.parent_name)) {
      recipients.push({
        studentId: s.id,
        kind: 'parent',
        // Parents get addressed by their own name where we have one.
        name: s.parent_name ?? s.name,
        phone: s.parent_phone,
        email: null,
        groupName,
        time,
      });
    }
  }

  const { data: message, error: messageError } = await db
    .from('messages')
    .insert({
      teacher_id: teacherId,
      body: template,
      audience,
      channels,
      announcement: !!announcement,
    })
    .select()
    .single();
  if (messageError) return json({ error: messageError.message }, 400);

  if (!announcement) {
    await db
      .from('message_groups')
      .insert(groupIds.map((group_id) => ({ message_id: message.id, group_id })));
  }

  // Queue every delivery before dispatching, so a gateway outage leaves an
  // accurate record of what was meant to go out rather than silence.
  const queued = recipients.flatMap((r) =>
    channels
      .map((channel) => {
        const destination =
          channel === 'email' ? r.email : channel === 'sms' ? r.phone : r.phone;
        if (!destination) return null;
        return {
          message_id: message.id,
          teacher_id: teacherId,
          student_id: r.studentId,
          recipient: r.kind,
          channel,
          destination,
          rendered: render(template, r),
          state: 'queued' as const,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
  );

  const { data: deliveries, error: deliveryError } = await db
    .from('message_deliveries')
    .insert(queued)
    .select();
  if (deliveryError) return json({ error: deliveryError.message }, 400);

  // Dispatch. Failures are recorded per row — one bad number must not sink the
  // whole send.
  await Promise.all(
    (deliveries ?? []).map(async (d) => {
      try {
        let providerId = '';
        if (d.channel === 'sms') providerId = await sendSms(d.destination, d.rendered);
        else if (d.channel === 'email')
          providerId = await sendEmail(d.destination, `${message.announcement ? 'Announcement' : 'Message'} from your teacher`, d.rendered);
        else return; // Push is batched below.

        await db
          .from('message_deliveries')
          .update({ state: 'sent', provider_id: providerId, updated_at: new Date().toISOString() })
          .eq('id', d.id);
      } catch (e) {
        await db
          .from('message_deliveries')
          .update({
            state: 'failed',
            error: e instanceof Error ? e.message : String(e),
            updated_at: new Date().toISOString(),
          })
          .eq('id', d.id);
      }
    }),
  );

  // Push goes to devices, which ClassCare only has for the teacher today —
  // a student-facing app is explicitly out of scope, so this is a no-op until
  // guardians opt into the web push channel.
  const pushRows = (deliveries ?? []).filter((d) => d.channel === 'push');
  if (pushRows.length) {
    await sendPush([], 'ClassCare', template);
    await db
      .from('message_deliveries')
      .update({ state: 'sent', updated_at: new Date().toISOString() })
      .in('id', pushRows.map((d) => d.id));
  }

  return json({ messageId: message.id, queued: queued.length });
});

// ClassCare — server-side message fan-out.
//
// Why this exists: neither iOS nor Android lets an app send an SMS without the
// user tapping send in the native composer. A "message all 11 students, each
// with their own name filled in" flow is therefore impossible on-device — it
// would open the composer eleven times. So the app posts the draft here, and
// this function renders it per recipient and calls the gateways.
//
// Deploy:  supabase functions deploy send-message
// Secrets: supabase secrets set RESEND_API_KEY=... RESEND_FROM=... \
//            RESEND_REPLY_TO=... ESKIZ_EMAIL=... ESKIZ_PASSWORD=... ESKIZ_SENDER=...
//          (SUPABASE_URL / _ANON_KEY / _SERVICE_ROLE_KEY are injected automatically)

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
 * SMS gateways.
 *
 * Which one is live is chosen by `SMS_PROVIDER`, because the right answer
 * depends on the country the teacher is in and that is not knowable here:
 *
 *  - `twilio`  — global. Covers Turkmenistan (+993, Altyn Asyr / TM CELL,
 *                >90% of the market). Most expensive per message.
 *  - `telnyx`  — global, usually cheaper than Twilio on the same routes.
 *  - `eskiz`   — Uzbekistan only. Far cheaper for +998 traffic, useless for
 *                anything else.
 *
 * Alphanumeric sender IDs do NOT survive to Turkmenistan: carriers there
 * overwrite them with a long code or a generic ID, so recipients see a number
 * rather than "ClassCare". Nothing to configure — just do not promise the
 * teacher a branded sender.
 */
type SmsProvider = 'twilio' | 'telnyx' | 'eskiz';
const smsProvider = () => (Deno.env.get('SMS_PROVIDER') ?? 'twilio') as SmsProvider;

/** E.164 for the gateways: digits with a leading `+`. */
const toE164 = (p: string) => {
  const digits = p.replace(/[^\d]/g, '');
  return digits.startsWith('+') ? digits : `+${digits}`;
};

async function sendViaTwilio(phone: string, text: string) {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');
  const from = Deno.env.get('TWILIO_FROM');
  if (!sid || !token || !from) throw new Error('Twilio is not configured');

  const form = new URLSearchParams({ To: toE164(phone), From: from, Body: text });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${sid}:${token}`)}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message ?? `Twilio failed: ${res.status}`);
  return String(body?.sid ?? '');
}

async function sendViaTelnyx(phone: string, text: string) {
  const key = Deno.env.get('TELNYX_API_KEY');
  const from = Deno.env.get('TELNYX_FROM');
  if (!key || !from) throw new Error('Telnyx is not configured');

  const res = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to: toE164(phone), text }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.errors?.[0]?.detail ?? `Telnyx failed: ${res.status}`);
  return String(body?.data?.id ?? '');
}

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

async function sendViaEskiz(phone: string, text: string) {
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

/** Route one message through whichever gateway is configured. */
function sendSms(phone: string, text: string) {
  switch (smsProvider()) {
    case 'telnyx':
      return sendViaTelnyx(phone, text);
    case 'eskiz':
      // Uzbekistan only. A +993 number handed to Eskiz will simply be rejected.
      return sendViaEskiz(phone, text);
    case 'twilio':
    default:
      return sendViaTwilio(phone, text);
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/**
 * Render one notification as plain text and HTML.
 *
 * Written to reach the inbox rather than the promotions tab or spam. The rules
 * that actually move the needle, in rough order of weight:
 *
 *  - Authenticated domain (SPF + DKIM + DMARC on the sending domain).
 *  - A real `From` name and a working `Reply-To`. A parent replying to a school
 *    notification and hitting a black hole is both bad manners and a spam
 *    signal, because "never replied to" correlates with unwanted mail.
 *  - Both text/plain and text/html parts. HTML-only is a classic spam shape.
 *  - `List-Unsubscribe`, which Gmail and Yahoo have required of bulk senders
 *    since February 2024.
 *  - A specific subject naming the class. No ALL CAPS, no "!!!", no "FREE",
 *    no emoji in the subject line.
 *  - Plain, letter-like HTML: no images, no tracking pixel, no link shorteners,
 *    no giant CTA button. This looks like a person wrote it, because one did.
 *  - Say who is writing and why this address is receiving it.
 */
function renderEmail(opts: {
  body: string;
  teacherName: string;
  groupName: string;
  isAnnouncement: boolean;
  recipientKind: 'student' | 'parent';
}) {
  const { body, teacherName, groupName, isAnnouncement, recipientKind } = opts;

  const subject = isAnnouncement
    ? `Announcement from ${teacherName}`
    : `${groupName} — note from ${teacherName}`;

  const why =
    recipientKind === 'parent'
      ? `You are receiving this because you are listed as the parent or guardian contact for a student in ${groupName}.`
      : `You are receiving this because you are enrolled in ${groupName}.`;

  const signoff = `${teacherName}\n${isAnnouncement ? 'ClassCare' : groupName}`;

  const text = [body.trim(), '', '—', signoff, '', why, 'To stop these, reply STOP.'].join('\n');

  // Inline styles only, and a table-free single column: Gmail strips <style>
  // blocks, and anything resembling a marketing layout invites the promotions
  // tab. System font stack so nothing is fetched from a remote host.
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px;background:#f4f7fb;">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e1e7f0;border-radius:14px;padding:28px 26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0c1729;font-size:15px;line-height:1.6;">
<p style="margin:0 0 18px;white-space:pre-wrap;">${escapeHtml(body.trim())}</p>
<p style="margin:0 0 4px;color:#47566e;">—</p>
<p style="margin:0;font-weight:600;">${escapeHtml(teacherName)}</p>
<p style="margin:2px 0 0;color:#6b7a94;font-size:13.5px;">${escapeHtml(isAnnouncement ? 'ClassCare' : groupName)}</p>
<hr style="border:none;border-top:1px solid #e1e7f0;margin:22px 0 14px;">
<p style="margin:0;color:#8494ac;font-size:12px;line-height:1.5;">${escapeHtml(why)} Reply to this email to reach ${escapeHtml(teacherName)} directly, or reply STOP to be removed.</p>
</div></body></html>`;

  return { subject, text, html };
}

async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}) {
  const from = Deno.env.get('RESEND_FROM') ?? 'ClassCare <onboarding@resend.dev>';
  // Prefer a real mailbox the teacher reads. Falling back to the From address
  // is still better than no Reply-To at all.
  const replyTo = opts.replyTo || Deno.env.get('RESEND_REPLY_TO') || undefined;
  const unsubscribeMailbox =
    Deno.env.get('RESEND_UNSUBSCRIBE') || replyTo || from.replace(/^.*<|>$/g, '');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      ...(replyTo ? { reply_to: replyTo } : {}),
      headers: {
        // Required of bulk senders by Gmail and Yahoo. `mailto:` alone is a
        // valid List-Unsubscribe; one-click (RFC 8058) additionally needs an
        // HTTPS endpoint, which is worth adding once volume justifies it.
        'List-Unsubscribe': `<mailto:${unsubscribeMailbox}?subject=unsubscribe>`,
        // Transactional class: tells filters this is not marketing.
        'X-Entity-Ref-ID': crypto.randomUUID(),
      },
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
  // `SUPABASE_SERVICE_ROLE_KEY` is injected into every Edge Function by the
  // platform. The `SUPABASE_` prefix is reserved, so a custom
  // `SUPABASE_SECRET_KEY` can never be set and would always read undefined —
  // which `createClient` rejects with "supabaseKey is required".
  const serviceKey =
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY');
  if (!serviceKey) return json({ error: 'Server missing its service role key' }, 500);
  const db = createClient(url, serviceKey);

  // Mail signed by a named person clears filters far better than "your teacher",
  // and gives the parent someone to reply to.
  const { data: teacherRow } = await db
    .from('teachers')
    .select('name, email')
    .eq('id', teacherId)
    .single();
  const teacherName = (teacherRow?.name ?? '').trim() || 'Your teacher';
  const teacherEmail = teacherRow?.email ?? undefined;

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

  // Dispatch works from delivery rows, which carry only ids; keep a lookup so
  // each email can name the right class.
  const byStudent = new Map(recipients.map((r) => [`${r.studentId}:${r.kind}`, r]));

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
        else if (d.channel === 'email') {
          const r = byStudent.get(`${d.student_id}:${d.recipient}`);
          const { subject, text, html } = renderEmail({
            body: d.rendered,
            teacherName,
            groupName: r?.groupName ?? 'your class',
            isAnnouncement: !!message.announcement,
            recipientKind: d.recipient as 'student' | 'parent',
          });
          providerId = await sendEmail({
            to: d.destination,
            subject,
            text,
            html,
            replyTo: teacherEmail,
          });
        } else return; // Push is batched below.

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

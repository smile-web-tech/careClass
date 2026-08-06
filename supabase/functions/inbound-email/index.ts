// ClassCare — inbound email replies.
//
// Why this exists: `send-message` stamps each outgoing email with a Reply-To of
// `reply-<deliveryId>@<inbound domain>`. When a parent or student hits Reply,
// Resend receives it and calls this function, which turns it into a row in
// `replies` — the table the app's inbox, unread badge and realtime subscription
// have always read from and which, until now, nothing wrote to.
//
// The token in the address does the routing. Matching on the sender's address
// instead would be wrong in two ordinary cases: a parent who replies from a
// different account than the one on file, and a parent whose child is on two
// teachers' rosters.
//
// Deploy:  supabase functions deploy inbound-email --no-verify-jwt
//          (a webhook carries no Supabase JWT — without that flag every call
//           is rejected at the gateway before this code runs)
// Secrets: supabase secrets set RESEND_WEBHOOK_SECRET=whsec_... \
//            RESEND_INBOUND_DOMAIN=reply.yourdomain
//          (RESEND_API_KEY and RESEND_FROM are already set for sending)

import { createClient } from 'jsr:@supabase/supabase-js@2';

type InboundEvent = {
  type: string;
  data: {
    email_id: string;
    from: string;
    /** Usually an array; a single recipient can arrive as a bare string. */
    to: string[] | string;
    subject?: string;
    message_id?: string;
    received_for?: string[] | string;
  };
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/* -------------------------------------------------------------------------- */
/* Webhook authenticity                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Verify a Svix-signed webhook, which is what Resend sends.
 *
 * Done by hand rather than pulling the SDK in: the scheme is a HMAC over
 * `id.timestamp.body` and the whole of it fits in twenty lines, against a
 * dependency this function would otherwise not need at all.
 *
 * This endpoint is deployed with `--no-verify-jwt`, so this signature is the
 * *only* thing standing between the open internet and a function that writes
 * rows into a teacher's inbox. It fails closed.
 */
async function verifySvix(secret: string, headers: Headers, payload: string) {
  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const signatures = headers.get('svix-signature');
  if (!id || !timestamp || !signatures) return false;

  // Reject anything stale, so a signed request captured off the wire cannot be
  // replayed indefinitely. Five minutes is Svix's own tolerance.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  // `whsec_` prefixes a base64 key; the bytes after it are the HMAC secret.
  const raw = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const keyBytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${payload}`),
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  // The header carries a space-separated list of `v<version>,<signature>` so a
  // secret can be rotated without dropping messages. Any v1 match is enough.
  return signatures
    .split(' ')
    .filter((s) => s.startsWith('v1,'))
    .some((s) => timingSafeEqual(s.slice(3), expected));
}

/** Comparison whose duration does not depend on where the strings diverge. */
function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* -------------------------------------------------------------------------- */
/* Message parsing                                                            */
/* -------------------------------------------------------------------------- */

/** `"Gulnora R." <g@mail.com>` and `g@mail.com` both yield the bare address. */
const bareAddress = (s: string) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim().toLowerCase();

/** Pull the delivery id back out of `reply-<uuid>@domain`. */
function tokenFrom(addresses: string[]) {
  for (const a of addresses) {
    const m = bareAddress(a).match(/^reply-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Drop the quoted original from a reply.
 *
 * Mail clients append the entire message being answered. Left in, every card in
 * the teacher's inbox shows their own announcement back to them with two words
 * of reply on top. These are the markers Gmail, Outlook and Apple Mail actually
 * emit; anything unrecognised is left alone, because showing slightly too much
 * beats truncating what the parent wrote.
 */
function stripQuoted(text: string) {
  const cutters = [
    /^On .+ wrote:$/m,
    /^-{2,}\s*Original Message\s*-{2,}$/im,
    /^_{10,}$/m,
    /^From:\s.+$/m,
    /^Sent from my \w+$/m,
  ];

  let cut = text.length;
  for (const re of cutters) {
    const m = text.match(re);
    if (m?.index !== undefined && m.index < cut) cut = m.index;
  }

  return text
    .slice(0, cut)
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
    .trim();
}

/** Fetch the body. The webhook carries metadata only — by Resend's design. */
async function fetchBody(emailId: string) {
  const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
    headers: { authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}` },
  });
  if (!res.ok) throw new Error(`Could not read inbound email: ${res.status}`);
  const body = await res.json();
  const text: string = body?.text ?? '';
  // Some clients send HTML only. A crude tag strip beats storing markup that
  // the reply card would render as literal angle brackets.
  const fallback = String(body?.html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ');
  return stripQuoted(text || fallback);
}

/** Notify the teacher in the mailbox they actually watch. */
async function forwardToTeacher(opts: {
  teacherEmail: string;
  authorName: string;
  authorAddress: string;
  context: string;
  subject: string;
  body: string;
}) {
  const from = Deno.env.get('RESEND_FROM');
  if (!from) return;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: opts.teacherEmail,
      subject: `Reply from ${opts.authorName}${opts.context ? ` · ${opts.context}` : ''}`,
      text: `${opts.body}\n\n—\nReplying to this email goes straight to ${opts.authorName}.`,
      // Straight back to the person who wrote, not to the token address. That
      // keeps the teacher's answer out of this function entirely, so a thread
      // cannot loop through the webhook.
      reply_to: opts.authorAddress,
    }),
  }).catch(() => {
    // The reply is already recorded; a failed courtesy copy must not make the
    // webhook non-2xx, because Resend would then redeliver the whole thing.
  });
}

/* -------------------------------------------------------------------------- */
/* Handler                                                                    */
/* -------------------------------------------------------------------------- */

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET');
  if (!secret) return json({ error: 'RESEND_WEBHOOK_SECRET is not set' }, 500);

  // Read once, as text: the signature covers the exact bytes sent, so parsing
  // first and re-serialising would verify something the sender never signed.
  const payload = await req.text();
  if (!(await verifySvix(secret, req.headers, payload))) {
    return json({ error: 'Bad signature' }, 401);
  }

  let event: InboundEvent;
  try {
    event = JSON.parse(payload);
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  // Anything else Resend may send here is acknowledged and ignored — a 4xx
  // would have it retry an event we are never going to want.
  if (event.type !== 'email.received') return json({ ignored: event.type });

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Normalised, because a single recipient may arrive as a bare string rather
  // than a one-element array. Spreading a string yields its characters, and the
  // token lookup would then quietly find nothing and drop the reply.
  const asList = (v: string[] | string | undefined) =>
    Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];

  const recipients = [...asList(event.data.to), ...asList(event.data.received_for)];
  const deliveryId = tokenFrom(recipients);
  const authorAddress = bareAddress(event.data.from ?? '');

  // Resolve the delivery this is an answer to. The token is the reliable path;
  // the address lookup below is for mail that lost it — forwarded by hand, or
  // sent to the domain directly.
  let delivery: {
    teacher_id: string;
    student_id: string | null;
    recipient: string;
    message_id: string;
  } | null = null;

  if (deliveryId) {
    const { data } = await db
      .from('message_deliveries')
      .select('teacher_id, student_id, recipient, message_id')
      .eq('id', deliveryId)
      .maybeSingle();
    delivery = data;
  }

  if (!delivery && authorAddress) {
    // Most recent email delivery to this address, whoever it belonged to.
    const { data } = await db
      .from('message_deliveries')
      .select('teacher_id, student_id, recipient, message_id')
      .eq('channel', 'email')
      .ilike('destination', authorAddress)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    delivery = data;
  }

  // Nothing to attribute it to. Acknowledge so Resend stops retrying; the mail
  // is still stored on Resend's side if anyone wants to go looking.
  if (!delivery) return json({ ignored: 'unattributable', from: authorAddress });

  const [{ data: student }, { data: teacher }, { data: messageGroup }] = await Promise.all([
    delivery.student_id
      ? db
          .from('students')
          .select('name, parent_name')
          .eq('id', delivery.student_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('teachers').select('email').eq('id', delivery.teacher_id).maybeSingle(),
    db
      .from('message_groups')
      .select('groups(name)')
      .eq('message_id', delivery.message_id)
      .limit(1)
      .maybeSingle(),
  ]);

  const fromParent = delivery.recipient === 'parent';
  const studentName = student?.name ?? '';
  const authorName = fromParent
    ? (student?.parent_name ?? (studentName ? `Parent of ${studentName}` : 'Parent'))
    : studentName || authorAddress;

  const groupName =
    (messageGroup as { groups?: { name?: string } | null } | null)?.groups?.name ?? '';
  const context = fromParent
    ? `Parent of ${studentName || 'a student'}${groupName ? ` · ${groupName}` : ''}`
    : groupName;

  let body: string;
  try {
    body = await fetchBody(event.data.email_id);
  } catch (e) {
    // Retryable: the body lives on Resend and a 5xx here earns a redelivery.
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
  if (!body) body = '(empty reply)';

  const { error } = await db.from('replies').insert({
    teacher_id: delivery.teacher_id,
    student_id: delivery.student_id,
    author_name: authorName,
    context,
    body,
    inbound_message_id: event.data.message_id ?? null,
  });

  // 23505 is a unique violation: this webhook has been delivered before and the
  // reply is already in the inbox. That is a success, not a failure.
  if (error && error.code !== '23505') return json({ error: error.message }, 500);
  if (error) return json({ duplicate: true });

  if (teacher?.email) {
    await forwardToTeacher({
      teacherEmail: teacher.email,
      authorName,
      authorAddress,
      context,
      subject: event.data.subject ?? '',
      body,
    });
  }

  return json({ ok: true });
});

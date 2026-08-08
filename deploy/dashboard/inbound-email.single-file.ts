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
    /**
     * Resend's inbound payload. The bytes arrive base64 in `content`; older and
     * newer shapes have also used `content_type` vs `contentType` and a `url`
     * instead of inline content, so all of them are read defensively — a photo
     * of a child's homework is not worth losing to a field rename.
     */
    attachments?: {
      filename?: string;
      content?: string;
      content_type?: string;
      contentType?: string;
      url?: string;
      size?: number;
    }[];
  };
};

/** Anything a student could plausibly send back, and nothing executable. */
const INBOUND_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/gif',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const MAX_INBOUND_BYTES = 10 * 1024 * 1024;

/* ==========================================================================
 * Inlined from supabase/functions/_shared/fcm.ts.
 *
 * The dashboard editor deploys one file, and a relative import reaching into
 * a sibling folder is not something it can express. This copy exists only so
 * the function can be pasted in; the CLI deploys the real thing.
 * ========================================================================== */
// Firebase Cloud Messaging, HTTP v1.
//
// The legacy `/fcm/send` endpoint took a static server key in a header and was
// shut down in 2024. v1 wants a short-lived OAuth token, which means signing a
// JWT with the service account's private key and exchanging it. That is the
// whole of the complexity below.
//
// Not `exp.host`: Expo's push service is one more host that has to be reachable
// from the teacher's network, and this app already reaches Supabase through a
// reverse proxy because `*.supabase.co` is blocked in Turkmenistan. Talking to
// Google directly removes a dependency that could be filtered the same way, and
// the device token already comes from Play Services rather than Expo.
//
// Secret: supabase secrets set FCM_SERVICE_ACCOUNT="$(cat service-account.json)"

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

/** Cached across invocations of a warm instance; Google issues these for an hour. */
let cachedToken: { value: string; expires: number } | null = null;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlText = (s: string) => b64url(new TextEncoder().encode(s));

function serviceAccount(): ServiceAccount | null {
  const raw = Deno.env.get('FCM_SERVICE_ACCOUNT');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ServiceAccount;
  } catch {
    console.warn('[classcare] FCM_SERVICE_ACCOUNT is not valid JSON');
    return null;
  }
}

/** PEM to the raw PKCS#8 bytes `crypto.subtle` wants. */
function pemToBytes(pem: string) {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    // The JSON form carries literal `\n`; a pasted one carries real newlines.
    .replace(/\\n/g, '')
    .replace(/\s/g, '');
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

/** Sign the assertion and trade it for an access token. */
async function accessToken(account: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now()) return cachedToken.value;

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64urlText(
    JSON.stringify(claims),
  )}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBytes(account.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${b64url(new Uint8Array(signature))}`,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(body?.error_description ?? `FCM auth failed: ${res.status}`);
  }

  // Refresh a minute early rather than racing the expiry.
  cachedToken = { value: body.access_token, expires: Date.now() + (body.expires_in - 60) * 1000 };
  return cachedToken.value;
}

export type PushResult = { sent: number; stale: string[] };

/**
 * Send one notification to one device.
 *
 * Returns the token if FCM says it is dead, so the caller can clear it. A token
 * outlives an app reinstall in the database but not on the device, and pushing
 * to a stale one forever is how a `teachers` row ends up permanently unable to
 * receive anything.
 */
export async function sendPush(opts: {
  token: string;
  title: string;
  body: string;
  /** Delivered to the app so tapping the notification can open the right screen. */
  data?: Record<string, string>;
}): Promise<PushResult> {
  const account = serviceAccount();
  if (!account || !opts.token) return { sent: 0, stale: [] };

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await accessToken(account)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: opts.token,
          notification: { title: opts.title, body: opts.body },
          data: opts.data ?? {},
          android: {
            priority: 'high',
            notification: {
              // Matches the channel `lib/notifications.ts` creates; without it
              // Android 8+ drops the notification silently.
              channel_id: 'replies',
              sound: 'default',
            },
          },
          apns: { payload: { aps: { sound: 'default' } } },
        },
      }),
    },
  );

  if (res.ok) return { sent: 1, stale: [] };

  const body = await res.json().catch(() => ({}));
  const status = body?.error?.details?.[0]?.errorCode ?? body?.error?.status;

  // UNREGISTERED: the app was uninstalled or the token rotated.
  // INVALID_ARGUMENT on a token we sent: it was never valid.
  if (res.status === 404 || status === 'UNREGISTERED' || status === 'INVALID_ARGUMENT') {
    return { sent: 0, stale: [opts.token] };
  }

  throw new Error(body?.error?.message ?? `FCM send failed: ${res.status}`);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/* -------------------------------------------------------------------------- */
/* Inbound attachments                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Save whatever the student sent back.
 *
 * Runs after the reply row exists, and never fails the webhook: Resend retries
 * a non-2xx response, and retrying the whole delivery because one photo could
 * not be stored would duplicate the reply in the teacher's inbox. A missing
 * attachment is recoverable — the student can be asked again. A duplicated
 * inbox is not.
 *
 * Files land under the teacher's own folder, which is what the storage policy
 * in migration 0010 grants them read access to.
 */
type StorageWriter = {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        body: Uint8Array,
        options: { contentType: string; upsert: boolean },
      ): PromiseLike<{ error: { message: string } | null }>;
    };
  };
  from(table: string): {
    insert(rows: Record<string, unknown>[]): PromiseLike<{ error: { message: string } | null }>;
  };
};

/**
 * Typed structurally rather than as the client itself: `createClient`'s return
 * type carries schema generics that do not survive being named in a parameter,
 * and the two calls below are the entire surface this needs.
 */
async function storeInboundAttachments(
  db: StorageWriter,
  opts: {
    replyId: string;
    teacherId: string;
    attachments: NonNullable<InboundEvent['data']['attachments']>;
  },
) {
  const rows: Record<string, unknown>[] = [];

  for (const [index, att] of opts.attachments.entries()) {
    try {
      const filename = (att.filename ?? `attachment-${index + 1}`).slice(-80);
      const mime = att.content_type ?? att.contentType ?? 'application/octet-stream';
      if (!INBOUND_MIME.has(mime)) continue;

      let bytes: Uint8Array | null = null;

      if (att.content) {
        // Base64 inline. `atob` gives a binary string; the map turns it back
        // into the octets it stood for.
        const binary = atob(att.content);
        bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      } else if (att.url) {
        const res = await fetch(att.url);
        if (!res.ok) continue;
        bytes = new Uint8Array(await res.arrayBuffer());
      }

      if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_INBOUND_BYTES) continue;

      const key = filename.normalize('NFKD').replace(/[^\w.\-]+/g, '_') || `file-${index + 1}`;
      const storagePath = `${opts.teacherId}/replies/${opts.replyId}/${key}`;

      const { error: uploadError } = await db.storage
        .from('attachments')
        .upload(storagePath, bytes, { contentType: mime, upsert: true });
      if (uploadError) {
        console.warn('inbound attachment upload failed:', uploadError.message);
        continue;
      }

      rows.push({
        reply_id: opts.replyId,
        teacher_id: opts.teacherId,
        storage_path: storagePath,
        filename,
        mime_type: mime,
        size_bytes: bytes.byteLength,
      });
    } catch (e) {
      console.warn('inbound attachment skipped:', e instanceof Error ? e.message : String(e));
    }
  }

  if (rows.length) {
    const { error } = await db.from('reply_attachments').insert(rows);
    if (error) console.warn('could not record inbound attachments:', error.message);
  }
  return rows.length;
}

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
    const m = bareAddress(a).match(
      /^reply-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@/,
    );
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
  if (!res.ok) {
    // Worth naming loudly. A revoked or rotated RESEND_API_KEY makes every
    // reply vanish with no symptom a teacher could report beyond "parents
    // answer and nothing arrives", and 401 is the only place it shows.
    if (res.status === 401 || res.status === 403) {
      console.error(
        '[classcare] Resend rejected RESEND_API_KEY while reading an inbound email. ' +
          'Replies cannot be recorded until the secret is updated and this function redeployed.',
      );
    }
    throw new Error(`Could not read inbound email: ${res.status}`);
  }
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
    destination: string | null;
  } | null = null;

  if (deliveryId) {
    const { data } = await db
      .from('message_deliveries')
      .select('teacher_id, student_id, recipient, message_id, destination')
      .eq('id', deliveryId)
      .maybeSingle();
    delivery = data;
  }

  if (!delivery && authorAddress) {
    // Most recent email delivery to this address, whoever it belonged to.
    const { data } = await db
      .from('message_deliveries')
      .select('teacher_id, student_id, recipient, message_id, destination')
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
      ? db.from('students').select('name, parent_name').eq('id', delivery.student_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db
      .from('teachers')
      .select('email, push_token, language')
      .eq('id', delivery.teacher_id)
      .maybeSingle(),
    db
      .from('message_groups')
      .select('groups(name)')
      .eq('message_id', delivery.message_id)
      .limit(1)
      .maybeSingle(),
  ]);

  const fromParent = delivery.recipient === 'parent';
  const studentName = student?.name ?? '';

  /*
   * Only claim the reply came from the parent when it actually did.
   *
   * The `reply-<uuid>@` token identifies the delivery, not the sender. Anyone
   * who learns that address — a forwarded email, a shared mailbox — could
   * otherwise write into this teacher's inbox under the parent's name, and the
   * teacher would have no way to tell. A UUID is unguessable, so this is not a
   * broadcast risk, but "unguessable" is not "authenticated".
   *
   * The reply is still recorded either way. Silently dropping a mismatch would
   * lose the legitimate case that motivates this — a parent answering from a
   * second address, which is common and looks identical from here. Showing the
   * address it really came from lets the teacher judge.
   */
  const expected = (delivery.destination ?? '').trim().toLowerCase();
  const senderMatches = !expected || !authorAddress || expected === authorAddress;

  const claimedName = fromParent
    ? (student?.parent_name ?? (studentName ? `Parent of ${studentName}` : 'Parent'))
    : studentName || authorAddress;

  const authorName = senderMatches
    ? claimedName
    : `${authorAddress} (not ${claimedName}'s usual address)`;

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

  const { data: reply, error } = await db
    .from('replies')
    .insert({
      teacher_id: delivery.teacher_id,
      student_id: delivery.student_id,
      author_name: authorName,
      context,
      body,
      inbound_message_id: event.data.message_id ?? null,
    })
    .select('id')
    .single();

  // 23505 is a unique violation: this webhook has been delivered before and the
  // reply is already in the inbox. That is a success, not a failure.
  if (error && error.code !== '23505') return json({ error: error.message }, 500);
  if (error) return json({ duplicate: true });

  const inbound = event.data.attachments ?? [];
  if (reply?.id && inbound.length) {
    await storeInboundAttachments(db, {
      replyId: reply.id as string,
      teacherId: delivery.teacher_id,
      attachments: inbound,
    });
  }

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

  // Notify the phone. This is the whole point of the push feature: only the
  // server knows a parent wrote back, and the teacher is usually not looking at
  // the app when they do.
  if (teacher?.push_token) {
    try {
      const { stale } = await sendPush({
        token: teacher.push_token,
        title: authorName,
        // First line only. A notification is a summons, not the message.
        body: body.split('\n')[0].slice(0, 140),
        // `replyId` is what makes the tap land on the message itself rather
        // than on the inbox. Absent only when the row already existed, which
        // returns above, so in practice it is always here — but the app falls
        // back to the list rather than trusting that.
        data: {
          kind: 'reply',
          teacherId: delivery.teacher_id,
          ...(reply?.id ? { replyId: String(reply.id) } : {}),
        },
      });

      // FCM says the app is gone or the token rotated. Clear it, or every
      // future reply retries a token that can never work again.
      if (stale.length) {
        await db.from('teachers').update({ push_token: null }).eq('id', delivery.teacher_id);
      }
    } catch (e) {
      // The reply is recorded and forwarded; a failed notification must not
      // make this webhook non-2xx, because Resend would redeliver the lot.
      console.warn('[classcare] reply push failed:', e instanceof Error ? e.message : e);
    }
  }

  return json({ ok: true });
});

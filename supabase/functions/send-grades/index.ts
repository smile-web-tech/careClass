// ClassCare — grade notifications.
//
// One email per graded student, each carrying only that student's own mark.
// Separate from `send-message` because the body is not a template the teacher
// typed: it is generated from the assessment and the score, and getting a mark
// in front of the wrong parent is the single worst thing this app could do.
// Keeping the two paths apart means the recipient list here is derived from
// `grades` rows and nothing else.
//
// Deploy:  supabase functions deploy send-grades
// Secrets: the same RESEND_* set that send-message already uses.

import { createClient } from 'jsr:@supabase/supabase-js@2';

type Audience = 'students' | 'parents' | 'both';

type Payload = { assessmentId: string; audience: Audience };

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...cors },
  });

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const KIND_LABEL: Record<string, string> = {
  quiz: 'quiz',
  exam: 'exam',
  final: 'final exam',
};

/** One decimal, but no trailing `.0` — "17" reads better than "17.0". */
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/* -------------------------------------------------------------------------- */
/* The email                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Render one result as plain text and HTML.
 *
 * Written to reach the inbox rather than the promotions tab or spam, which for
 * a message a student is waiting for matters more than usual. The rules that
 * carry the weight, in rough order:
 *
 *  - Authenticated domain (SPF + DKIM + DMARC), already set up for sending.
 *  - A real `From` name and a working `Reply-To`. A student replying to ask
 *    about their mark and hitting a black hole is both rude and a spam signal.
 *  - Both text/plain and text/html parts. HTML-only is a classic spam shape.
 *  - `List-Unsubscribe`, required of bulk senders by Gmail and Yahoo.
 *  - A specific subject naming the assessment. No ALL CAPS, no "!!!", no
 *    "FREE", no emoji, and crucially no score in the subject line — a mark
 *    visible on a lock screen is nobody else's business.
 *  - Plain, letter-like HTML: no images, no tracking pixel, no link shorteners,
 *    no giant CTA button. Marketing shapes are what filters look for.
 *  - Say who is writing and why this address is receiving it.
 *
 * Deliberately no praise or criticism in the generated copy. A number and its
 * context is a fact; "well done" or "you must try harder" from an automated
 * mail the teacher never read is a judgement they did not make.
 */
function renderGradeEmail(opts: {
  recipientName: string;
  studentName: string;
  isParent: boolean;
  teacherName: string;
  groupName: string;
  kind: string;
  title: string;
  score: number;
  maxScore: number;
  takenOn: string;
}) {
  const kindLabel = KIND_LABEL[opts.kind] ?? opts.kind;
  const percent = Math.round((opts.score / opts.maxScore) * 1000) / 10;
  const subject = `${opts.groupName} — ${opts.title} result`;

  const line = opts.isParent
    ? `${opts.studentName} scored ${num(opts.score)} out of ${num(opts.maxScore)} (${percent}%) on the ${kindLabel} "${opts.title}".`
    : `You scored ${num(opts.score)} out of ${num(opts.maxScore)} (${percent}%) on the ${kindLabel} "${opts.title}".`;

  const why = opts.isParent
    ? `You are receiving this because you are listed as the parent or guardian contact for ${opts.studentName} in ${opts.groupName}.`
    : `You are receiving this because you are enrolled in ${opts.groupName}.`;

  const text = [
    `Hi ${opts.recipientName},`,
    '',
    line,
    `Sat on ${opts.takenOn}.`,
    '',
    'Reply to this email if you have a question about it.',
    '',
    '—',
    opts.teacherName,
    opts.groupName,
    '',
    why,
    'To stop these, reply STOP.',
  ].join('\n');

  // Inline styles only, single column, no table layout: Gmail strips <style>
  // blocks, and anything resembling a marketing layout invites the promotions
  // tab. System font stack so nothing is fetched from a remote host.
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px;background:#f4f7fb;">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e1e7f0;border-radius:14px;padding:28px 26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0c1729;font-size:15px;line-height:1.6;">
<p style="margin:0 0 16px;">Hi ${escapeHtml(opts.recipientName)},</p>
<p style="margin:0 0 6px;">${escapeHtml(line)}</p>
<p style="margin:0 0 18px;color:#6b7a94;font-size:13.5px;">Sat on ${escapeHtml(opts.takenOn)}.</p>
<p style="margin:0 0 18px;">Reply to this email if you have a question about it.</p>
<p style="margin:0 0 4px;color:#47566e;">—</p>
<p style="margin:0;font-weight:600;">${escapeHtml(opts.teacherName)}</p>
<p style="margin:2px 0 0;color:#6b7a94;font-size:13.5px;">${escapeHtml(opts.groupName)}</p>
<hr style="border:none;border-top:1px solid #e1e7f0;margin:22px 0 14px;">
<p style="margin:0;color:#8494ac;font-size:12px;line-height:1.5;">${escapeHtml(why)} Reply to this email to reach ${escapeHtml(opts.teacherName)} directly, or reply STOP to be removed.</p>
</div></body></html>`;

  return { subject, text, html };
}

async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  unsubscribeTo?: string;
}) {
  const from = Deno.env.get('RESEND_FROM');
  if (!from) {
    throw new Error(
      'RESEND_FROM is not set, so email can only reach the Resend account owner. ' +
        'Run: supabase secrets set RESEND_FROM="ClassCare <notifications@yourdomain>"',
    );
  }
  if (!Deno.env.get('RESEND_API_KEY')) throw new Error('RESEND_API_KEY is not set');

  const replyTo = opts.replyTo || Deno.env.get('RESEND_REPLY_TO') || undefined;
  const unsubscribeMailbox =
    Deno.env.get('RESEND_UNSUBSCRIBE') ||
    opts.unsubscribeTo ||
    Deno.env.get('RESEND_REPLY_TO') ||
    from.replace(/^.*<|>$/g, '');

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

/* -------------------------------------------------------------------------- */
/* Handler                                                                    */
/* -------------------------------------------------------------------------- */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;

  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await asUser.auth.getUser();
  const teacherId = userData.user?.id;
  if (!teacherId) return json({ error: 'Not signed in' }, 401);

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceKey) return json({ error: 'Server missing its service role key' }, 500);
  const db = createClient(url, serviceKey);

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!payload.assessmentId) return json({ error: 'No assessment was chosen' }, 400);

  const { data: teacherRow } = await db
    .from('teachers')
    .select('name, email')
    .eq('id', teacherId)
    .maybeSingle();
  const teacherName = (teacherRow?.name ?? '').trim() || 'Your teacher';
  const teacherEmail = teacherRow?.email ?? undefined;

  // Scoped to this teacher explicitly: the service key bypasses RLS.
  const { data: assessment, error: assessmentError } = await db
    .from('assessments')
    .select('id, group_id, kind, title, max_score, taken_on, groups(name)')
    .eq('id', payload.assessmentId)
    .eq('teacher_id', teacherId)
    .maybeSingle();
  if (assessmentError) return json({ error: assessmentError.message }, 400);
  if (!assessment) return json({ error: 'That assessment no longer exists.' }, 404);

  const groupName =
    (assessment as { groups?: { name?: string } | null }).groups?.name ?? 'your class';

  const { data: grades, error: gradesError } = await db
    .from('grades')
    .select('id, student_id, score, students(name, email, parent_name, parent_email)')
    .eq('assessment_id', assessment.id)
    .eq('teacher_id', teacherId);
  if (gradesError) return json({ error: gradesError.message }, 400);
  if (!grades?.length) return json({ error: 'No marks have been entered yet.' }, 400);

  const audience: Audience = payload.audience ?? 'students';

  let notified = 0;
  let failed = 0;
  let skipped = 0;
  const errors = new Set<string>();
  const sentGradeIds: string[] = [];

  await Promise.all(
    grades.map(async (grade) => {
      const student = (
        grade as unknown as {
          students: {
            name: string;
            email: string | null;
            parent_name: string | null;
            parent_email: string | null;
          } | null;
        }
      ).students;
      if (!student) {
        skipped += 1;
        return;
      }

      // One row per address we actually hold. A student with no email is not an
      // error — it is a fact the grading screen already shows.
      const targets: { to: string; name: string; isParent: boolean }[] = [];
      if ((audience === 'students' || audience === 'both') && student.email) {
        targets.push({ to: student.email, name: student.name, isParent: false });
      }
      if ((audience === 'parents' || audience === 'both') && student.parent_email) {
        targets.push({
          to: student.parent_email,
          name: student.parent_name ?? 'there',
          isParent: true,
        });
      }

      if (!targets.length) {
        skipped += 1;
        return;
      }

      let anySent = false;
      for (const target of targets) {
        try {
          const { subject, text, html } = renderGradeEmail({
            recipientName: target.name,
            studentName: student.name,
            isParent: target.isParent,
            teacherName,
            groupName,
            kind: assessment.kind,
            title: assessment.title,
            score: Number(grade.score),
            maxScore: Number(assessment.max_score),
            takenOn: assessment.taken_on,
          });

          await sendEmail({
            to: target.to,
            subject,
            text,
            html,
            replyTo: teacherEmail,
            unsubscribeTo: teacherEmail,
          });
          notified += 1;
          anySent = true;
        } catch (e) {
          failed += 1;
          errors.add(e instanceof Error ? e.message : String(e));
        }
      }

      if (anySent) sentGradeIds.push(grade.id);
    }),
  );

  // Stamp only the ones that actually went, so the screen's "not yet reported"
  // list stays honest and a retry re-sends exactly what failed.
  if (sentGradeIds.length) {
    await db
      .from('grades')
      .update({ notified_at: new Date().toISOString() })
      .in('id', sentGradeIds);
  }

  return json({
    assessmentId: assessment.id,
    notified,
    failed,
    skipped,
    errors: [...errors],
  });
});

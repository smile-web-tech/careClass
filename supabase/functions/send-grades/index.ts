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

type Payload = {
  assessmentId: string;
  audience: Audience;
  /**
   * The teacher's own wording, with `{score}`-style placeholders still in it.
   *
   * Sent up rather than read from `teachers.grade_template` so that a teacher
   * who has not written one gets the app's default *in the language they are
   * using*. The catalogue lives in the app; the server has no copy of it and
   * should not grow one.
   */
  template?: string;
  /**
   * The wording for a mark below `passMark`.
   *
   * One send covers a whole class, and a class is rarely all one thing. The
   * function picks per student rather than the app sending twice, which would
   * mean two round trips and two chances for half of them to fail.
   */
  failTemplate?: string;
  /** Null or absent means no threshold, and everything is reported as a pass. */
  passMark?: number | null;
  /**
   * The three sentences around the message that are not the teacher's words:
   * why this address is receiving it, and how to stop. Also translated by the
   * app for the same reason.
   */
  labels?: { whyStudent?: string; whyParent?: string; stop?: string; reply?: string };
};

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
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const KIND_LABEL: Record<string, string> = {
  quiz: 'quiz',
  exam: 'exam',
  final: 'final exam',
};

/**
 * The wording used when the app sends none.
 *
 * Only reachable from an older build of the app, which is why it is English:
 * this file has no catalogue and inventing one here would be a second place
 * for the same strings to drift.
 */
const FALLBACK_TEMPLATE =
  'Hi {name}, {student} scored {score} out of {max} ({percent}%) on the {kind} ' +
  '"{title}" in {group}. Sat on {date}. {teacher}';

/** Substitute the teacher's placeholders. Mirrors `src/lib/gradeTemplate.ts`. */
function fillTemplate(
  template: string,
  vars: {
    name: string;
    student: string;
    group: string;
    title: string;
    kind: string;
    score: number;
    max: number;
    percent: number;
    date: string;
    teacher: string;
  },
) {
  return template
    .replaceAll('{name}', vars.name)
    .replaceAll('{student}', vars.student)
    .replaceAll('{group}', vars.group)
    .replaceAll('{title}', vars.title)
    .replaceAll('{kind}', vars.kind)
    .replaceAll('{score}', num(vars.score))
    .replaceAll('{max}', num(vars.max))
    .replaceAll('{percent}', String(Math.round(vars.percent * 10) / 10))
    .replaceAll('{date}', vars.date)
    .replaceAll('{teacher}', vars.teacher);
}

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
  template: string;
  labels: { whyStudent?: string; whyParent?: string; stop?: string; reply?: string };
}) {
  const kindLabel = KIND_LABEL[opts.kind] ?? opts.kind;
  const percent = Math.round((opts.score / opts.maxScore) * 1000) / 10;

  /*
    No English in the subject, and no score in it either. The group and the
    assessment are both the teacher's own words, so this reads correctly in
    whatever language they wrote them in — and a mark visible on a lock screen
    is nobody else's business.
  */
  const subject = `${opts.groupName} · ${opts.title}`;

  // The teacher's sentence, with this student's numbers in it.
  const body = fillTemplate(opts.template, {
    name: opts.recipientName,
    student: opts.studentName,
    group: opts.groupName,
    title: opts.title,
    kind: kindLabel,
    score: opts.score,
    max: opts.maxScore,
    percent,
    date: opts.takenOn,
    teacher: opts.teacherName,
  }).trim();

  /*
    The footer lines take the same placeholders as the body, because they name
    the student and the class: "you are the guardian contact for {student} in
    {group}". Filling them through the same function is what lets the app send
    one translated sentence instead of one per recipient.
  */
  const fill = (line: string) =>
    fillTemplate(line, {
      name: opts.recipientName,
      student: opts.studentName,
      group: opts.groupName,
      title: opts.title,
      kind: kindLabel,
      score: opts.score,
      max: opts.maxScore,
      percent,
      date: opts.takenOn,
      teacher: opts.teacherName,
    });

  const why = fill(
    (opts.isParent ? opts.labels.whyParent : opts.labels.whyStudent) ??
      (opts.isParent
        ? 'You are receiving this because you are listed as the parent or guardian contact for {student} in {group}.'
        : 'You are receiving this because you are enrolled in {group}.'),
  );

  const stop = fill(opts.labels.stop ?? 'To stop these, reply STOP.');
  const reply = fill(opts.labels.reply ?? 'Reply to this email if you have a question about it.');

  const text = [body, '', reply, '', opts.teacherName, opts.groupName, '', why, stop].join('\n');

  // Inline styles only, single column, no table layout: Gmail strips <style>
  // blocks, and anything resembling a marketing layout invites the promotions
  // tab. System font stack so nothing is fetched from a remote host.
  const html = `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px;background:#ffffff;">
<div style="max-width:560px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0c1729;font-size:15px;line-height:1.6;">
<p style="margin:0 0 18px;white-space:pre-wrap;">${escapeHtml(body)}</p>
<p style="margin:0 0 18px;">${escapeHtml(reply)}</p>
<p style="margin:0;font-weight:600;">${escapeHtml(opts.teacherName)}</p>
<p style="margin:2px 0 0;color:#6b7a94;font-size:13.5px;">${escapeHtml(opts.groupName)}</p>
<hr style="border:none;border-top:1px solid #e1e7f0;margin:22px 0 14px;">
<p style="margin:0;color:#8494ac;font-size:12px;line-height:1.5;">${escapeHtml(why)} ${escapeHtml(stop)}</p>
</div></body></html>`;

  return { subject, text, html };
}

/**
 * Resend's rejection, restated for the person holding the phone.
 *
 * Passing Resend's own wording through is how a revoked key reached a teacher
 * as "API key is invalid" — unactionable, and a description of the backend to
 * anyone who can read the screen. Kept identical to `send-message` on purpose:
 * the same failure must not read differently depending on which screen the
 * teacher happened to be on.
 */
function resendFailure(status: number, body: { message?: string; name?: string }): string {
  const detail = body?.message ?? `HTTP ${status}`;

  if (status === 401 || status === 403) {
    console.error('[classcare] Resend rejected the credential:', detail);
    return 'Email is not set up on the server right now. Nothing was sent — please try again later.';
  }

  if (status === 429) {
    console.warn('[classcare] Resend rate limit:', detail);
    return 'Too many emails at once. Wait a moment and send the rest.';
  }

  if (status >= 500) {
    console.error('[classcare] Resend server error:', detail);
    return 'The mail service is having trouble. Nothing was sent — try again shortly.';
  }

  // A bad address is something the teacher can actually fix, so say which.
  console.warn('[classcare] Resend refused a message:', detail);
  return detail;
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
  if (!res.ok) throw new Error(resendFailure(res.status, body));
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
    .select('id, group_id, kind, kind_label, title, max_score, taken_on, groups(name)')
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

  /**
   * Which wording this mark gets.
   *
   * No pass mark means the teacher set none, and everything goes out with the
   * pass wording — quietly switching a class to failure notices because a
   * threshold was left blank would be the worst possible default. An absent
   * fail template does the same, so an older app that sends only one still
   * behaves exactly as it did.
   */
  const passTemplate = payload.template?.trim() || FALLBACK_TEMPLATE;
  const failTemplate = payload.failTemplate?.trim() || passTemplate;
  const passMark = typeof payload.passMark === 'number' ? payload.passMark : null;

  const pickTemplate = (score: number) =>
    passMark === null || score >= passMark ? passTemplate : failTemplate;

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
            template: pickTemplate(Number(grade.score)),
            labels: payload.labels ?? {},
            recipientName: target.name,
            studentName: student.name,
            isParent: target.isParent,
            teacherName,
            groupName,
            // The teacher's own name for it where there is one. `kind` is
            // only still read for assessments filed before they could name
            // their own types.
            kind: assessment.kind_label ?? assessment.kind ?? '',
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

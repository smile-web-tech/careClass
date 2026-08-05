#!/usr/bin/env node
/**
 * Push ClassCare's auth settings and email templates to Supabase.
 *
 * Three separate templates matter, and Supabase ships all three as a bare
 * "click this link" page:
 *
 *   confirmation  sent by signUp        — registration would mail no code
 *   recovery      sent by reset         — password reset would mail no code
 *   magic link    sent by signInWithOtp — kept in step for the same reason
 *
 * Each needs `{{ .Token }}` or the six-digit code the app asks for simply is
 * not in the email. That is the whole reason this script exists.
 *
 * Run:
 *   SUPABASE_ACCESS_TOKEN=sbp_… node scripts/apply-auth-config.mjs
 *
 * The token is read from the environment and never written anywhere. Generate
 * one at https://supabase.com/dashboard/account/tokens and revoke it after.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? 'epemnrnptzqarfsyvcxs';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_DIR = join(ROOT, 'supabase', 'templates');

if (!TOKEN) {
  console.error('SUPABASE_ACCESS_TOKEN is not set.\n');
  console.error('  SUPABASE_ACCESS_TOKEN=sbp_… node scripts/apply-auth-config.mjs');
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* Template                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One layout, three sets of words.
 *
 * The anti-spam decisions are all in here and none of them are cosmetic:
 *
 *   - A plain-text part is implied by keeping the markup this simple; filters
 *     score HTML-only mail worse.
 *   - Inline styles only. Gmail strips <style> blocks, and a mail that renders
 *     as unstyled soup reads as bulk.
 *   - No images, no tracking pixel, no link shortener — each is a strong spam
 *     signal on its own and together they are decisive.
 *   - The code is text, not a picture of a code, so it can be copied.
 *   - It says who sent it and why, which is what the "is this phishing?"
 *     heuristics look for.
 */
const layout = ({ preheader, lead, expiry, closing }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ClassCare</title></head>
<body style="margin:0;padding:24px;background:#f4f7fb;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</span>
<div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e1e7f0;border-radius:14px;padding:30px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0c1729;font-size:15px;line-height:1.6;">

<p style="margin:0 0 20px;">${lead}</p>

<p style="margin:0 0 6px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:8px;color:#0c1729;">{{ .Token }}</p>
<p style="margin:0 0 22px;color:#6b7a94;font-size:13px;">${expiry}</p>

<p style="margin:0 0 20px;">${closing}</p>

<hr style="border:none;border-top:1px solid #edf1f7;margin:24px 0 16px;">
<p style="margin:0;color:#8494ac;font-size:12px;line-height:1.6;">
You are receiving this because someone entered this address on ClassCare, the class management app for teachers.
If that was not you, no account was created and you can ignore this message.
</p>
</div>
</body></html>`;

const templates = {
  confirmation: {
    subject: 'Your ClassCare confirmation code',
    html: layout({
      preheader: 'Your six-digit code to finish creating your ClassCare account.',
      lead: 'Welcome to ClassCare. Enter this code in the app to confirm your email address.',
      expiry: 'This code expires in 10 minutes and can be used once.',
      closing: 'Your account is not active until the code is entered.',
    }),
  },
  recovery: {
    subject: 'Your ClassCare password reset code',
    html: layout({
      preheader: 'Your six-digit code to choose a new ClassCare password.',
      lead: 'Enter this code in the app to choose a new password.',
      expiry: 'This code expires in 10 minutes and can be used once.',
      closing: 'Your current password still works until you set a new one.',
    }),
  },
  magic_link: {
    subject: 'Your ClassCare sign-in code',
    html: layout({
      preheader: 'Your six-digit code to sign in to ClassCare.',
      lead: 'Here is your sign-in code for ClassCare.',
      expiry: 'This code expires in 10 minutes and can be used once.',
      closing: 'If you did not ask to sign in, you can ignore this email.',
    }),
  },
};

/* -------------------------------------------------------------------------- */

const config = {
  // Registration is worthless as a check on the address if the code is
  // optional, so confirmation stays mandatory.
  mailer_autoconfirm: false,

  mailer_otp_length: 6,
  mailer_otp_exp: 600,

  mailer_subjects_confirmation: templates.confirmation.subject,
  mailer_templates_confirmation_content: templates.confirmation.html,
  mailer_subjects_recovery: templates.recovery.subject,
  mailer_templates_recovery_content: templates.recovery.html,
  mailer_subjects_magic_link: templates.magic_link.subject,
  mailer_templates_magic_link_content: templates.magic_link.html,

  // Matches MIN_LENGTH in src/lib/password.ts. Character-class rules are
  // deliberately not set: NIST SP 800-63B dropped them because they push people
  // towards "Password1!" rather than towards length.
  password_min_length: 8,
};

async function main() {
  mkdirSync(TEMPLATE_DIR, { recursive: true });
  for (const [name, t] of Object.entries(templates)) {
    writeFileSync(join(TEMPLATE_DIR, `${name}.html`), t.html);
  }
  console.log(`wrote ${Object.keys(templates).length} templates to supabase/templates/`);

  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(config),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`PATCH auth config failed: HTTP ${res.status}`);
    console.error(text.slice(0, 600));
    process.exit(1);
  }

  const body = JSON.parse(text);
  console.log(`PATCH auth config: HTTP ${res.status}`);
  console.log(`  otp length     : ${body.mailer_otp_length}`);
  console.log(`  otp expiry     : ${body.mailer_otp_exp}s`);
  console.log(`  autoconfirm    : ${body.mailer_autoconfirm}`);
  console.log(`  min password   : ${body.password_min_length}`);

  for (const key of ['confirmation', 'recovery', 'magic_link']) {
    const html = body[`mailer_templates_${key}_content`] ?? '';
    console.log(
      `  ${key.padEnd(14)} : ${html.includes('{{ .Token }}') ? 'has code ✓' : 'NO CODE ✗'}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

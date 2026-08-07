#!/usr/bin/env bash
#
# Point Supabase Auth at Resend, then install the auth email templates.
#
# Two steps, in that order, because the second is refused without the first:
#
#   "Email template modification is not available for free tier projects using
#    the default email provider."
#
# That default provider is worth understanding, because it hid a real bug for a
# long time. It only delivers to members of the Supabase organisation, so every
# test by the project owner succeeds and every real teacher's verification code
# silently goes nowhere. It is also capped at a couple of messages an hour.
# Moving the app's own mail to Resend via the Edge Functions left this half
# behind: auth mail kept using it, so a password reset arrived as Supabase's
# stock *link* while the app sat waiting for a six-digit code.
#
# Every template here prints `{{ .Token }}`. The link form is deliberately
# unused: nothing in the app registers a deep-link handler, so a link would
# arrive at a screen that does not exist. A code can be typed on the device
# that asked for it — which on a filtered network is the one thing that always
# works.
#
# Usage:
#   read -rs SUPABASE_ACCESS_TOKEN && export SUPABASE_ACCESS_TOKEN
#   read -rs RESEND_KEY            && export RESEND_KEY
#   export MAIL_FROM="notifications@yourdomain"     # must be a verified Resend domain
#   ./supabase/templates/install.sh [project-ref]

set -euo pipefail

REF="${1:-epemnrnptzqarfsyvcxs}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API="https://api.supabase.com/v1/projects/$REF/config/auth"
MAIL_FROM_NAME="${MAIL_FROM_NAME:-ClassCare}"

die() { echo "$*" >&2; exit 1; }

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "SUPABASE_ACCESS_TOKEN is not set. Create one at" >&2
  echo "https://supabase.com/dashboard/account/tokens" >&2
  echo >&2
  die "  read -rs SUPABASE_ACCESS_TOKEN && export SUPABASE_ACCESS_TOKEN"
fi

# Checked here rather than left to the API, which answers a pasted placeholder
# with "JWT could not be decoded" — true, and no help at all in working out
# that the shell is holding the word `sbp_...` verbatim.
if [[ "$SUPABASE_ACCESS_TOKEN" != sbp_* || ${#SUPABASE_ACCESS_TOKEN} -lt 30 ]]; then
  echo "SUPABASE_ACCESS_TOKEN does not look like a personal access token." >&2
  echo "Expected sbp_ followed by ~40 hex characters; got ${#SUPABASE_ACCESS_TOKEN} characters" \
       "starting '${SUPABASE_ACCESS_TOKEN:0:4}'." >&2
  die "This is the account token from the dashboard, not the publishable or secret key."
fi

[[ -n "${RESEND_KEY:-}" ]] || die "RESEND_KEY is not set. Get one at https://resend.com/api-keys"
[[ "$RESEND_KEY" == re_* ]] || die "RESEND_KEY should start with re_; got '${RESEND_KEY:0:3}'."
[[ -n "${MAIL_FROM:-}" ]] || die 'MAIL_FROM is not set, e.g. export MAIL_FROM="notifications@yourdomain"'
[[ "$MAIL_FROM" == *@* ]] || die "MAIL_FROM must be an email address; got '$MAIL_FROM'."

for f in confirmation recovery magic_link; do
  [[ -f "$DIR/$f.html" ]] || die "missing $DIR/$f.html"
done

# Fail before touching the project if the key is dead. Sending no mail at all
# is the failure this script exists to end, and a rejected key would configure
# SMTP that cannot send while reporting success.
key_status=$(curl -s -o /dev/null -w '%{http_code}' https://api.resend.com/domains \
  -H "authorization: Bearer $RESEND_KEY")
[[ "$key_status" == "200" ]] || die "Resend rejected the key (HTTP $key_status). Nothing was changed."

patch() {
  local what="$1" body="$2" code
  code=$(curl -s -o /tmp/classcare-auth-config.json -w '%{http_code}' \
    -X PATCH "$API" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$body")
  if [[ "$code" != "200" ]]; then
    echo "$what failed: HTTP $code" >&2
    head -c 500 /tmp/classcare-auth-config.json >&2
    echo >&2
    exit 1
  fi
  echo "$what: ok"
}

# --- 1. SMTP ---------------------------------------------------------------
# Resend's SMTP username is the literal string "resend"; the password is the
# API key. Port 465 is implicit TLS, which Supabase's sender expects.
patch "SMTP" "$(python3 - <<'PY'
import json, os
print(json.dumps({
    "smtp_host": "smtp.resend.com",
    "smtp_port": "465",
    "smtp_user": "resend",
    "smtp_pass": os.environ["RESEND_KEY"],
    "smtp_admin_email": os.environ["MAIL_FROM"],
    "smtp_sender_name": os.environ.get("MAIL_FROM_NAME", "ClassCare"),
    # One message per minute per address. Supabase defaults to 60s already, but
    # stating it keeps a later dashboard edit from quietly loosening it.
    "smtp_max_frequency": 60,
}))
PY
)"

# --- 2. Templates ----------------------------------------------------------
patch "Templates" "$(python3 - "$DIR" <<'PY'
import json, sys, pathlib
d = pathlib.Path(sys.argv[1])
read = lambda n: (d / f"{n}.html").read_text(encoding="utf-8")
print(json.dumps({
    "mailer_subjects_confirmation": "Your ClassCare code",
    "mailer_templates_confirmation_content": read("confirmation"),
    "mailer_subjects_recovery": "Your ClassCare password reset code",
    "mailer_templates_recovery_content": read("recovery"),
    "mailer_subjects_magic_link": "Your ClassCare sign-in code",
    "mailer_templates_magic_link_content": read("magic_link"),
    # The templates all say "expires in 10 minutes"; make that true rather than
    # decorative. Supabase's default leaves a recovery code valid for an hour.
    "mailer_otp_exp": 600,
}))
PY
)"

echo
python3 - <<'PY'
import json
c = json.load(open("/tmp/classcare-auth-config.json"))
tpl = c.get("mailer_templates_recovery_content") or ""
print("  SMTP host                            :", c.get("smtp_host") or "(none)")
print("  Sender                               :", c.get("smtp_admin_email") or "(none)")
print("  recovery template carries {{ .Token }}:", "{{ .Token }}" in tpl)
print("  recovery template carries a link      :", "ConfirmationURL" in tpl)
print("  OTP expiry (seconds)                  :", c.get("mailer_otp_exp"))
PY

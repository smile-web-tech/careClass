#!/usr/bin/env bash
#
# Install the auth email templates onto the hosted project.
#
# These files are not applied by `supabase db push`, and `config.toml`'s
# template settings only affect a local stack. A hosted project reads its
# templates from the auth config, which is why a project can hold the right
# HTML in git and still send Supabase's stock email — as this one did, mailing
# teachers a reset *link* while the app sat waiting for a six-digit code that
# was never in the message.
#
# Every template here prints `{{ .Token }}`. The link form is deliberately
# unused: nothing in the app registers a deep-link handler, so a link would
# arrive at a screen that does not exist. A code can be typed on the device
# that asked for it, which is also the device most likely to be offline-ish on
# a filtered network.
#
# Usage:
#   export SUPABASE_ACCESS_TOKEN=sbp_...
#   ./supabase/templates/install.sh [project-ref]

set -euo pipefail

REF="${1:-epemnrnptzqarfsyvcxs}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "SUPABASE_ACCESS_TOKEN is not set. Create one at" >&2
  echo "https://supabase.com/dashboard/account/tokens" >&2
  echo >&2
  echo "  read -rs SUPABASE_ACCESS_TOKEN && export SUPABASE_ACCESS_TOKEN" >&2
  exit 1
fi

# Checked here rather than left to the API, which answers a pasted placeholder
# with "JWT could not be decoded" — true, and no help at all in working out
# that the shell is holding the word `sbp_...` verbatim.
if [[ "$SUPABASE_ACCESS_TOKEN" != sbp_* || ${#SUPABASE_ACCESS_TOKEN} -lt 30 ]]; then
  echo "SUPABASE_ACCESS_TOKEN does not look like a personal access token." >&2
  echo "Expected sbp_ followed by ~40 hex characters; got ${#SUPABASE_ACCESS_TOKEN} characters" \
       "starting '${SUPABASE_ACCESS_TOKEN:0:4}'." >&2
  echo "This is the account token from the dashboard, not the publishable or secret key." >&2
  exit 1
fi

for f in confirmation recovery magic_link; do
  [[ -f "$DIR/$f.html" ]] || { echo "missing $DIR/$f.html" >&2; exit 1; }
done

payload=$(python3 - "$DIR" <<'PY'
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
)

code=$(curl -s -o /tmp/classcare-auth-config.json -w '%{http_code}' \
  -X PATCH "https://api.supabase.com/v1/projects/$REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$payload")

if [[ "$code" != "200" ]]; then
  echo "failed: HTTP $code" >&2
  head -c 500 /tmp/classcare-auth-config.json >&2
  echo >&2
  exit 1
fi

echo "Templates installed on $REF."
python3 - <<'PY'
import json
c = json.load(open("/tmp/classcare-auth-config.json"))
tpl = c.get("mailer_templates_recovery_content") or ""
print("  recovery template carries {{ .Token }}:", "{{ .Token }}" in tpl)
print("  recovery template carries a link     :", "ConfirmationURL" in tpl)
print("  OTP expiry (seconds)                 :", c.get("mailer_otp_exp"))
print("  SMTP host                            :", c.get("smtp_host") or "(none - using Supabase's shared sender)")
PY

# ClassCare

Teacher-side class management for independent tutors. One teacher, their own
students, their own data — not a school LMS.

Groups · students · attendance in under 30 seconds · bulk SMS/email/push with
per-recipient placeholders · announcements · a week calendar · one search field
that matches groups, subjects and student names.

Built with **Expo SDK 57** (React Native 0.86, React 19.2) + **expo-router**,
targeting iOS, Android and web from one codebase.

---

## Running it

```bash
npm install
npm start          # then press i / a, or scan the QR code
npm run web        # browser
```

The app runs with no backend at all — `src/data/seed.ts` provides a full demo
roster, and the schedule is derived live from each group's weekly slots, so the
calendar is correct whatever day you open it.

## Connecting Supabase

```bash
cp .env.example .env      # fill in URL + publishable key
```

Once `EXPO_PUBLIC_SUPABASE_URL` points at a real project the app switches from
seed data to the backend automatically (`hasSupabase` in `src/lib/supabase.ts`).

**1. Apply the schema**

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

`supabase/migrations/0001_init.sql` creates every table plus row level security.
The policy is the same on all of them — `teacher_id = auth.uid()` — so a teacher
can only ever read or write their own rows.

**2. Enable auth providers**

Dashboard → Authentication → Providers → Google and Apple. Add the redirect URL
`classcare://auth/callback` for native, plus your web origin.

**3. Push the auth settings and email templates**

```bash
SUPABASE_ACCESS_TOKEN=sbp_… node scripts/apply-auth-config.mjs
```

Not optional. Registration and password reset both ask for a six-digit code,
and Supabase's stock emails contain a link and no code at all — so without this
step the teacher gets mail they cannot use. The script installs a code-bearing
template for confirmation, recovery and magic link, sets the code to six digits
over ten minutes, and raises the server's minimum password length to match
`MIN_LENGTH` in `src/lib/password.ts`. It prints `has code ✓` per template.

Generate the token at <https://supabase.com/dashboard/account/tokens> and revoke
it afterwards; it is read from the environment and never written to disk.

**4. Deploy the message fan-out**

```bash
npx supabase functions deploy send-message
npx supabase secrets set \
  ESKIZ_EMAIL=... ESKIZ_PASSWORD=... ESKIZ_SENDER=... \
  RESEND_API_KEY=re_... RESEND_FROM="ClassCare <no-reply@yourdomain>"
```

`RESEND_FROM` is required, not optional. Without it the function refuses to send
email rather than falling back to Resend's `onboarding@resend.dev` sender, which
only ever delivers to the Resend account owner — every student and parent is
rejected while the send still looks healthy from the app.

The function reads `SUPABASE_SERVICE_ROLE_KEY`, which Supabase injects into every
function at runtime — do not try to set it yourself, as the `SUPABASE_` prefix is
reserved and `secrets set` will reject it. That key bypasses row level security,
so it belongs in the function's environment and nowhere else: never in `.env`,
never under `src/`.

## Why bulk sending is server-side

Neither iOS nor Android lets an app dispatch an SMS without the user tapping
send in the native composer. "Message all 11 students, each with their own name
filled in" is therefore impossible on-device — it would open the composer eleven
times.

So the app posts the draft to `supabase/functions/send-message`, which renders
`{name}` / `{group}` / `{time}` per recipient and calls the gateways:

- **SMS** — [Eskiz.uz](https://eskiz.uz), a local Uzbek gateway. The roster is
  `+998`, and Uzbek traffic through Eskiz costs a fraction of Twilio's rate for
  the same route. Swap the two functions in `index.ts` for another market.
- **Email** — Resend.
- **Push** — Expo push. Currently a no-op: push needs a device token, and a
  student-facing app is explicitly out of scope.

Every recipient gets a `message_deliveries` row before anything is dispatched,
so a gateway outage leaves an accurate record instead of silence. One bad number
fails its own row and nothing else.

Tap-to-call and tap-to-message from a student's profile are a different thing —
those are `tel:` / `sms:` handoffs to the OS (`src/lib/contact.ts`) and stay
on-device.

## Layout

```
src/
  app/                    expo-router routes
    sign-in.tsx           1 · Sign in
    (tabs)/index.tsx      2 · Home
    group/[id].tsx        3 · Group detail
    attendance.tsx        4 · Attendance
    compose.tsx           5 · Bulk message
    student/[id].tsx      6 · Student profile
    student/new.tsx       7 · Add student
    (tabs)/calendar.tsx   8 · Calendar
    (tabs)/messages.tsx   9 · Messages
    (tabs)/students.tsx   address book
    group/new.tsx         create a group
  components/
    Icon.tsx              the icon set, path data lifted from the design
    ui.tsx                buttons, cards, chips, avatars, inputs
    layout.tsx            Screen / TopBar / StickyFooter / tab insets
    decor.tsx             gradients, glows, rings
  theme/
    tokens.ts             colours, radii, spacing, shadows, status palette
    type.ts               named text styles
  data/
    types.ts              domain model
    seed.ts               demo roster
    store.ts              zustand store — what the UI reads
    api.ts                Supabase repository
    sync.ts               write-through bridge between the two
  lib/
    date.ts schedule.ts contact.ts auth.ts supabase.ts
supabase/
  migrations/0001_init.sql
  functions/send-message/
```

### Design system

Every value in `src/theme/tokens.ts` is lifted verbatim from the Claude Design
source. Screens reference tokens, never raw hex.

Space Grotesk carries headings and numerals, Plus Jakarta Sans the body. React
Native cannot synthesise weights for custom fonts, so `src/theme/type.ts` maps a
weight to the right family name — use `body[700]`, not `fontWeight: '700'`.

### Sessions are derived, not stored

A group owns weekly `slots`; `src/lib/schedule.ts` turns those into concrete
sessions for any date. Only attendance the teacher actually marked is persisted.
Sessions from before install are filled by `historicMark()` in `store.ts`, a
deterministic hash of (student, session) — so attendance percentages and
recent-session lists come from real records and stay put across reloads instead
of reshuffling on every render.

### Writes are local-first

Screens never await the network. `store.ts` applies a change immediately and
hands it to an optional mirror; `sync.ts` registers that mirror and queues the
Supabase write in the background. Taking attendance works on classroom wifi that
drops.

## Known gaps

- **Import from contacts** fills the form from one contact via the native
  picker. The design's "add several at once" needs a custom multi-select list —
  not built, and the row copy says what it actually does.
- **Group schedule chips** show the group's real days (`Mon · Wed · Fri`), which
  is why they can differ from the static mockup.
- Edit buttons on the group and student headers are placed but inert.
- Delivery receipts need gateway webhooks pointed at a `message_deliveries`
  updater; the Edge Function only writes `sent` / `failed`.
- The remote write queue logs failures rather than retrying them; an offline
  banner and retry are the next step.

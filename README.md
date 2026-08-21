<img src="assets/images/icon.png" alt="ClassCare" width="96" align="left" hspace="16" vspace="4">

# ClassCare

Class management for independent tutors, built for phones on unreliable networks.

<br clear="left">

## What it is

ClassCare is an Android and iOS app for a private tutor who teaches their own
students. It is not a school system. There is no admin, no head teacher, no
student login. One teacher owns one account, and that account holds their
groups, their students, their registers and their message history.

The app was written for tutors in Turkmenistan, and most of its unusual
decisions come from that. The network there is filtered and slow, data bundles
are small, and the phone in the teacher's hand is often the only copy of a
term's work. So the app is built to be useful with no connection at all, and to
never lose anything when the connection comes back.

## Why it looks the way it does

Three constraints shaped almost everything.

**The backend is not directly reachable.** `*.supabase.co` is blocked on Turkmen
networks. Supabase sits behind Cloudflare and Cloudflare itself is reachable, so
the block is on the hostname rather than the address. The app talks to a small
PHP reverse proxy on ordinary shared hosting, which re-serves the same backend
under a hostname that resolves normally. See `docs/reverse-proxy.md`.

**Data has to survive without the server.** Every change is written to the
device first and queued for the server second. The queue is persisted, so a
change made on a train survives the app being killed and is sent on the next
launch. A teacher can use the whole app without ever creating an account, and
if they sign up later, everything they already have is adopted into the new
account rather than replaced.

**Reminders cannot depend on connectivity.** The weekly timetable already lives
on the device, so class reminders are scheduled locally by the phone. No server,
no push service, nothing to fail on the morning the wifi is down.

## What it does

**Groups.** Weekly slots (which days, what time), a start date and an end date,
a term such as Autumn 2026, a room, and a colour. The term and the dates are
what stop a course that finished in June from filling next January's calendar.

**Students.** Contact details, both parents with their own numbers and
workplaces, school, address, identity document number, gender, birthday and a
photo. Numbers can be pulled from the phone's contacts one field at a time.

**Attendance.** Open a class, mark present, late or absent, done. Rates are
calculated against the sessions the course actually contains rather than every
date on the calendar.

**Grades.** Assessment types, reusable templates, pass or fail marking, and
per-student scores that roll up into an average on the student's page.

**Messaging.** Write once and send to groups or individuals, addressed to
students, parents or both, with placeholders filled in per recipient. Texts go
out from the teacher's own SIM, which costs nothing extra and needs no gateway.
Email and push are also available. Parents can reply, and replies land in an
inbox in the app.

**Calendar.** A week view and a month view. Class sessions are derived from each
group's weekly slots rather than stored, so the schedule stays correct no matter
what date the app is opened on. One-off events such as exams and parent meetings
sit alongside them.

**Assignments.** Homework with file attachments, sent to a group.

**Import and export.** Students go in and out as a real Excel workbook. Import
also accepts CSV, since that is what school systems hand out, and it sniffs the
delimiter because an Excel installed in a Russian locale writes semicolons.
Column headings are matched by name in all three languages and in any order.
Re-importing a list you already have updates those students in place, so nobody
loses their photo.

**Backup.** The whole account writes to a single `.classcare` file that can be
sent over any channel and restored on another phone.

**Languages.** Turkmen, Russian and English, switchable in the app.

## How it is built

| Layer | What is used |
| --- | --- |
| App | Expo SDK 57, React Native 0.86, React 19.2, expo-router |
| State | Zustand, with a write-through mirror to the sync layer |
| On device | expo-sqlite, whole collections written on a short debounce |
| Sync | A serial write queue persisted to an outbox table and replayed on launch |
| Server | Supabase with row level security keyed on `teacher_id` |
| Server logic | Deno edge functions for sending messages, sending grades, receiving replies |
| Reaching it | A PHP reverse proxy on shared hosting |

A write that the server refuses permanently, such as one that violates a
constraint, is dropped from the queue so it cannot block the writes behind it. A
flag records that it happened, and while that flag is set the app adds to local
data on sync instead of replacing it, so nothing on the device is deleted by a
row the server has never heard of.

## Running it

```bash
npm install
npm start        # then press a for Android, i for iOS
npm run web      # browser
```

Copy `.env.example` to `.env` and fill in three values:

```
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
```

`.env` is gitignored and is the only place secrets belong. The Supabase
publishable key is safe to ship in the app. Service role keys and access tokens
are not, and nothing in the app needs them.

## Layout

```
src/
  app/          Screens and routes (expo-router)
  components/   Shared UI, forms, pickers
  data/         Store, local database, sync queue, Supabase client, backup
  i18n/         Three dictionaries with identical keys
  lib/          Dates, scheduling, spreadsheets, photos, notifications
  theme/        Colours, typography, the brand palette
supabase/
  migrations/   Numbered and additive, safe to re-run
  functions/    Edge functions
deploy/
  php-proxy/    The reverse proxy
docs/           Proxy, SMS, push and reply setup
scripts/
  make-icons.py Generates every app icon from one recipe
```

## Database

Migrations are numbered and additive. Each one is safe to run against a database
that already has the earlier ones applied, and none of them drop or rewrite
existing data. Apply a new migration before shipping a build that depends on it,
because a write naming a column that does not exist yet is refused permanently
rather than retried.

## Builds

EAS handles the builds. The production profile produces an APK.

```bash
eas build --platform android --profile production
```

## The mark

The icon is the letters Cc set in Archivo Black, a blue capital with a green
lowercase over it, on black. The same letters, colours and overlap appear in the
opening title card. Every icon file is generated by `scripts/make-icons.py`
rather than drawn by hand, so they cannot drift apart from each other.

## Licence

MIT. See `LICENSE`.

# Notifications

Two needs, two mechanisms. Splitting them is deliberate, not incidental.

| | Class reminders | Replies from parents |
|---|---|---|
| Raised by | the phone itself | the server |
| Needs network | no | yes |
| Needs FCM | no | yes |
| Status | **working** | needs setup below |

## Class reminders — local, done

The weekly schedule already lives on the device, so the phone can raise
"IELTS Advanced starts in 15 minutes" without asking anyone. No server, no FCM,
no network — which matters on a filtered network reached through a reverse
proxy. A reminder that depends on connectivity fails on exactly the morning the
wifi is down.

Implemented in `src/lib/notifications.ts`:

- Permission is requested when the teacher enables reminders, never at launch.
  A cold prompt earns a "Don't allow" that iOS never offers to revisit.
- The schedule is rebuilt (cancel + recreate) whenever groups change or the app
  foregrounds. Diffing would be cheaper and occasionally wrong — a teacher being
  reminded about a class they moved last week is worse than a few syscalls.
- Horizon is 14 days, capped at 60 pending notifications (iOS allows 64).
- Only notifications tagged `class-reminder` are cancelled, so nothing else the
  app might schedule is disturbed.

Settings live in Profile → Reminders: on/off and a lead time of 5/15/30/60 min.

## Replies — remote push, not yet wired

Only the server knows a parent replied, so this half needs FCM. The app side is
ready: `getDevicePushToken()` returns the raw FCM token and `updateTeacher({
pushToken })` stores it on the `teachers` row.

Note it uses `getDevicePushTokenAsync`, **not** `getExpoPushTokenAsync`. The
latter registers with `exp.host`, which is as likely to be filtered as
`supabase.co` turned out to be — a sign-in that hangs on push registration
would be a self-inflicted outage. The raw token comes from Play Services, which
is reachable, and the server can call FCM directly.

### What is still required

1. **A Firebase project** with an Android app for `com.smiletechweb.classcare`.
   Firebase is used only as the delivery pipe; auth stays on Supabase.
2. **`google-services.json`** from that project, committed and referenced:
   ```json
   "android": { "googleServicesFile": "./google-services.json" }
   ```
   This is the one place the file is genuinely needed — Google *sign-in* does
   not need it (see `docs/reverse-proxy.md`).
3. **An FCM V1 service-account key** uploaded to EAS so builds can receive push.
4. **`FCM_SERVICE_ACCOUNT`** as a Supabase secret, and the `sendPush` stub in
   `supabase/functions/send-message/index.ts` pointed at
   `https://fcm.googleapis.com/v1/projects/<id>/messages:send` instead of
   `exp.host`.
5. **A trigger** so an inbound reply actually sends something — the webhook that
   writes to `replies` should call the function, or a database trigger should.

### Cost of not doing it

Replies still arrive; the inbox polls every 30s while the app is foregrounded
(see `subscribeToInbox`). What is missing is a notification when the app is
closed.

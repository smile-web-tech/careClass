# Notifications

Two needs, two mechanisms. Splitting them is deliberate, not incidental.

| | Class reminders | Replies from parents |
|---|---|---|
| Raised by | the phone itself | the server |
| Needs network | no | yes |
| Needs FCM | no | yes |
| Status | **working** | **code complete, needs credentials** |

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
  foregrounds.
- Horizon is 14 days, capped at 60 pending notifications (iOS allows 64).
- Only notifications tagged `class-reminder` are cancelled.

Settings live in Profile → Reminders: on/off and a lead time of 5/15/30/60 min.

## Replies — remote push

Only the server knows a parent replied, so this half needs FCM. **All the code
exists now.** What is missing is credentials, and nothing else.

### How it works

1. `registerForPush()` runs after every sign-in and again the moment
   notification permission is granted. It asks Play Services for the device
   token and stores it on the teacher's row via `updateTeacher({ pushToken })`.
   Everything in it fails soft: no credentials, no Play Services or a declined
   prompt all mean "no push", never an error in the teacher's face.
2. A parent replies. `inbound-email` records it, forwards a copy to the
   teacher's mailbox, then sends a notification to `teachers.push_token`.
3. `supabase/functions/_shared/fcm.ts` signs a JWT with the service account key,
   trades it for an OAuth token (cached for the hour Google grants), and posts
   to FCM HTTP v1.

Note it uses `getDevicePushTokenAsync`, **not** `getExpoPushTokenAsync`, and
talks to `fcm.googleapis.com` rather than `exp.host`. Expo's push service is one
more host that has to be reachable from a Turkmen network, and `*.supabase.co`
already turned out not to be. The raw token comes from Play Services, which is
reachable.

**Stale tokens are cleared.** FCM answers `UNREGISTERED` once an app is
uninstalled or a token rotates; the function nulls `push_token` when it sees
that. Without it a row would retry a dead token forever and could never receive
anything again.

**Two Android channels**, `classes` and `replies`. A teacher who mutes class
reminders over a holiday still wants to know a parent wrote back, and Android
only offers that choice if the app made the distinction first. The `channel_id`
in `fcm.ts` must match the channel created in `notifications.ts` — Android 8+
silently drops a notification naming a channel that does not exist, which looks
identical to push being broken.

### The Firebase project

Firebase project `classcare-504301`, project number `228965535461`. That number
is not incidental: it is the *same* Google Cloud project that already held the
OAuth clients for Google sign-in. Firebase was added on top of it rather than
created fresh.

The reason is a rule that is easy to trip over. Google requires the pair
(package name, SHA-1) to be unique across all Android OAuth clients, globally.
A separate Firebase project cannot mint an Android OAuth client for a package
whose fingerprint another project has already claimed — it refuses with
"Another project contains an OAuth 2.0 client that uses this same SHA-1
fingerprint and package name combination". Push would still work, but the
resulting `google-services.json` carries an empty `oauth_client` array, and
anything that later reads the web client id out of that file gets nothing.

Sanity check on `google-services.json` after any regeneration: `project_number`
must read `228965535461`, and `oauth_client` must contain both a type 1
(Android) and a type 3 (web) entry, the latter matching
`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`.

### What is still required

1. **The service account JSON** as a Supabase secret:
   ```bash
   supabase secrets set FCM_SERVICE_ACCOUNT="$(cat service-account.json)"
   supabase functions deploy inbound-email --no-verify-jwt
   ```
2. **A new build.** Push cannot work in Expo Go or in any build made before
   `google-services.json` existed — the credentials are compiled in.

**No EAS credential is needed.** `eas credentials` → Android → FCM V1 exists so
that *Expo's* push service can send on your behalf. This app never uses it:
sends go straight to `fcm.googleapis.com` from the Edge Function, and the app
receives entirely off the `google-services.json` compiled into the binary.
Uploading a key there would change nothing.

`google-services.json` is committed, deliberately. It is client config rather
than a credential — every value in it ships inside the APK anyway, and its API
key is restricted to this package plus SHA-1. The practical reason is that EAS
uploads the build from git: ignoring the file means the builder never receives
it while `app.json` still names it, and the build fails. The service account
key is the opposite and is gitignored: it holds a real private key.

### Cost of not doing it

Replies still arrive: they are recorded in the app and forwarded to the
teacher's email either way, and the inbox polls every 30s while the app is
foregrounded. What is missing is the notification when the app is closed.

## No push to students

There is none, by design. ClassCare is the teacher's app — students and parents
never install it, so there is no device to push to. The composer used to offer a
"Push" channel that called a stub with an empty token list and then marked the
deliveries `sent`, reporting delivery to nobody. Both the channel and the stub
are gone.

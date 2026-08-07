# SMS from the teacher's own phone

ClassCare can send a class list's worth of texts from the teacher's own SIM,
without a gateway account. This is what most Turkmen tutors will actually use:
a commercial SMS gateway either does not reach +993 at a sane price or requires
a business relationship they do not have, while the SIM in their pocket already
has a bundle on it.

## What it is

`modules/device-sms` — a local Expo native module wrapping Android's
`SmsManager`. `src/lib/deviceSms.ts` is everything around it: building the
recipient list, rendering per-student placeholders, pacing the queue, and
reporting the outcome. The composer picks between this and the server gateway
with the **Send SMS from** control, which only appears when the phone can
actually do it.

## The three constraints that shaped it

**iOS cannot do this at all.** There is no API. `MFMessageComposeViewController`
opens the system composer with fields pre-filled and the user taps send — one
message at a time, with no way to know whether they sent it. Nothing about a
class list survives that. The module is Android-only and `deviceSmsSupported()`
returns false on iOS, so the control is not shown rather than shown broken.

**`SEND_SMS` is a Play-restricted permission.** Google grants it to apps whose
core function is handling SMS — a default messaging app — and a class-management
app is not one. This is fine for the APK teachers install directly, which is how
ClassCare is distributed. It would not survive Play review. If a Play listing is
ever wanted, this feature has to come out of that build, and the gateway path in
`send-message` is the fallback that stays.

**Android throttles outgoing SMS.** Past roughly 30 messages an hour the
framework puts up a confirmation dialog per message. Nothing in an app can
suppress it — it is the platform protecting the user from exactly this API. The
composer warns before a batch that will cross the line, the queue paces itself
at ~900 ms between messages, and the native timeout is 120 s so a teacher
tapping through dialogs does not fail the send.

## Cost, and why the segment counter matters

Turkmen uses `ä ň ö ü ý ž`. None are in the GSM 7-bit alphabet, so a single one
of them drops the whole message to UCS-2 — **70 characters per segment instead
of 160**. A 150-character reminder is one segment in English and three in
Turkmen, and the teacher pays for three.

The counter under the editor comes from the platform
(`SmsMessage.calculateLength`), not from `length / 160`, and a warning appears
once a Turkmen message crosses into multiple segments.

## What gets written down

The Edge Function normally creates the `messages` and `message_deliveries` rows
as a side effect of sending. Nothing server-side is involved here, so
`recordDeviceSms` in `src/data/api.ts` writes them afterwards, with each
delivery carrying its real outcome rather than `queued`. A run where every
message failed is still logged — "we tried and nobody got it" is precisely what
a teacher needs to be able to look up later.

## Failure reasons

The native side rejects with a bare code, translated in `sms.reason.*`:

| Code | Means |
| --- | --- |
| `no_service` | No network registration |
| `radio_off` | Aeroplane mode |
| `limit_exceeded` | Android's outgoing-SMS throttle |
| `generic_failure` | The operator rejected it |
| `timeout` | No delivery broadcast within 120 s |
| `no_number` | No phone number on the student |
| `receiver_unavailable` | Module failed to register its receiver |

## Testing it

Needs a real device with a SIM — an emulator has no radio and
`isAvailable()` returns false.

1. Sign in against the real project. The control is hidden without one, because
   seed students have invented phone numbers and texting them would cost money
   and reach strangers.
2. Compose → tick SMS → **This phone**.
3. First send asks for permission. Deny it once to check the Settings hint
   appears; Android stops showing the dialog after two refusals.
4. Send to a group containing your own second number and watch the sheet.
5. Turn on aeroplane mode and send — every row should read "Aeroplane mode is
   on" rather than hanging.

## Not done

- **Delivery receipts.** `sendMultipartTextMessage` takes a second set of
  `PendingIntent`s for delivery confirmation, which the module passes as `null`.
  Sent means the network accepted it, not that a handset received it.
- **Dual SIM.** Always the default SIM. `SmsManager.createForSubscriptionId`
  would let the teacher pick, and needs `READ_PHONE_STATE` to enumerate them.
- **Sending in the background.** The queue stops when the app is backgrounded
  long enough for the OS to suspend it. A foreground service would fix it and is
  another Play-policy conversation.

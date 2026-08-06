# Replies

A parent writes back. The teacher should see it in the app's inbox *and* in the
mailbox they actually watch. Both, not one.

## How it routes

Every outgoing email carries its own Reply-To:

```
reply-<deliveryId>@reply.yourdomain
```

`deliveryId` is the `message_deliveries` row, so the token identifies the
teacher, the student, and whether the message went to the student or the
guardian. Resend receives the reply, calls `supabase/functions/inbound-email`,
and that writes a `replies` row.

Matching on the sender's address instead was the obvious alternative and is
wrong twice over: a parent who replies from a different account than the one on
file is unattributable, and a parent whose child is on two teachers' rosters is
ambiguous. The token has neither problem. The address lookup survives only as a
fallback for mail that arrives without one.

The function still forwards a copy to the teacher's own mailbox, with `Reply-To`
set to the parent — so the teacher's answer goes straight to them and cannot
loop back through the webhook. Losing that forward was the one real cost of
moving Reply-To off the teacher's address, so it is paid back explicitly.

## Setup

1. **Pick the inbound domain.** Resend's free plan allows one domain, so do not
   add a second — receiving is a property of a domain Resend already knows.
   - *Your sending domain.* Enable receiving on it and add the MX record it
     shows. Only do this if the domain has no MX today, or you will displace an
     existing mail service; a subdomain avoids that.
   - *Resend's managed address.* Emails → Receiving → "Receiving address" gives
     `<id>.resend.app` with no DNS at all. Works immediately; parents see a
     machine-looking address.
2. **Add the MX record** if you chose your own domain. It must have the *lowest*
   priority value of any MX on that name, or mail routes elsewhere.
3. **Deploy**, without JWT verification. A webhook carries no Supabase JWT, so
   the default gateway check would reject every call before the code runs:
   ```bash
   supabase functions deploy inbound-email --no-verify-jwt
   ```
4. **Point a Resend webhook** at
   `https://<project-ref>.supabase.co/functions/v1/inbound-email` subscribed to
   `email.received`. Copy the signing secret.
5. **Set the secrets:**
   ```bash
   supabase secrets set RESEND_WEBHOOK_SECRET=whsec_... \
     RESEND_INBOUND_DOMAIN=reply.yourdomain
   ```
6. **Apply `0006_inbound_replies.sql`**, which adds the dedupe key.

Until `RESEND_INBOUND_DOMAIN` is set, `send-message` keeps using the teacher's
own address as Reply-To and nothing changes. The rollout is one secret.

## Things worth knowing

- **The webhook has no body.** Resend sends metadata only; the function fetches
  the content from `GET /emails/receiving/{id}`. A failure there returns 500 on
  purpose, because Resend then redelivers.
- **Retries are expected.** `replies.inbound_message_id` is uniquely indexed on
  the RFC 5322 Message-ID, so a redelivery collides and is treated as success
  rather than adding a second copy to the inbox.
- **Signature verification is the only door.** Deployed with `--no-verify-jwt`,
  the Svix HMAC is all that separates the open internet from a function that
  writes into a teacher's inbox. It fails closed, and rejects anything older
  than five minutes so a captured request cannot be replayed.
- **Quoted text is stripped** before storage — otherwise every card shows the
  teacher their own announcement with two words of reply on top.
- **SMS replies are not covered.** They need an inbound-capable number, which
  waits on the SMS gateway decision.

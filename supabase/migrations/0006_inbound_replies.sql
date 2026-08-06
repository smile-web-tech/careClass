-- ClassCare 0006 — record which inbound email produced a reply.
--
-- Webhooks retry. Resend redelivers `email.received` if the endpoint times out
-- or answers non-2xx, and it will happily redeliver one it already sent when a
-- deploy restarts the function mid-request. Without a natural key, each retry
-- would add another copy of the same parent's message to the teacher's inbox.
--
-- `message_id` is the RFC 5322 Message-ID of the inbound mail, which is unique
-- per message and stable across retries.
--
-- Safe to run on a database that already has 0001–0005 applied.

alter table replies add column if not exists inbound_message_id text;

-- Partial, so the pre-existing rows (and any reply that arrives by another
-- route later) can keep a null here without colliding with each other.
create unique index if not exists replies_inbound_message_idx
  on replies (inbound_message_id)
  where inbound_message_id is not null;

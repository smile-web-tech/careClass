-- ClassCare 0010 — files on messages, in both directions.
--
-- Teachers send homework as a PDF or a photo of the board; students reply with
-- a photo of the finished work. Both ends need somewhere for the bytes to live
-- and a row saying what they were.
--
-- Storage rather than a bytea column, for the reason that decides it: the file
-- must never travel through the Edge Function. A teacher on a Turkmen mobile
-- connection uploads once, and Resend fetches the file itself from a signed
-- URL — base64 through the function would mean carrying the payload twice and
-- would hit the request body limit on anything larger than a few megabytes.
--
-- Safe to re-run.

/* ------------------------------------------------------------------ *
 * 1. The bucket.
 *
 * Private. Everything reaches it through a short-lived signed URL, which
 * is also what stops a leaked link from being a permanent one.
 * ------------------------------------------------------------------ */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  10485760, -- 10 MB. Resend caps a whole email at 40 MB and base64 inflates by
            -- a third, so this leaves room for several files plus the body.
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif',
    'text/plain', 'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/* ------------------------------------------------------------------ *
 * 2. Who may touch what.
 *
 * Every object lives under a folder named for the teacher who owns it,
 * so the first path segment is the whole access rule. Executables are
 * excluded by the MIME allowlist above rather than here — a policy
 * cannot see the content type.
 * ------------------------------------------------------------------ */

drop policy if exists "own attachments" on storage.objects;

create policy "own attachments" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

/* ------------------------------------------------------------------ *
 * 3. What was attached to what.
 *
 * The storage object alone cannot say which message it belonged to, and
 * listing a folder to find out would be both slow and a lie the moment a
 * file is deleted. These rows are the record.
 * ------------------------------------------------------------------ */

create table if not exists message_attachments (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references messages on delete cascade,
  teacher_id    uuid not null references teachers on delete cascade,
  -- Path within the `attachments` bucket, always `<teacher_id>/...`.
  storage_path  text not null,
  filename      text not null,
  mime_type     text not null,
  size_bytes    bigint not null check (size_bytes >= 0),
  created_at    timestamptz not null default now()
);

create index if not exists message_attachments_message_idx
  on message_attachments (message_id);

create table if not exists reply_attachments (
  id            uuid primary key default gen_random_uuid(),
  reply_id      uuid not null references replies on delete cascade,
  teacher_id    uuid not null references teachers on delete cascade,
  storage_path  text not null,
  filename      text not null,
  mime_type     text not null,
  size_bytes    bigint not null check (size_bytes >= 0),
  created_at    timestamptz not null default now()
);

create index if not exists reply_attachments_reply_idx
  on reply_attachments (reply_id);

alter table message_attachments enable row level security;
alter table reply_attachments   enable row level security;

drop policy if exists "own rows" on message_attachments;
drop policy if exists "own rows" on reply_attachments;

create policy "own rows" on message_attachments
  for all using (teacher_id = (select auth.uid()))
  with check (teacher_id = (select auth.uid()));
create policy "own rows" on reply_attachments
  for all using (teacher_id = (select auth.uid()))
  with check (teacher_id = (select auth.uid()));

/* ------------------------------------------------------------------ *
 * 4. Assignments.
 *
 * An assignment is a message with a file on it, sent to students only.
 * A flag on `messages` rather than a table of its own: it has the same
 * body, the same groups, the same deliveries and the same replies, and
 * duplicating all of that to record one boolean would mean every screen
 * reading the log had to union two tables.
 * ------------------------------------------------------------------ */

alter table messages add column if not exists is_assignment boolean not null default false;

create index if not exists messages_assignment_idx
  on messages (teacher_id, sent_at desc)
  where is_assignment;

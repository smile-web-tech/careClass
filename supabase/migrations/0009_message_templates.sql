-- ClassCare 0009 — the teacher's own message templates.
--
-- A table rather than the JSONB column added in 0008, because these are a list
-- the teacher adds to, edits and deletes one at a time. That column was shaped
-- for a single set of fixed wording, which is a different feature; nothing ever
-- read it, so it goes.
--
-- The built-in starters (class reminder, cancellation, absence follow-up) are
-- NOT rows here. They live in the translation catalogue, so they arrive in the
-- teacher's own language and improve when the catalogue does. This table holds
-- only what the teacher wrote themselves.
--
-- Safe to run on a database that already has 0001–0008 applied.

alter table teachers drop column if exists email_templates;

create table if not exists message_templates (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references teachers on delete cascade,
  title       text not null,
  body        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists message_templates_teacher_idx
  on message_templates (teacher_id, created_at desc);

drop trigger if exists message_templates_touch on message_templates;
create trigger message_templates_touch
  before update on message_templates
  for each row execute function touch_updated_at();

alter table message_templates enable row level security;

drop policy if exists "own rows" on message_templates;
create policy "own rows" on message_templates
  for all using (teacher_id = (select auth.uid())) with check (teacher_id = (select auth.uid()));

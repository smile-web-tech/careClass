-- ClassCare 0002 — personal calendar events, eight more group accents.
--
-- Safe to run on a database that already has 0001 applied. Every statement is
-- guarded so a partial re-run is a no-op rather than an error.

/* ------------------------------------------------------------------ *
 * 1. More group colours.
 *
 * `alter type ... add value` cannot run inside a transaction block on
 * PostgreSQL < 12, and cannot be rolled back. `if not exists` makes each
 * one idempotent so re-running the file is harmless.
 * ------------------------------------------------------------------ */

alter type group_accent add value if not exists 'rose';
alter type group_accent add value if not exists 'emerald';
alter type group_accent add value if not exists 'indigo';
alter type group_accent add value if not exists 'orange';
alter type group_accent add value if not exists 'cyan';
alter type group_accent add value if not exists 'pink';
alter type group_accent add value if not exists 'lime';
alter type group_accent add value if not exists 'slate';

/* ------------------------------------------------------------------ *
 * 2. Personal calendar events.
 *
 * Anything on the teacher's calendar that is not a class: a parent
 * meeting, an exam, a day off. Group sessions stay derived from
 * `group_slots` and are never stored here.
 *
 * A single-day event has `starts_at`/`ends_at` as local `HH:MM` strings
 * on `event_date`, matching how `group_slots` stores its times, so the
 * calendar can merge both without timezone reconciliation. `all_day`
 * ignores the times entirely.
 * ------------------------------------------------------------------ */

create table if not exists calendar_events (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references teachers (id) on delete cascade,
  title       text not null check (length(btrim(title)) between 1 and 120),
  note        text check (note is null or length(note) <= 500),
  event_date  date not null,
  all_day     boolean not null default false,
  -- Local wall-clock, `HH:MM`. Null only when all_day.
  starts_at   text check (starts_at is null or starts_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ends_at     text check (ends_at   is null or ends_at   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  accent      group_accent not null default 'slate',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- A timed event needs both ends, and must not finish before it starts.
  constraint times_present check (all_day or (starts_at is not null and ends_at is not null)),
  constraint times_ordered check (all_day or ends_at > starts_at)
);

create index if not exists calendar_events_teacher_date_idx
  on calendar_events (teacher_id, event_date);

/* ------------------------------------------------------------------ *
 * 3. Row level security.
 *
 * Same shape as every other table in 0001: a teacher reaches only rows
 * whose teacher_id is their own auth uid. `with check` on insert and
 * update stops a client from writing a row onto someone else's calendar
 * by supplying a different teacher_id.
 * ------------------------------------------------------------------ */

alter table calendar_events enable row level security;

drop policy if exists "own events readable"   on calendar_events;
drop policy if exists "own events insertable" on calendar_events;
drop policy if exists "own events updatable"  on calendar_events;
drop policy if exists "own events deletable"  on calendar_events;

create policy "own events readable" on calendar_events
  for select using (teacher_id = auth.uid());

create policy "own events insertable" on calendar_events
  for insert with check (teacher_id = auth.uid());

create policy "own events updatable" on calendar_events
  for update using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

create policy "own events deletable" on calendar_events
  for delete using (teacher_id = auth.uid());

/* ------------------------------------------------------------------ *
 * 4. Keep updated_at honest.
 *
 * 0001 set `updated_at` with a column default only, which never fires on
 * UPDATE. Defining the trigger function here so edits actually stamp.
 * ------------------------------------------------------------------ */

create or replace function touch_updated_at() returns trigger
  language plpgsql
  as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists calendar_events_touch on calendar_events;
create trigger calendar_events_touch
  before update on calendar_events
  for each row execute function touch_updated_at();

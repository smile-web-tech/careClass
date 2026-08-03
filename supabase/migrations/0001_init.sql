-- ClassCare — initial schema.
--
-- One teacher owns everything they can see. There is no school, no admin role
-- and no student-facing account, so every table carries `teacher_id` and every
-- policy is the same shape: `teacher_id = auth.uid()`. That keeps the security
-- model auditable at a glance.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type attendance_status as enum ('present', 'late', 'absent');
create type message_audience  as enum ('students', 'parents', 'both');
create type message_channel   as enum ('sms', 'email', 'push');
create type delivery_state    as enum ('queued', 'sent', 'delivered', 'failed');
create type group_accent      as enum ('blue', 'teal', 'violet', 'amber');

-- ---------------------------------------------------------------------------
-- Teacher profile (1:1 with auth.users)
-- ---------------------------------------------------------------------------

create table teachers (
  id          uuid primary key references auth.users on delete cascade,
  name        text not null default '',
  email       text,
  avatar_url  text,
  -- IANA name, e.g. 'Asia/Tashkent'. Schedules are stored as wall-clock time,
  -- so the zone is what turns a slot into a real instant.
  timezone    text not null default 'UTC',
  -- Expo push token for this teacher's own device (reply notifications).
  push_token  text,
  created_at  timestamptz not null default now()
);

-- Create the profile row automatically on signup.
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.teachers (id, name, email, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    new.email,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- Groups and their weekly schedule
-- ---------------------------------------------------------------------------

create table groups (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references teachers on delete cascade,
  name        text not null,
  subject     text not null default '',
  room        text not null default '',
  accent      group_accent not null default 'blue',
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);

create index groups_teacher_idx on groups (teacher_id) where archived_at is null;

-- A recurring weekly slot. A group meeting Mon/Wed/Fri has three rows.
create table group_slots (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references groups on delete cascade,
  teacher_id  uuid not null references teachers on delete cascade,
  -- 0 = Sunday … 6 = Saturday, matching JavaScript's Date#getDay.
  weekday     smallint not null check (weekday between 0 and 6),
  starts_at   time not null,
  ends_at     time not null,
  constraint group_slots_ordered check (ends_at > starts_at),
  unique (group_id, weekday, starts_at)
);

create index group_slots_group_idx on group_slots (group_id);

-- ---------------------------------------------------------------------------
-- Students
-- ---------------------------------------------------------------------------

create table students (
  id            uuid primary key default gen_random_uuid(),
  teacher_id    uuid not null references teachers on delete cascade,
  name          text not null,
  phone         text not null,
  email         text,
  parent_name   text,
  parent_phone  text,
  accent        group_accent not null default 'blue',
  note          text,
  avg_score     numeric(3, 1),
  photo_url     text,
  archived_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index students_teacher_idx on students (teacher_id) where archived_at is null;
-- Powers the single search field across names and numbers.
create index students_search_idx on students using gin (
  to_tsvector('simple', name || ' ' || phone)
);

create table student_groups (
  student_id  uuid not null references students on delete cascade,
  group_id    uuid not null references groups on delete cascade,
  teacher_id  uuid not null references teachers on delete cascade,
  joined_at   timestamptz not null default now(),
  primary key (student_id, group_id)
);

create index student_groups_group_idx on student_groups (group_id);

-- ---------------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------------

-- Sessions are derived from `group_slots` on the client, so only sessions the
-- teacher has actually marked produce rows here. A session is identified by
-- (group, date, start time) — the same key the app builds locally.
create table attendance (
  id           uuid primary key default gen_random_uuid(),
  teacher_id   uuid not null references teachers on delete cascade,
  group_id     uuid not null references groups on delete cascade,
  student_id   uuid not null references students on delete cascade,
  session_date date not null,
  starts_at    time not null,
  status       attendance_status not null,
  marked_at    timestamptz not null default now(),
  unique (group_id, session_date, starts_at, student_id)
);

create index attendance_student_idx on attendance (student_id, session_date desc);
create index attendance_session_idx on attendance (group_id, session_date desc);

-- ---------------------------------------------------------------------------
-- Messaging
-- ---------------------------------------------------------------------------

create table messages (
  id            uuid primary key default gen_random_uuid(),
  teacher_id    uuid not null references teachers on delete cascade,
  body          text not null,
  audience      message_audience not null,
  channels      message_channel[] not null,
  -- True when the message went to every group rather than a selection.
  announcement  boolean not null default false,
  sent_at       timestamptz not null default now()
);

create index messages_teacher_idx on messages (teacher_id, sent_at desc);

create table message_groups (
  message_id  uuid not null references messages on delete cascade,
  group_id    uuid not null references groups on delete cascade,
  primary key (message_id, group_id)
);

-- One row per person per channel. The Edge Function writes these, then the
-- gateway webhooks update `state` — that is what "Delivered 8/8" reads from.
create table message_deliveries (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references messages on delete cascade,
  teacher_id   uuid not null references teachers on delete cascade,
  student_id   uuid references students on delete set null,
  -- 'student' or 'parent' — the same person can receive both.
  recipient    text not null check (recipient in ('student', 'parent')),
  channel      message_channel not null,
  destination  text not null,
  -- Placeholders already substituted for this recipient.
  rendered     text not null,
  state        delivery_state not null default 'queued',
  provider_id  text,
  error        text,
  updated_at   timestamptz not null default now()
);

create index message_deliveries_message_idx on message_deliveries (message_id);

create table replies (
  id           uuid primary key default gen_random_uuid(),
  teacher_id   uuid not null references teachers on delete cascade,
  student_id   uuid references students on delete set null,
  author_name  text not null,
  -- "parent of Amir" / the group name — whatever context the reply arrived with.
  context      text not null default '',
  body         text not null,
  received_at  timestamptz not null default now(),
  read_at      timestamptz
);

create index replies_unread_idx on replies (teacher_id, received_at desc)
  where read_at is null;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table teachers            enable row level security;
alter table groups              enable row level security;
alter table group_slots         enable row level security;
alter table students            enable row level security;
alter table student_groups      enable row level security;
alter table attendance          enable row level security;
alter table messages            enable row level security;
alter table message_groups      enable row level security;
alter table message_deliveries  enable row level security;
alter table replies             enable row level security;

create policy "own profile" on teachers
  for all using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Every owned table shares one policy shape. Kept explicit rather than
-- generated so `\d+` on any table tells the whole story.
create policy "own rows" on groups
  for all using (teacher_id = (select auth.uid())) with check (teacher_id = (select auth.uid()));
create policy "own rows" on group_slots
  for all using (teacher_id = (select auth.uid())) with check (teacher_id = (select auth.uid()));
create policy "own rows" on students
  for all using (teacher_id = (select auth.uid())) with check (teacher_id = (select auth.uid()));
create policy "own rows" on student_groups
  for all using (teacher_id = (select auth.uid())) with check (teacher_id = (select auth.uid()));
create policy "own rows" on attendance
  for all using (teacher_id = (select auth.uid())) with check (teacher_id = (select auth.uid()));
create policy "own rows" on messages
  for all using (teacher_id = (select auth.uid())) with check (teacher_id = (select auth.uid()));
create policy "own rows" on message_deliveries
  for all using (teacher_id = (select auth.uid())) with check (teacher_id = (select auth.uid()));
create policy "own rows" on replies
  for all using (teacher_id = (select auth.uid())) with check (teacher_id = (select auth.uid()));

-- message_groups has no teacher_id of its own; it inherits through the message.
create policy "own rows" on message_groups
  for all using (
    exists (
      select 1 from messages m
      where m.id = message_id and m.teacher_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from messages m
      where m.id = message_id and m.teacher_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Student photos
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('student-photos', 'student-photos', false)
on conflict (id) do nothing;

-- Objects live under `<teacher_id>/<student_id>.jpg`, so ownership is the
-- first path segment.
create policy "own photos" on storage.objects
  for all
  using (
    bucket_id = 'student-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'student-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

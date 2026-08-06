-- ClassCare 0007 — grading.
--
-- Two tables rather than one, because a mark means nothing without the thing it
-- was scored against. "17" is not a grade; "17 out of 20 on the Unit 3 quiz" is.
-- Splitting them also makes the questions teachers actually ask cheap: how did
-- this group do on that exam, and how is this student trending across all of
-- them.
--
-- `max_score` lives on the assessment, so a quiz out of 20 and a final out of
-- 100 can sit in the same average without the app guessing a scale.
--
-- Safe to run on a database that already has 0001–0006 applied.

/* ------------------------------------------------------------------ *
 * 1. What was sat.
 * ------------------------------------------------------------------ */

do $$
begin
  if not exists (select 1 from pg_type where typname = 'assessment_kind') then
    create type assessment_kind as enum ('quiz', 'exam', 'final');
  end if;
end
$$;

create table if not exists assessments (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references teachers on delete cascade,
  group_id    uuid not null references groups on delete cascade,
  kind        assessment_kind not null,
  -- "Unit 3 quiz", "Midterm". Shown to the student in the notification.
  title       text not null,
  max_score   numeric(6, 2) not null default 100 check (max_score > 0),
  taken_on    date not null default current_date,
  created_at  timestamptz not null default now()
);

create index if not exists assessments_group_idx
  on assessments (group_id, taken_on desc);

/* ------------------------------------------------------------------ *
 * 2. What each student got.
 *
 * One row per student per assessment — the unique constraint is what
 * makes re-entering a mark an update rather than a duplicate, which is
 * exactly what happens when a teacher corrects a typo.
 * ------------------------------------------------------------------ */

create table if not exists grades (
  id             uuid primary key default gen_random_uuid(),
  teacher_id     uuid not null references teachers on delete cascade,
  assessment_id  uuid not null references assessments on delete cascade,
  student_id     uuid not null references students on delete cascade,
  score          numeric(6, 2) not null check (score >= 0),
  -- When the student was told. Null means graded but not yet sent, which the
  -- grading screen surfaces so a mark cannot quietly go unreported.
  notified_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (assessment_id, student_id)
);

create index if not exists grades_student_idx on grades (student_id, created_at desc);

drop trigger if exists grades_touch on grades;
create trigger grades_touch
  before update on grades
  for each row execute function touch_updated_at();

/* ------------------------------------------------------------------ *
 * 3. Row level security — the same shape as every other owned table.
 * ------------------------------------------------------------------ */

alter table assessments enable row level security;
alter table grades      enable row level security;

drop policy if exists "own rows" on assessments;
create policy "own rows" on assessments
  for all using (teacher_id = (select auth.uid())) with check (teacher_id = (select auth.uid()));

drop policy if exists "own rows" on grades;
create policy "own rows" on grades
  for all using (teacher_id = (select auth.uid())) with check (teacher_id = (select auth.uid()));

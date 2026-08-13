-- Exam types the teacher writes, per group.
--
-- `assessments.kind` was an enum of three: quiz, exam, final. That is one
-- school's vocabulary imposed on everyone. A tutor running "Test 1" through
-- "Test 4" and then a "Final test" had to file all five as `quiz` or `exam`
-- and tell them apart by the title, which is the column that is supposed to
-- say what the paper was about.
--
-- Types belong to a group rather than to the account: a beginners' class and
-- an exam-prep class are assessed differently, and a list long enough to cover
-- both is a list nobody wants to scroll while entering marks.

create table if not exists assessment_types (
  id         uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teachers on delete cascade,
  group_id   uuid not null references groups   on delete cascade,
  name       text not null,
  -- The teacher's own order. "Test 1, Test 2, Final" is meaningful; alphabetic
  -- would put Final in the middle of it.
  position   int  not null default 0,
  created_at timestamptz not null default now(),
  -- Two types with the same name in one group is a mistake every time, and
  -- the picker would show them as one chip.
  unique (group_id, name)
);

create index if not exists assessment_types_group_idx
  on assessment_types (group_id, position);

alter table assessment_types enable row level security;

drop policy if exists "own rows" on assessment_types;
create policy "own rows" on assessment_types
  for all using (teacher_id = (select auth.uid()))
  with check (teacher_id = (select auth.uid()));

-- What this assessment was, in the teacher's words.
--
-- Copied onto the row rather than referenced, deliberately. Deleting a type
-- must not rewrite the history of every paper filed under it: "Test 2" stays
-- "Test 2" on the marks the class already sat, even after the teacher stops
-- using that type next term.
alter table assessments add column if not exists kind_label text;

-- Old rows keep their enum; new ones carry a label instead, so `kind` can no
-- longer be required.
alter table assessments alter column kind drop not null;

comment on column assessments.kind_label is
  'The teacher''s own name for this kind of assessment, copied from '
  'assessment_types at creation. Null on rows predating custom types, which '
  'fall back to the `kind` enum.';

-- ClassCare 0019 — how many courses a student has behind them.
--
-- Teachers here talk about students by level: "she is on her third course",
-- "he is a level 5". It is the closest thing this app has to progress, and it
-- was nowhere in the data.
--
-- The obvious column would be `level integer`, incremented when a course ends.
-- That column would be wrong within a term. A course finishes when its end date
-- passes, and a date passing is not an event the app is running to see — the
-- phone may be off, the teacher may not open the app for a week, and two
-- devices would each have to decide separately whether to increment without
-- double counting. Anything stored that way drifts, and drifts silently.
--
-- So the level is *counted* from the courses the student is in, every time it is
-- shown, and this column holds only what counting cannot know: courses done
-- before this app, or a number the teacher has corrected by hand.
--
--   level = level_base + (courses of theirs that have finished)
--
-- A student who arrives having already done two courses elsewhere gets a base
-- of 2 and reads as level 2 today, level 3 when their first course here ends.
-- That is what a teacher means by the word, and it keeps working with no
-- further intervention. `0` is the honest default: a new student has done
-- nothing yet, and every student that existed before this column is one whose
-- history the app already holds in full.
--
-- Safe to run on a database that already has 0001-0018 applied.

alter table students add column if not exists level_base integer not null default 0;

comment on column students.level_base is
  'Courses completed before this app, or a manual correction. The level shown '
  'is this plus the number of the student''s courses that have finished; it is '
  'never stored, because a course ends when a date passes and nothing is '
  'running to notice that.';

-- A level cannot be negative, and the arithmetic that sets this column
-- subtracts a count from a typed number. Without the check, a teacher typing 1
-- for a student who has already finished three courses writes -2 and every
-- later reading is wrong by two.
do $$
begin
  alter table students
    add constraint students_level_base_not_negative check (level_base >= 0);
exception
  when duplicate_object then null;
end $$;

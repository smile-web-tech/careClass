-- ClassCare 0021 — the father's name.
--
-- A name on a document issued here has three parts, not two: the given name,
-- the surname, and the father's name — `atasynyň ady`, the patronymic. It is
-- what a school asks for on the telephone and what appears on every form a
-- parent brings in, and until now the app had nowhere to put it.
--
-- It is not `parent2_name`. That column is the father as somebody to ring: it
-- holds his whole name and sits beside his phone, his email and his place of
-- work. This holds one word, and it is part of the *student's* name.
--
-- Kept out of `name` on purpose. `name` is what every screen displays, what the
-- roster sorts on and what the letter rail buckets by, and inserting a
-- patronymic into the middle of it would reshuffle a list teachers already know
-- by sight.
--
-- Nullable, and null for every student already entered. Nothing reads it as a
-- required value, so the roster keeps working untouched.
--
-- Safe to run on a database that already has 0001-0020 applied.

alter table students add column if not exists patronymic text;

comment on column students.patronymic is
  'The father''s name (patronymic). Part of the student''s own name, distinct '
  'from parent2_name, which is the father as a contact. Null on students '
  'entered before this column.';

-- ClassCare 0020 — the surname on its own.
--
-- `name` has always been the whole thing, and stays that way: it is what every
-- screen displays, what the list sorts on and what the letter rail buckets by,
-- and splitting it into two columns everywhere would be a rewrite of the app to
-- gain nothing a teacher can see.
--
-- What the surname earns on its own is gender. Turkmen surnames are patronymic
-- and gendered in both scripts a roster here is written in: `-ow`/`-ýew` and
-- the Russian `-ов`/`-ев` are a son, `-owa`/`-ýewa` and `-ова`/`-ева` are a
-- daughter. A teacher who has typed "Berdiýewa" has already said which, and the
-- gender column was asking them to say it again sixty more times.
--
-- Nullable, and null for every student already entered. `lib/names.ts` reads
-- the last word of `name` when this is empty, which is what the column would
-- have held anyway, so the inference works on the whole roster from the day it
-- ships and this column only sharpens it for students entered since.
--
-- Safe to run on a database that already has 0001-0019 applied.

alter table students add column if not exists surname text;

comment on column students.surname is
  'The family name alone. `name` remains the full name and is what the app '
  'displays and sorts by; this exists so the gender suffix can be read from '
  'the right word. Null on students entered before it, where the last word of '
  'name is used instead.';

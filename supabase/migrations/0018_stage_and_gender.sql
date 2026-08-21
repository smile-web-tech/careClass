-- ClassCare 0018 — which term a course belongs to, and whether a student is a
-- boy or a girl.
--
-- Two unrelated columns in one migration because both are single nullable
-- additions with no backfill and no dependency on each other, and a round trip
-- to a Turkmen network is expensive enough that splitting them buys nothing.
--
-- Safe to run on a database that already has 0001–0017 applied.

-- ---------------------------------------------------------------------------
-- groups.term
-- ---------------------------------------------------------------------------
--
-- 0016 gave a group real dates. Dates answer "is this class on next Tuesday",
-- which is what the calendar needs, and they answer it exactly. They do not
-- answer the question a tutor actually asks out loud: "how did the autumn lot
-- do?" A teacher runs the same course again every term and thinks of each
-- intake by its season, not by the fact that it started on the 14th.
--
-- Stored as a canonical `YYYY-season` key rather than a label, so the app can
-- sort terms, group by them, and render them in whichever of the three
-- languages the teacher happens to be reading. Storing "2026-ýaz" would freeze
-- the group in Turkmen for a teacher who switches to Russian next week.
--
-- Nullable, and null for every group that already exists. The app derives a
-- default from `starts_on` when a group is created, so this stays empty only
-- for groups made before today.

alter table groups add column if not exists term text;

do $$
begin
  alter table groups
    add constraint groups_term_shape
    check (term is null or term ~ '^[0-9]{4}-(spring|summer|autumn|winter)$');
exception
  when duplicate_object then null;
end $$;

comment on column groups.term is
  'Canonical term key, `YYYY-season`, e.g. 2026-spring. Null means the group '
  'predates terms. Rendered per-language by the app; never store a label here.';

-- Terms are filtered on constantly once they exist — the students list, the
-- group list, every "show me this intake" question — and a tutor accumulates
-- one row per course per season, so this stays small and selective.
create index if not exists groups_term_idx on groups (teacher_id, term);

-- ---------------------------------------------------------------------------
-- students.gender
-- ---------------------------------------------------------------------------
--
-- Needed for the thing schools ask tutors for constantly: a list of the girls,
-- a list of the boys, a head count of each for an exam hall or a trip. Doing
-- that by reading sixty names and guessing is exactly the work this app exists
-- to remove, and guessing from a name is unreliable in any of three languages.
--
-- Two values, both optional. A teacher who does not know, or whose list did not
-- carry it, leaves it null and everything still works — the filters treat null
-- as "not stated" rather than as a third gender, because that is what it is:
-- an absent field, not a claim about the child.

alter table students add column if not exists gender text;

do $$
begin
  alter table students
    add constraint students_gender_values
    check (gender is null or gender in ('male', 'female'));
exception
  when duplicate_object then null;
end $$;

comment on column students.gender is
  'male | female | null. Null means not recorded, which is a real and common '
  'state — the spreadsheet a teacher imported may simply not have had it.';

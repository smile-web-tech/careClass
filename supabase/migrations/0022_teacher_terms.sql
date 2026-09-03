-- ClassCare 0022 — terms the teacher has declared.
--
-- A term used to exist only as a consequence of a group: `groups.term` held
-- `2026-autumn`, and the term list on the home screen was whatever keys the
-- groups happened to carry. That works right up until a teacher wants to set
-- the term up *first* and put courses into it afterwards, which is the order
-- they actually plan in. An empty term had nowhere to be.
--
-- So the teacher's own list lives here. It is not a table: a term is a key, not
-- a record, it has no fields of its own, and nothing points at it. A text array
-- beside the other per-teacher settings is the whole of it, and it syncs and
-- restores on the same machinery as `hidden_templates`.
--
-- `groups.term` stays exactly as it is and remains the truth about which term a
-- course belongs to. This column adds terms that hold no courses yet; the app
-- shows the union of the two, so a teacher who has never opened the new screen
-- sees precisely what they saw before.
--
-- Empty array rather than null, so every read is a list and no caller has to
-- decide what an absent list means.
--
-- Safe to run on a database that already has 0001-0021 applied.

alter table teachers add column if not exists terms text[] not null default '{}'::text[];

comment on column teachers.terms is
  'Terms the teacher has created, as `YYYY-season` keys. The app lists these '
  'together with the terms in use by groups, so a term can exist before any '
  'course is in it. Not authoritative for any group: `groups.term` is.';

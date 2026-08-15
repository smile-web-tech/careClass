-- ClassCare 0016 — when a course runs, as opposed to which days it meets.
--
-- `group_slots` has always said "Monday and Thursday at four". It has never
-- said "for the eight weeks beginning in September", so a group met on those
-- days forever in both directions: a course that finished in June still filled
-- next January's calendar, and its attendance rate was computed against
-- sessions that were never going to happen.
--
-- Both columns are nullable and both stay null for every group that already
-- exists. Null means open — no first day, no last day — which is exactly the
-- behaviour those groups have now, and remains the right default for a tutor
-- whose classes simply continue.
--
-- Safe to run on a database that already has 0001–0015 applied.

alter table groups add column if not exists starts_on date;
alter table groups add column if not exists ends_on   date;

comment on column groups.starts_on is
  'First day the group meets. Null means it has always been running.';

comment on column groups.ends_on is
  'Last day the group meets, inclusive. Null means it has no planned end.';

-- A course cannot finish before it starts. Written as a constraint rather than
-- left to the app because two devices editing the same group can each hold half
-- of a valid pair, and the database is the only place that sees both.
do $$
begin
  alter table groups
    add constraint groups_dates_ordered
    check (starts_on is null or ends_on is null or ends_on >= starts_on);
exception
  when duplicate_object then null;
end $$;

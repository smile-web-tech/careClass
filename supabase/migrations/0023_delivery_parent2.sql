-- ClassCare 0023 — the father is a recipient too.
--
-- `message_deliveries.recipient` has said `student` or `parent` since 0001, and
-- `parent` has only ever meant the mother: the send path reads `parent_phone`
-- and nothing has ever read `parent2_phone`. A teacher whose only number for a
-- child is the father's could not text that child's family at all, and the app
-- did not say so — the student was silently skipped as having no guardian.
--
-- So the send now offers mother, father, or both, and a delivery to the father
-- has to be recordable as what it is. Filing it as `parent` would make the
-- message log claim the mother received something she never did, which is
-- exactly the record a teacher goes back to when a parent says they were not
-- told.
--
-- The check is widened, not replaced by nothing: an unconstrained text column
-- would accept a typo forever, and this one is written by hand in three places.
--
-- Safe to run on a database that already has 0001-0022 applied. Existing rows
-- all hold `student` or `parent` and are unaffected.

alter table message_deliveries drop constraint if exists message_deliveries_recipient_check;

alter table message_deliveries
  add constraint message_deliveries_recipient_check
  check (recipient in ('student', 'parent', 'parent2'));

comment on column message_deliveries.recipient is
  'Who this copy went to: the student, `parent` (the mother, parent_name and '
  'parent_phone), or `parent2` (the father).';

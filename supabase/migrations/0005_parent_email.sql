-- ClassCare 0005 — an email address for the parent / guardian.
--
-- Until now `students` held a parent name and a parent phone but no parent
-- address, so the email channel could only ever reach the student themselves.
-- Choosing audience "parents" with the email channel produced a send with zero
-- recipients and no error — the message simply went nowhere.
--
-- Safe to run on a database that already has 0001–0004 applied.

alter table students add column if not exists parent_email text;

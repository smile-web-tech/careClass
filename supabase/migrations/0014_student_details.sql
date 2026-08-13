-- What a tutor actually keeps about a student.
--
-- The table held a name, a phone, an email and one parent's details. That is
-- enough to send a message and nothing else. A private tutor in Turkmenistan
-- also needs the birthday (so they can say something on the day), the school
-- the child attends, where they live, an identity document number for exam
-- registration, and both parents rather than one — because the one whose
-- number is in the phone is not always the one who answers.

alter table students add column if not exists birth_date        date;
alter table students add column if not exists address           text;
alter table students add column if not exists school            text;

-- Passport or birth certificate, whichever the family has. One column rather
-- than two: the number is what gets copied onto an exam form, and which
-- document it came from is not something the app needs to reason about.
alter table students add column if not exists document_id       text;

-- The guardian columns from migration 0001 (`parent_name`, `parent_phone`,
-- `parent_email`) stay as the first parent. Renaming them would break every
-- row and every query for a cosmetic gain.
alter table students add column if not exists parent_work       text;
alter table students add column if not exists parent2_name      text;
alter table students add column if not exists parent2_phone     text;
alter table students add column if not exists parent2_email     text;
alter table students add column if not exists parent2_work      text;

comment on column students.birth_date is
  'Date only, no time. Drives the birthday reminder, which the device schedules '
  'locally from this.';

comment on column students.document_id is
  'Passport or birth certificate number. Free text: the formats differ and a '
  'constraint here would reject a real document.';

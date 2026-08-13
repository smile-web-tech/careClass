-- Two messages, because a result is two different pieces of news.
--
-- One wording cannot serve both. "You scored 31 out of 50" reads as a
-- congratulation when the pass mark is 25 and as a rebuke when it is 35, and a
-- teacher who wants to add a sentence of encouragement to the second cannot do
-- it without putting it on the first as well.
--
-- `grade_template` from migration 0011 becomes the pass wording — every
-- existing row already holds a message written for a result that is fine, so
-- nothing needs rewriting.
alter table teachers add column if not exists grade_template_fail text;

-- The line between the two, per assessment rather than per teacher: a mock
-- exam out of 100 and a vocabulary quiz out of 10 do not share a threshold.
alter table assessments add column if not exists pass_mark numeric;

comment on column teachers.grade_template_fail is
  'Wording used when a mark is below the assessment''s pass_mark. Null means '
  'the teacher has not written one and the app''s translated default applies.';

comment on column assessments.pass_mark is
  'Lowest score counted as a pass. Null means the teacher set none, and every '
  'result is sent with the pass wording.';

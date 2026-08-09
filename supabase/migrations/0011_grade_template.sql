-- The teacher's own wording for a result.
--
-- `send-grades` composed the message itself, in English, with no way to change
-- it — so a Turkmen teacher's students received "You scored 42 out of 50" from
-- an app the teacher had been using in Turkmen all term. The wording is theirs
-- to write, in their language, once, and then every result follows it.
--
-- Null means "the teacher has not written one", and the app falls back to the
-- translated default rather than storing a copy of it. That keeps the default
-- improving with the catalogue instead of freezing at whatever it said on the
-- day the account was made.

alter table teachers add column if not exists grade_template text;

comment on column teachers.grade_template is
  'Message sent with an exam result. Placeholders: {name} {student} {group} '
  '{title} {kind} {score} {max} {percent} {date} {teacher}. Null = use the '
  'app''s translated default.';

-- ClassCare 0017 — the teacher's edits to the starter templates.
--
-- The app ships a handful of ready-made messages: a reminder, an absence note,
-- a fee note. Teachers can reword them and take the ones they never use off the
-- list, and both of those have been kept on the device and nowhere else since
-- the feature was written.
--
-- That is a silent loss. Signing out wipes the local database, and so does a
-- reinstall or a new phone — so a teacher who spent an evening getting the
-- wording of a fee reminder right in Turkmen found the English default back the
-- next time they signed in, with nothing to say why. It also meant a second
-- device never saw the first one's wording.
--
-- Two columns rather than a table. These are settings belonging to one teacher,
-- keyed by a template id the *app* defines — not rows anybody queries, joins or
-- reports on — and a table would buy nothing but a join.
--
-- Safe to run on a database that already has 0001–0016 applied.

alter table teachers add column if not exists template_overrides jsonb not null default '{}'::jsonb;
alter table teachers add column if not exists hidden_templates  text[] not null default '{}';

comment on column teachers.template_overrides is
  'Rewrites of the built-in message templates, as {"<template id>": {"title": …, "body": …}}. '
  'The ids are defined by the app, not by this database.';

comment on column teachers.hidden_templates is
  'Ids of built-in templates the teacher removed from their list. Reversible in the app.';

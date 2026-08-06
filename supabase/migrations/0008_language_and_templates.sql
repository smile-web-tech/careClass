-- ClassCare 0008 — interface language and the teacher's own email wording.
--
-- Both live on `teachers` rather than in tables of their own: there is exactly
-- one of each per account, and the Edge Functions already read that row on
-- every send, so a student's email can be written in the teacher's language
-- without a second query.
--
-- `language` is deliberately `text` with a check rather than an enum. Adding a
-- third language should be a one-line migration, and `alter type ... add value`
-- cannot be rolled back.
--
-- Safe to run on a database that already has 0001–0007 applied.

alter table teachers add column if not exists language text not null default 'tk';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'teachers_language_check'
  ) then
    alter table teachers
      add constraint teachers_language_check check (language in ('tk', 'ru', 'en'));
  end if;
end
$$;

-- The teacher's overrides only. Null means "use the built-in wording for their
-- language", so a teacher who never opens the editor keeps getting the
-- translated defaults — and keeps getting improvements to them.
alter table teachers add column if not exists email_templates jsonb;

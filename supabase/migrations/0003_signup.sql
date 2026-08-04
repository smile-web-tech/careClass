-- ClassCare 0003 — registration hardening.
--
-- Safe to re-run.

/* ------------------------------------------------------------------ *
 * 1. Optional phone on the teacher profile.
 * ------------------------------------------------------------------ */

alter table teachers add column if not exists phone text
  check (phone is null or length(btrim(phone)) between 4 and 32);

/* ------------------------------------------------------------------ *
 * 2. Only create a profile for a CONFIRMED user.
 *
 * 0001 fired `handle_new_user` on every insert into auth.users. GoTrue
 * inserts the row the moment an OTP is *sent*, so abandoning signup —
 * closing the app at the code screen, never opening the email — left a
 * `teachers` row behind with an empty name. The account then looked
 * half-registered: real enough to block a retry from looking like a
 * fresh signup, empty enough to be useless.
 *
 * Now the profile is created when the email is actually confirmed:
 *   - INSERT ... WHEN confirmed   covers OAuth, which confirms instantly.
 *   - UPDATE ... WHEN newly confirmed  covers the email OTP path.
 *
 * An abandoned signup therefore leaves an unconfirmed auth.users row and
 * nothing else. Retrying works, and confirming later still produces the
 * profile.
 * ------------------------------------------------------------------ */

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.teachers (id, name, email, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      ''
    ),
    new.email,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created  on auth.users;
drop trigger if exists on_auth_user_confirmed on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  when (new.email_confirmed_at is not null)
  execute function handle_new_user();

create trigger on_auth_user_confirmed
  after update on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function handle_new_user();

/* ------------------------------------------------------------------ *
 * 3. Clear out profiles left by the old behaviour.
 *
 * Rows whose auth user never confirmed and which carry no name are the
 * residue of abandoned signups. Anything with a name, or any groups or
 * students, is left strictly alone.
 * ------------------------------------------------------------------ */

delete from teachers t
where btrim(coalesce(t.name, '')) = ''
  and not exists (select 1 from groups   g where g.teacher_id = t.id)
  and not exists (select 1 from students s where s.teacher_id = t.id)
  and exists (
    select 1 from auth.users u
    where u.id = t.id and u.email_confirmed_at is null
  );

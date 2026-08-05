-- ClassCare 0004 — password registration.
--
-- Registration now collects a name and an optional phone *before* the account
-- exists, and hands both to `signUp` as user metadata. The trigger has to read
-- them, or a teacher who confirms their email in the mail app on another device
-- — never returning to the form — ends up with a nameless profile.
--
-- Safe to re-run.

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta_phone text;
begin
  -- Metadata is client-supplied, so treat it as untrusted: blank becomes null,
  -- and anything outside the column's own bounds is dropped rather than
  -- failing the trigger and, with it, the whole confirmation.
  meta_phone := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'phone', '')), '');
  if meta_phone is not null and length(meta_phone) not between 4 and 32 then
    meta_phone := null;
  end if;

  insert into public.teachers (id, name, email, avatar_url, phone)
  values (
    new.id,
    left(
      btrim(
        coalesce(
          new.raw_user_meta_data ->> 'full_name',
          new.raw_user_meta_data ->> 'name',
          ''
        )
      ),
      120
    ),
    new.email,
    new.raw_user_meta_data ->> 'avatar_url',
    meta_phone
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- The triggers themselves are unchanged from 0003 — profile on confirmation
-- only — but recreated here so this file stands alone if it is the one applied
-- to a fresh project.
drop trigger if exists on_auth_user_created   on auth.users;
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

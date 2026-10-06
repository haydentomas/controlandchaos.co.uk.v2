begin;

create function cc_private.valid_directory_hardware(items jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare item jsonb;
begin
  if jsonb_typeof(items) is distinct from 'array' then return false; end if;
  if jsonb_array_length(items) > 30 then return false; end if;
  for item in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(item) is distinct from 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(item) as key where key not in ('name','desc','icon','badge_text')) then return false; end if;
    if jsonb_typeof(item->'name') is distinct from 'string' or char_length(btrim(item->>'name')) not between 1 and 100 then return false; end if;
    if item ? 'desc' and (jsonb_typeof(item->'desc') is distinct from 'string' or char_length(item->>'desc') > 300) then return false; end if;
    if item ? 'icon' and (jsonb_typeof(item->'icon') is distinct from 'string' or char_length(item->>'icon') > 16) then return false; end if;
    if item ? 'badge_text' and (jsonb_typeof(item->'badge_text') is distinct from 'string' or char_length(item->>'badge_text') > 40) then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function cc_private.valid_directory_hardware(jsonb) from public;
grant execute on function cc_private.valid_directory_hardware(jsonb) to anon, authenticated, service_role;

create function cc_private.valid_directory_wishlist(items jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare item jsonb; url text;
begin
  if jsonb_typeof(items) is distinct from 'array' then return false; end if;
  if jsonb_array_length(items) > 20 then return false; end if;
  for item in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(item) is distinct from 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(item) as key where key not in ('title','url','note')) then return false; end if;
    if jsonb_typeof(item->'title') is distinct from 'string' or char_length(btrim(item->>'title')) not between 1 and 100 then return false; end if;
    if item ? 'url' then
      if jsonb_typeof(item->'url') is distinct from 'string' or char_length(item->>'url') > 2048 then return false; end if;
      url := item->>'url';
      if url <> '' and (url !~ '^https://[^[:space:]]+$' or position(chr(92) in url) > 0 or url ~ '^https://[^/?#]*@') then return false; end if;
    end if;
    if item ? 'note' and (jsonb_typeof(item->'note') is distinct from 'string' or char_length(item->>'note') > 300) then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function cc_private.valid_directory_wishlist(jsonb) from public;
grant execute on function cc_private.valid_directory_wishlist(jsonb) to anon, authenticated, service_role;

alter table public.directory_gallery_photos
  add column show_in_sidebar boolean not null default true;

alter table public.directory_profiles
  add column hardware_title text not null default 'My Toys' check (char_length(hardware_title) <= 100),
  add column hardware_compat jsonb not null default '[]'::jsonb check (cc_private.valid_directory_hardware(hardware_compat)),
  add column wishlist_title text not null default 'Wishlist & Tributes' check (char_length(wishlist_title) <= 100),
  add column wishlist jsonb not null default '[]'::jsonb check (cc_private.valid_directory_wishlist(wishlist));
grant update (hardware_title, hardware_compat, wishlist_title, wishlist) on public.directory_profiles to authenticated;

create table cc_private.directory_booking_contacts (
  profile_id uuid primary key references public.directory_profiles(id) on delete cascade,
  contact_email text not null check (
    char_length(contact_email) <= 254
    and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  )
);
alter table cc_private.directory_booking_contacts enable row level security;
revoke all on cc_private.directory_booking_contacts from public, anon, authenticated;
grant select, insert, update, delete on cc_private.directory_booking_contacts to authenticated;
grant all on cc_private.directory_booking_contacts to service_role;

create policy directory_booking_contact_owner_read on cc_private.directory_booking_contacts
for select to authenticated using (cc_private.can_manage_directory_profile(profile_id));
create policy directory_booking_contact_owner_insert on cc_private.directory_booking_contacts
for insert to authenticated with check (cc_private.can_manage_directory_profile(profile_id));
create policy directory_booking_contact_owner_update on cc_private.directory_booking_contacts
for update to authenticated using (cc_private.can_manage_directory_profile(profile_id))
with check (cc_private.can_manage_directory_profile(profile_id));
create policy directory_booking_contact_owner_delete on cc_private.directory_booking_contacts
for delete to authenticated using (cc_private.can_manage_directory_profile(profile_id));

create function public.save_directory_profile_booking(target_profile uuid, profile_changes jsonb, photos jsonb, contact_email text)
returns setof public.directory_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_profile public.directory_profiles%rowtype;
  normalized_email text := pg_catalog.btrim(contact_email);
  legacy_photos jsonb;
  legacy_changes jsonb;
  photo jsonb;
  sidebar boolean;
begin
  if normalized_email is null then normalized_email := ''; end if;
  if pg_catalog.char_length(normalized_email) > 254 or (normalized_email <> '' and normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'invalid_booking_contact';
  end if;
  if jsonb_typeof(profile_changes) is distinct from 'object' then raise exception 'invalid_profile_fields'; end if;
  if profile_changes ? 'hardware_title' and (jsonb_typeof(profile_changes->'hardware_title') is distinct from 'string' or char_length(profile_changes->>'hardware_title') > 100) then raise exception 'invalid_profile_fields'; end if;
  if profile_changes ? 'hardware_compat' and not cc_private.valid_directory_hardware(profile_changes->'hardware_compat') then raise exception 'invalid_profile_fields'; end if;
  if profile_changes ? 'wishlist_title' and (jsonb_typeof(profile_changes->'wishlist_title') is distinct from 'string' or char_length(profile_changes->>'wishlist_title') > 100) then raise exception 'invalid_profile_fields'; end if;
  if profile_changes ? 'wishlist' and not cc_private.valid_directory_wishlist(profile_changes->'wishlist') then raise exception 'invalid_profile_fields'; end if;
  legacy_changes := profile_changes - 'hardware_title' - 'hardware_compat' - 'wishlist_title' - 'wishlist';
  if jsonb_typeof(photos) is distinct from 'array' then raise exception 'invalid_gallery'; end if;
  for photo in select value from jsonb_array_elements(photos) loop
    if photo ? 'show_in_sidebar' and jsonb_typeof(photo->'show_in_sidebar') is distinct from 'boolean' then raise exception 'invalid_gallery'; end if;
  end loop;
  select coalesce(jsonb_agg(value - 'show_in_sidebar'), '[]'::jsonb) into legacy_photos from jsonb_array_elements(photos);
  select * into saved_profile from public.save_directory_profile_media(target_profile, legacy_changes, legacy_photos) limit 1;
  if not found then raise exception 'profile_save_failed'; end if;
  update public.directory_profiles set
    hardware_title = case when profile_changes ? 'hardware_title' then profile_changes->>'hardware_title' else hardware_title end,
    hardware_compat = case when profile_changes ? 'hardware_compat' then profile_changes->'hardware_compat' else hardware_compat end,
    wishlist_title = case when profile_changes ? 'wishlist_title' then profile_changes->>'wishlist_title' else wishlist_title end,
    wishlist = case when profile_changes ? 'wishlist' then profile_changes->'wishlist' else wishlist end
    where id = target_profile;
  for photo in select value from jsonb_array_elements(photos) loop
    sidebar := coalesce((photo->>'show_in_sidebar')::boolean, true);
    update public.directory_gallery_photos set show_in_sidebar = sidebar
      where id = (photo->>'id')::uuid and profile_id = target_profile;
    if not found then raise exception 'invalid_gallery'; end if;
  end loop;
  if normalized_email = '' then
    delete from cc_private.directory_booking_contacts where profile_id = target_profile;
  else
    insert into cc_private.directory_booking_contacts(profile_id, contact_email)
      values (target_profile, normalized_email)
      on conflict (profile_id) do update set contact_email = excluded.contact_email;
  end if;
  select * into saved_profile from public.directory_profiles where id = target_profile;
  return next saved_profile;
end;
$$;
revoke all on function public.save_directory_profile_booking(uuid,jsonb,jsonb,text) from public, anon;
grant execute on function public.save_directory_profile_booking(uuid,jsonb,jsonb,text) to authenticated, service_role;

create function public.my_directory_booking_contact(target_profile uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select contact.contact_email
  from cc_private.directory_booking_contacts as contact
  where contact.profile_id = target_profile
    and cc_private.can_manage_directory_profile(target_profile);
$$;
revoke all on function public.my_directory_booking_contact(uuid) from public, anon;
grant execute on function public.my_directory_booking_contact(uuid) to authenticated, service_role;

create function public.directory_booking_recipient(target_profile uuid)
returns table (recipient_email text, display_name text, sl_username text, rate_categories jsonb, booking_hours jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(contact.contact_email, account.email), profile.display_name, profile.sl_username, profile.rate_categories, profile.booking_hours
  from public.directory_profiles as profile
  join cc_private.profile_owners as ownership on ownership.profile_id = profile.id
  join cc_private.verified_avatar_links as identity
    on identity.avatar_uuid = ownership.avatar_uuid and identity.user_id = ownership.user_id
  join cc_private.directory_subscriptions as subscription
    on subscription.profile_id = profile.id and subscription.avatar_uuid = ownership.avatar_uuid
  left join cc_private.directory_booking_contacts as contact on contact.profile_id = profile.id
  join auth.users as account on account.id = ownership.user_id
  where profile.id = target_profile
    and profile.is_approved
    and profile.is_published
    and profile.booking_hours is not null
    and identity.revoked_at is null
    and account.email is not null
    and account.email_confirmed_at is not null
    and subscription.suspended_at is null
    and (subscription.is_lifetime or subscription.expires_at > pg_catalog.now())
  limit 1;
$$;

revoke all on function public.directory_booking_recipient(uuid) from public, anon, authenticated;
grant execute on function public.directory_booking_recipient(uuid) to service_role;

commit;
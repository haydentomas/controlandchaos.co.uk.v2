begin;

create or replace function public.save_directory_profile_booking(target_profile uuid, profile_changes jsonb, photos jsonb, contact_email text)
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
begin
  if normalized_email is null then normalized_email := ''; end if;
  if char_length(normalized_email) > 254 or (normalized_email <> '' and normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'invalid_booking_contact'; end if;
  if jsonb_typeof(profile_changes) is distinct from 'object' then raise exception 'invalid_profile_fields'; end if;
  if profile_changes ? 'boundaries' and (jsonb_typeof(profile_changes->'boundaries') is distinct from 'string' or char_length(profile_changes->>'boundaries') > 4000) then raise exception 'invalid_profile_fields'; end if;
  if profile_changes ? 'booking_instructions' and (jsonb_typeof(profile_changes->'booking_instructions') is distinct from 'string' or char_length(profile_changes->>'booking_instructions') > 4000) then raise exception 'invalid_profile_fields'; end if;
  if profile_changes ? 'hardware_title' and (jsonb_typeof(profile_changes->'hardware_title') is distinct from 'string' or char_length(profile_changes->>'hardware_title') > 100) then raise exception 'invalid_profile_fields'; end if;
  if profile_changes ? 'hardware_compat' and not cc_private.valid_directory_hardware(profile_changes->'hardware_compat') then raise exception 'invalid_profile_fields'; end if;
  if profile_changes ? 'wishlist_title' and (jsonb_typeof(profile_changes->'wishlist_title') is distinct from 'string' or char_length(profile_changes->>'wishlist_title') > 100) then raise exception 'invalid_profile_fields'; end if;
  if profile_changes ? 'wishlist' and not cc_private.valid_directory_wishlist(profile_changes->'wishlist') then raise exception 'invalid_profile_fields'; end if;
  legacy_changes := profile_changes - 'boundaries' - 'booking_instructions' - 'hardware_title' - 'hardware_compat' - 'wishlist_title' - 'wishlist';
  if jsonb_typeof(photos) is distinct from 'array' then raise exception 'invalid_gallery'; end if;
  if jsonb_array_length(photos) > 20 then raise exception 'invalid_gallery'; end if;
  for photo in select value from jsonb_array_elements(photos) loop
    if jsonb_typeof(photo) is distinct from 'object' then raise exception 'invalid_gallery'; end if;
    if photo ? 'show_in_sidebar' and jsonb_typeof(photo->'show_in_sidebar') is distinct from 'boolean' then raise exception 'invalid_gallery'; end if;
    if photo ? 'storage_path' and jsonb_typeof(photo->'storage_path') is distinct from 'string' then raise exception 'invalid_gallery'; end if;
    if coalesce(photo->>'storage_path', '') <> '' and photo->>'storage_path' !~ ('^' || target_profile::text || '/' || (photo->>'id') || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]webp$') then raise exception 'invalid_gallery'; end if;
  end loop;
  select coalesce(jsonb_agg((value - 'show_in_sidebar') || jsonb_build_object('storage_path', coalesce(value->>'storage_path',''))), '[]'::jsonb)
    into legacy_photos from jsonb_array_elements(photos);
  select * into saved_profile from public.save_directory_profile_media(target_profile, legacy_changes, legacy_photos) limit 1;
  if not found then raise exception 'profile_save_failed'; end if;
  update public.directory_profiles set
    boundaries = case when profile_changes ? 'boundaries' then profile_changes->>'boundaries' else boundaries end,
    booking_instructions = case when profile_changes ? 'booking_instructions' then profile_changes->>'booking_instructions' else booking_instructions end,
    hardware_title = case when profile_changes ? 'hardware_title' then profile_changes->>'hardware_title' else hardware_title end,
    hardware_compat = case when profile_changes ? 'hardware_compat' then profile_changes->'hardware_compat' else hardware_compat end,
    wishlist_title = case when profile_changes ? 'wishlist_title' then profile_changes->>'wishlist_title' else wishlist_title end,
    wishlist = case when profile_changes ? 'wishlist' then profile_changes->'wishlist' else wishlist end
    where id = target_profile;
  for photo in select value from jsonb_array_elements(photos) loop
    update public.directory_gallery_photos set show_in_sidebar=coalesce((photo->>'show_in_sidebar')::boolean,true)
      where id=(photo->>'id')::uuid and profile_id=target_profile;
    if not found then raise exception 'invalid_gallery'; end if;
  end loop;
  if normalized_email = '' then delete from cc_private.directory_booking_contacts where profile_id=target_profile;
  else insert into cc_private.directory_booking_contacts(profile_id,contact_email) values(target_profile,normalized_email)
    on conflict (profile_id) do update set contact_email=excluded.contact_email;
  end if;
  select * into saved_profile from public.directory_profiles where id=target_profile;
  return next saved_profile;
end;
$$;
revoke all on function public.save_directory_profile_booking(uuid,jsonb,jsonb,text) from public, anon;
grant execute on function public.save_directory_profile_booking(uuid,jsonb,jsonb,text) to authenticated, service_role;

commit;

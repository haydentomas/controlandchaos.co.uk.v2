begin;

alter table public.directory_gallery_photos
  add column storage_path text not null default ''
  check (storage_path = '' or storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]webp$');
alter table public.directory_gallery_photos add constraint directory_gallery_photos_storage_owner_path_check
  check (storage_path = '' or split_part(storage_path, '/', 1) = profile_id::text);
alter table public.directory_gallery_photos add constraint directory_gallery_photos_storage_photo_path_check
  check (storage_path = '' or split_part(storage_path, '/', 2) = id::text);

alter table public.directory_gallery_photos alter column image_url set default '';
alter table public.directory_gallery_photos alter column image_url drop not null;
alter table public.directory_gallery_photos drop constraint directory_gallery_photos_image_url_check;
alter table public.directory_gallery_photos add constraint directory_gallery_photos_source_check
  check (
    (storage_path = '' and image_url is not null and char_length(image_url) <= 2048
      and image_url ~ '^(/[^/]|https://)[^[:space:]]+$'
      and position(chr(92) in image_url) = 0 and image_url !~ '^https://[^/?#]*@')
    or
    (storage_path <> '' and image_url = '')
  );

create or replace function public.save_directory_profile_media(target_profile uuid, profile_changes jsonb, photos jsonb)
returns setof public.directory_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_profile public.directory_profiles%rowtype;
  candidate public.directory_profiles%rowtype;
  photo jsonb;
  photo_ids uuid[] := '{}';
  position integer := 0;
  image_url text;
  storage_path text;
begin
  if not cc_private.can_manage_directory_profile(target_profile) then raise exception 'profile_access_denied' using errcode = '42501'; end if;
  if jsonb_typeof(profile_changes) is distinct from 'object' or octet_length(profile_changes::text) > 524288 then raise exception 'invalid_profile_fields'; end if;
  if exists (select 1 from jsonb_object_keys(profile_changes) as field where field not in
    ('display_name','role_type','headline','tagline','about','avatar_image','banner_image','starting_rate','availability','tags','is_published','rate_categories','availability_note','booking_hours')) then raise exception 'invalid_profile_fields'; end if;
  if jsonb_typeof(photos) is distinct from 'array' then raise exception 'invalid_gallery'; end if;
  if jsonb_array_length(photos) > 20 or octet_length(photos::text) > 524288 then raise exception 'invalid_gallery'; end if;
  select * into current_profile from public.directory_profiles where id = target_profile for update;
  if not found or not cc_private.can_manage_directory_profile(target_profile) then raise exception 'profile_access_denied' using errcode = '42501'; end if;
  for photo in select value from jsonb_array_elements(photos) loop
    if jsonb_typeof(photo) is distinct from 'object' then raise exception 'invalid_gallery'; end if;
    if exists (select 1 from jsonb_object_keys(photo) as field where field not in ('id','title','category','description','image_url','storage_path','is_published')) then raise exception 'invalid_gallery'; end if;
    if jsonb_typeof(photo->'id') is distinct from 'string' or (photo->>'id') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'invalid_gallery'; end if;
    if (photo->>'id')::uuid = any(photo_ids) then raise exception 'invalid_gallery'; end if;
    if jsonb_typeof(photo->'title') is distinct from 'string' or jsonb_typeof(photo->'category') is distinct from 'string'
      or jsonb_typeof(photo->'description') is distinct from 'string' or jsonb_typeof(photo->'image_url') is distinct from 'string'
      or jsonb_typeof(photo->'is_published') is distinct from 'boolean' then raise exception 'invalid_gallery'; end if;
    if photo ? 'storage_path' and jsonb_typeof(photo->'storage_path') is distinct from 'string' then raise exception 'invalid_gallery'; end if;
    image_url := photo->>'image_url';
    storage_path := coalesce(photo->>'storage_path','');
    if storage_path <> '' then
      if storage_path !~ ('^' || target_profile::text || '/' || (photo->>'id') || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]webp$') or image_url <> '' then raise exception 'invalid_gallery'; end if;
    elsif char_length(image_url) > 2048 or image_url !~ '^(/[^/]|https://)[^[:space:]]+$'
      or position(chr(92) in image_url) > 0 or image_url ~ '^https://[^/?#]*@' then raise exception 'invalid_gallery'; end if;
    photo_ids := array_append(photo_ids, (photo->>'id')::uuid);
  end loop;
  if exists (select 1 from public.directory_gallery_photos where id = any(photo_ids) and profile_id <> target_profile) then raise exception 'invalid_gallery'; end if;
  candidate := jsonb_populate_record(current_profile, profile_changes);
  update public.directory_profiles set display_name=candidate.display_name, role_type=candidate.role_type,
    headline=candidate.headline, tagline=candidate.tagline, about=candidate.about,
    avatar_image=candidate.avatar_image, banner_image=candidate.banner_image, starting_rate=candidate.starting_rate,
    availability=candidate.availability, tags=candidate.tags, is_published=candidate.is_published,
    rate_categories=candidate.rate_categories, availability_note=candidate.availability_note, booking_hours=candidate.booking_hours
    where id = target_profile;
  delete from public.directory_gallery_photos where profile_id = target_profile and not (id = any(photo_ids));
  for photo in select value from jsonb_array_elements(photos) loop
    insert into public.directory_gallery_photos(id,profile_id,title,category,description,image_url,storage_path,sort_order,is_published)
      values ((photo->>'id')::uuid,target_profile,photo->>'title',photo->>'category',photo->>'description',photo->>'image_url',coalesce(photo->>'storage_path',''),position,(photo->>'is_published')::boolean)
      on conflict (id) do update set title=excluded.title,category=excluded.category,description=excluded.description,
        image_url=excluded.image_url,storage_path=excluded.storage_path,sort_order=excluded.sort_order,is_published=excluded.is_published
        where directory_gallery_photos.profile_id = target_profile;
    if not found then raise exception 'invalid_gallery'; end if;
    position := position + 1;
  end loop;
  return query select * from public.directory_profiles where id = target_profile;
end;
$$;
revoke all on function public.save_directory_profile_media(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.save_directory_profile_media(uuid,jsonb,jsonb) to authenticated, service_role;

create function cc_private.enforce_directory_gallery_limit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare photo_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.profile_id::text, 12));
  select count(*) into photo_count from public.directory_gallery_photos where profile_id = new.profile_id and id <> new.id;
  if photo_count >= 20 then raise exception 'gallery_photo_limit' using errcode = '23514'; end if;
  return new;
end;
$$;
revoke all on function cc_private.enforce_directory_gallery_limit() from public, anon, authenticated;
create trigger directory_gallery_photo_limit before insert or update of profile_id on public.directory_gallery_photos
for each row execute function cc_private.enforce_directory_gallery_limit();

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('directory-gallery', 'directory-gallery', false, 2097152, array['image/webp'])
on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/webp'];

create function cc_private.can_upload_directory_gallery_object(object_name text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare target_profile uuid; target_photo uuid; photo_count integer; pending_count integer;
begin
  if object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]webp$' then return false; end if;
  target_profile := split_part(object_name, '/', 1)::uuid;
  target_photo := split_part(object_name, '/', 2)::uuid;
  if not cc_private.can_manage_directory_profile(target_profile) then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_profile::text, 12));
  if exists (select 1 from storage.objects where bucket_id='directory-gallery' and name=object_name) then return false; end if;
  if exists (select 1 from public.directory_gallery_photos where profile_id=target_profile and id=target_photo) then return true; end if;
  select count(*) into photo_count from public.directory_gallery_photos where profile_id=target_profile;
  select count(*) into pending_count from storage.objects as stored
    where stored.bucket_id='directory-gallery' and split_part(stored.name, '/', 1)=target_profile::text
      and not exists (select 1 from public.directory_gallery_photos as photo where photo.storage_path=stored.name);
  return photo_count + pending_count < 20;
end;
$$;
revoke all on function cc_private.can_upload_directory_gallery_object(text) from public, anon;
grant execute on function cc_private.can_upload_directory_gallery_object(text) to authenticated, service_role;

create policy directory_gallery_owner_upload on storage.objects
for insert to authenticated
with check (
  bucket_id = 'directory-gallery'
  and cc_private.can_upload_directory_gallery_object(name)
);

create policy directory_gallery_owner_read on storage.objects
for select to authenticated
using (
  bucket_id = 'directory-gallery'
  and exists (select 1 from public.directory_profiles as profile
    where profile.id::text = split_part(name, '/', 1)
      and cc_private.can_manage_directory_profile(profile.id))
);

create policy directory_gallery_public_read on storage.objects
for select to anon, authenticated
using (
  bucket_id = 'directory-gallery'
  and exists (
    select 1 from public.directory_gallery_photos as photo
    join public.directory_profiles as profile on profile.id = photo.profile_id
    where photo.storage_path = name and photo.is_published
      and profile.is_approved and profile.is_published
      and cc_private.directory_profile_paid(profile.id)
  )
);

create policy directory_gallery_owner_update on storage.objects
for update to authenticated
using (
  bucket_id = 'directory-gallery'
  and exists (select 1 from public.directory_profiles as profile
    where profile.id::text = split_part(name, '/', 1)
      and cc_private.can_manage_directory_profile(profile.id))
)
with check (
  bucket_id = 'directory-gallery'
  and exists (select 1 from public.directory_profiles as profile
    where profile.id::text = split_part(name, '/', 1)
      and cc_private.can_manage_directory_profile(profile.id))
);

create policy directory_gallery_owner_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'directory-gallery'
  and exists (select 1 from public.directory_profiles as profile
    where profile.id::text = split_part(name, '/', 1)
      and cc_private.can_manage_directory_profile(profile.id))
);

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
  if profile_changes ? 'hardware_title' and (jsonb_typeof(profile_changes->'hardware_title') is distinct from 'string' or char_length(profile_changes->>'hardware_title') > 100) then raise exception 'invalid_profile_fields'; end if;
  if profile_changes ? 'hardware_compat' and not cc_private.valid_directory_hardware(profile_changes->'hardware_compat') then raise exception 'invalid_profile_fields'; end if;
  if profile_changes ? 'wishlist_title' and (jsonb_typeof(profile_changes->'wishlist_title') is distinct from 'string' or char_length(profile_changes->>'wishlist_title') > 100) then raise exception 'invalid_profile_fields'; end if;
  if profile_changes ? 'wishlist' and not cc_private.valid_directory_wishlist(profile_changes->'wishlist') then raise exception 'invalid_profile_fields'; end if;
  legacy_changes := profile_changes - 'hardware_title' - 'hardware_compat' - 'wishlist_title' - 'wishlist';
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

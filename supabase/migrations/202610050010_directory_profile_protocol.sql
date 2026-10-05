begin;

alter table public.directory_profiles
  add column boundaries text not null default '' check (char_length(boundaries) <= 4000),
  add column booking_instructions text not null default '' check (char_length(booking_instructions) <= 4000);
grant update (boundaries, booking_instructions) on public.directory_profiles to authenticated;

create or replace function public.save_directory_profile_media(target_profile uuid, profile_changes jsonb, photos jsonb)
returns setof public.directory_profiles
language plpgsql security definer set search_path = ''
as $$
declare
  current_profile public.directory_profiles%rowtype;
  candidate public.directory_profiles%rowtype;
  photo jsonb;
  photo_ids uuid[] := '{}';
  position integer := 0;
begin
  if not cc_private.can_manage_directory_profile(target_profile) then raise exception 'profile_access_denied' using errcode = '42501'; end if;
  if jsonb_typeof(profile_changes) is distinct from 'object' or octet_length(profile_changes::text) > 524288 then raise exception 'invalid_profile_fields'; end if;
  if exists (select 1 from jsonb_object_keys(profile_changes) as field where field not in
    ('display_name','role_type','headline','tagline','about','avatar_image','banner_image','starting_rate','availability','tags','is_published','rate_categories','availability_note','booking_hours','boundaries','booking_instructions')) then raise exception 'invalid_profile_fields'; end if;
  if (profile_changes ? 'boundaries' and jsonb_typeof(profile_changes->'boundaries') is distinct from 'string')
    or (profile_changes ? 'booking_instructions' and jsonb_typeof(profile_changes->'booking_instructions') is distinct from 'string') then raise exception 'invalid_profile_fields'; end if;
  if jsonb_typeof(photos) is distinct from 'array' then raise exception 'invalid_gallery'; end if;
  if jsonb_array_length(photos) > 100 or octet_length(photos::text) > 524288 then raise exception 'invalid_gallery'; end if;
  select * into current_profile from public.directory_profiles where id = target_profile for update;
  if not found or not cc_private.can_manage_directory_profile(target_profile) then raise exception 'profile_access_denied' using errcode = '42501'; end if;
  for photo in select value from jsonb_array_elements(photos) loop
    if jsonb_typeof(photo) <> 'object' then raise exception 'invalid_gallery'; end if;
    if exists (select 1 from jsonb_object_keys(photo) as field where field not in ('id','title','category','description','image_url','is_published')) then raise exception 'invalid_gallery'; end if;
    if jsonb_typeof(photo->'id') is distinct from 'string' or (photo->>'id') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'invalid_gallery'; end if;
    if (photo->>'id')::uuid = any(photo_ids) then raise exception 'invalid_gallery'; end if;
    if jsonb_typeof(photo->'title') is distinct from 'string' or jsonb_typeof(photo->'category') is distinct from 'string'
      or jsonb_typeof(photo->'description') is distinct from 'string' or jsonb_typeof(photo->'image_url') is distinct from 'string'
      or jsonb_typeof(photo->'is_published') is distinct from 'boolean' then raise exception 'invalid_gallery'; end if;
    photo_ids := array_append(photo_ids, (photo->>'id')::uuid);
  end loop;
  if exists (select 1 from public.directory_gallery_photos where id = any(photo_ids) and profile_id <> target_profile) then raise exception 'invalid_gallery'; end if;
  candidate := jsonb_populate_record(current_profile, profile_changes);
  update public.directory_profiles set display_name=candidate.display_name, role_type=candidate.role_type,
    headline=candidate.headline, tagline=candidate.tagline, about=candidate.about,
    avatar_image=candidate.avatar_image, banner_image=candidate.banner_image, starting_rate=candidate.starting_rate,
    availability=candidate.availability, tags=candidate.tags, is_published=candidate.is_published,
    rate_categories=candidate.rate_categories, availability_note=candidate.availability_note, booking_hours=candidate.booking_hours,
    boundaries=candidate.boundaries, booking_instructions=candidate.booking_instructions
    where id = target_profile;
  delete from public.directory_gallery_photos where profile_id = target_profile and not (id = any(photo_ids));
  for photo in select value from jsonb_array_elements(photos) loop
    insert into public.directory_gallery_photos(id,profile_id,title,category,description,image_url,sort_order,is_published)
      values ((photo->>'id')::uuid,target_profile,photo->>'title',photo->>'category',photo->>'description',photo->>'image_url',position,(photo->>'is_published')::boolean)
      on conflict (id) do update set title=excluded.title,category=excluded.category,description=excluded.description,
        image_url=excluded.image_url,sort_order=excluded.sort_order,is_published=excluded.is_published
        where directory_gallery_photos.profile_id = target_profile;
    if not found then raise exception 'invalid_gallery'; end if;
    position := position + 1;
  end loop;
  return query select * from public.directory_profiles where id = target_profile;
end;
$$;
revoke all on function public.save_directory_profile_media(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.save_directory_profile_media(uuid,jsonb,jsonb) to authenticated, service_role;

commit;

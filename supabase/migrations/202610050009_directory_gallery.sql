begin;

create table public.directory_gallery_photos (
  id uuid primary key,
  profile_id uuid not null references public.directory_profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 100),
  category text not null default '' check (char_length(category) <= 100),
  description text not null default '' check (char_length(description) <= 2000),
  image_url text not null check (char_length(image_url) <= 2048 and image_url ~ '^(/[^/]|https://)[^[:space:]]+$'
    and position(chr(92) in image_url) = 0 and image_url !~ '^https://[^/?#]*@'),
  sort_order integer not null check (sort_order between 0 and 99),
  is_published boolean not null default false
);
create index directory_gallery_profile_order_idx on public.directory_gallery_photos(profile_id, sort_order, id);
alter table public.directory_gallery_photos enable row level security;
revoke all on public.directory_gallery_photos from public, anon, authenticated;
grant select on public.directory_gallery_photos to anon, authenticated;
grant all on public.directory_gallery_photos to service_role;

create policy gallery_public_read on public.directory_gallery_photos
for select to anon, authenticated
using (is_published and exists (select 1 from public.directory_profiles as profile
  where profile.id = profile_id and profile.is_approved and profile.is_published
    and cc_private.directory_profile_paid(profile.id)));
create policy gallery_owner_read on public.directory_gallery_photos
for select to authenticated using (cc_private.can_manage_directory_profile(profile_id));

create function public.save_directory_profile_media(target_profile uuid, profile_changes jsonb, photos jsonb)
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
    ('display_name','role_type','headline','tagline','about','avatar_image','banner_image','starting_rate','availability','tags','is_published','rate_categories','availability_note','booking_hours')) then raise exception 'invalid_profile_fields'; end if;
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
    rate_categories=candidate.rate_categories, availability_note=candidate.availability_note, booking_hours=candidate.booking_hours
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
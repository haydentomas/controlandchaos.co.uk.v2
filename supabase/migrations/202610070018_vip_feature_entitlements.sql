begin;

create function cc_private.directory_profile_is_vip(target_profile uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from cc_private.directory_subscriptions as subscription
    join cc_private.directory_plans as plan on plan.code = subscription.plan_code
    where subscription.profile_id = target_profile and plan.tier = 'vip'
      and subscription.suspended_at is null
      and (subscription.is_lifetime or subscription.expires_at > pg_catalog.now())
  );
$$;
revoke all on function cc_private.directory_profile_is_vip(uuid) from public;
grant execute on function cc_private.directory_profile_is_vip(uuid) to anon, authenticated, service_role;

create function cc_private.creator_blog_fan_has_access(target_profile uuid, target_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select target_user is not null and exists (
    select 1 from cc_private.creator_content_subscriptions as access
    join cc_private.verified_avatar_links as identity on identity.avatar_uuid = access.fan_avatar_uuid
    where access.creator_profile_id = target_profile and identity.user_id = target_user
      and identity.revoked_at is null and access.suspended_at is null
      and access.expires_at > pg_catalog.now()
  );
$$;
revoke all on function cc_private.creator_blog_fan_has_access(uuid, uuid) from public;
grant execute on function cc_private.creator_blog_fan_has_access(uuid, uuid) to anon, authenticated, service_role;

create function cc_private.directory_gallery_photo_publicly_visible(target_profile uuid, target_photo uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select cc_private.directory_profile_is_vip(target_profile)
    or exists (
      select 1 from (
        select photo.id from public.directory_gallery_photos as photo
        where photo.profile_id = target_profile and photo.is_published
        order by photo.sort_order, photo.id limit 4
      ) as basic_gallery where basic_gallery.id = target_photo
    );
$$;
revoke all on function cc_private.directory_gallery_photo_publicly_visible(uuid, uuid) from public;
grant execute on function cc_private.directory_gallery_photo_publicly_visible(uuid, uuid) to anon, authenticated, service_role;

create function cc_private.directory_gallery_photo_in_basic_set(target_profile uuid, target_photo uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.directory_gallery_photos as photo
    where photo.profile_id = target_profile and photo.id = target_photo and photo.sort_order < 4
  );
$$;
revoke all on function cc_private.directory_gallery_photo_in_basic_set(uuid, uuid) from public;
grant execute on function cc_private.directory_gallery_photo_in_basic_set(uuid, uuid) to anon, authenticated, service_role;

create or replace function cc_private.directory_gallery_photo_publicly_visible(target_profile uuid, target_photo uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select cc_private.directory_profile_is_vip(target_profile)
    or cc_private.directory_gallery_photo_in_basic_set(target_profile, target_photo);
$$;
revoke all on function cc_private.directory_gallery_photo_publicly_visible(uuid, uuid) from public;
grant execute on function cc_private.directory_gallery_photo_publicly_visible(uuid, uuid) to anon, authenticated, service_role;

create function cc_private.guard_basic_gallery_overflow()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare target_profile uuid; target_photo uuid;
begin
  target_profile := case when tg_op = 'DELETE' then old.profile_id else new.profile_id end;
  target_photo := case when tg_op = 'DELETE' then old.id else new.id end;
  if cc_private.directory_profile_is_vip(target_profile)
    or cc_private.directory_gallery_photo_in_basic_set(target_profile, target_photo) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and new is not distinct from old then return new; end if;
  raise exception 'vip_gallery_photo_required' using errcode = '42501';
end;
$$;
revoke all on function cc_private.guard_basic_gallery_overflow() from public, anon, authenticated;
create trigger directory_gallery_basic_overflow_guard
before update or delete on public.directory_gallery_photos
for each row execute function cc_private.guard_basic_gallery_overflow();

drop policy gallery_public_read on public.directory_gallery_photos;
create policy gallery_public_read on public.directory_gallery_photos
for select to anon, authenticated
using (is_published and exists (
  select 1 from public.directory_profiles as profile
  where profile.id = profile_id and profile.is_approved and profile.is_published
    and cc_private.directory_profile_paid(profile.id)
    and cc_private.directory_gallery_photo_publicly_visible(profile.id, directory_gallery_photos.id)
));

drop policy gallery_owner_read on public.directory_gallery_photos;
create policy gallery_owner_read on public.directory_gallery_photos
for select to authenticated
using (cc_private.can_manage_directory_profile(profile_id));

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
  image_url text;
  storage_path text;
  vip boolean;
begin
  if not cc_private.can_manage_directory_profile(target_profile) then raise exception 'profile_access_denied' using errcode = '42501'; end if;
  if jsonb_typeof(profile_changes) is distinct from 'object' or octet_length(profile_changes::text) > 524288 then raise exception 'invalid_profile_fields'; end if;
  if exists (select 1 from jsonb_object_keys(profile_changes) as field where field not in
    ('display_name','role_type','headline','tagline','about','avatar_image','banner_image','starting_rate','availability','tags','is_published','rate_categories','availability_note','booking_hours')) then raise exception 'invalid_profile_fields'; end if;
  if jsonb_typeof(photos) is distinct from 'array' then raise exception 'invalid_gallery'; end if;
  if jsonb_array_length(photos) > 20 or octet_length(photos::text) > 524288 then raise exception 'invalid_gallery'; end if;
  select * into current_profile from public.directory_profiles where id = target_profile for update;
  if not found or not cc_private.can_manage_directory_profile(target_profile) then raise exception 'profile_access_denied' using errcode = '42501'; end if;
  vip := cc_private.directory_profile_is_vip(target_profile);
  if not vip and jsonb_array_length(photos) > 4 then raise exception 'gallery_photo_limit' using errcode = '23514'; end if;
  for photo in select value from jsonb_array_elements(photos) loop
    if jsonb_typeof(photo) is distinct from 'object' then raise exception 'invalid_gallery'; end if;
    if exists (select 1 from jsonb_object_keys(photo) as field where field not in ('id','title','category','description','image_url','storage_path','is_published')) then raise exception 'invalid_gallery'; end if;
    if jsonb_typeof(photo->'id') is distinct from 'string' or (photo->>'id') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'invalid_gallery'; end if;
    if (photo->>'id')::uuid = any(photo_ids) then raise exception 'invalid_gallery'; end if;
    if jsonb_typeof(photo->'title') is distinct from 'string' or jsonb_typeof(photo->'category') is distinct from 'string'
      or jsonb_typeof(photo->'description') is distinct from 'string' or jsonb_typeof(photo->'image_url') is distinct from 'string'
      or jsonb_typeof(photo->'is_published') is distinct from 'boolean' then raise exception 'invalid_gallery'; end if;
    if photo ? 'storage_path' and jsonb_typeof(photo->'storage_path') is distinct from 'string' then raise exception 'invalid_gallery'; end if;
    if not vip and exists (
      select 1 from public.directory_gallery_photos as existing
      where existing.profile_id = target_profile and existing.id = (photo->>'id')::uuid
        and not cc_private.directory_gallery_photo_in_basic_set(target_profile, existing.id)
    ) then raise exception 'vip_gallery_photo_required' using errcode = '42501'; end if;
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
  delete from public.directory_gallery_photos as existing
    where existing.profile_id = target_profile
      and (vip or cc_private.directory_gallery_photo_in_basic_set(target_profile, existing.id))
      and not (existing.id = any(photo_ids));
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
revoke all on function public.save_directory_profile_media(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_directory_profile_media(uuid, jsonb, jsonb) to authenticated, service_role;

create or replace function cc_private.enforce_directory_gallery_limit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare photo_count integer; photo_limit integer;
begin
  if exists (select 1 from public.directory_gallery_photos as photo where photo.id = new.id and photo.profile_id = new.profile_id) then
    return new;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.profile_id::text, 12));
  select pg_catalog.count(*) into photo_count from public.directory_gallery_photos as photo
    where photo.profile_id = new.profile_id and photo.id <> new.id;
  photo_limit := case when cc_private.directory_profile_is_vip(new.profile_id) then 20 else 4 end;
  if photo_count >= photo_limit then raise exception 'gallery_photo_limit' using errcode = '23514'; end if;
  return new;
end;
$$;
revoke all on function cc_private.enforce_directory_gallery_limit() from public, anon, authenticated;

create or replace function cc_private.can_upload_directory_gallery_object(object_name text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare target_profile uuid; target_photo uuid; photo_count integer; pending_count integer; photo_limit integer;
begin
  if object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]webp$' then return false; end if;
  target_profile := pg_catalog.split_part(object_name, '/', 1)::uuid;
  target_photo := pg_catalog.split_part(object_name, '/', 2)::uuid;
  if not cc_private.can_manage_directory_profile(target_profile) then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_profile::text, 12));
  if exists (select 1 from storage.objects where bucket_id='directory-gallery' and name=object_name) then return false; end if;
  if exists (select 1 from public.directory_gallery_photos where profile_id=target_profile and id=target_photo) then
    return cc_private.directory_profile_is_vip(target_profile)
      or cc_private.directory_gallery_photo_in_basic_set(target_profile, target_photo);
  end if;
  photo_limit := case when cc_private.directory_profile_is_vip(target_profile) then 20 else 4 end;
  select pg_catalog.count(*) into photo_count from public.directory_gallery_photos where profile_id=target_profile;
  select pg_catalog.count(*) into pending_count from storage.objects as stored
    where stored.bucket_id='directory-gallery' and pg_catalog.split_part(stored.name, '/', 1)=target_profile::text
      and not exists (select 1 from public.directory_gallery_photos as photo where photo.storage_path=stored.name);
  return photo_count + pending_count < photo_limit;
end;
$$;
revoke all on function cc_private.can_upload_directory_gallery_object(text) from public, anon;
grant execute on function cc_private.can_upload_directory_gallery_object(text) to authenticated, service_role;

drop policy directory_gallery_public_read on storage.objects;
create policy directory_gallery_public_read on storage.objects
for select to anon, authenticated
using (bucket_id = 'directory-gallery' and exists (
  select 1 from public.directory_gallery_photos as photo
  join public.directory_profiles as profile on profile.id = photo.profile_id
  where photo.storage_path = name and photo.is_published
    and profile.is_approved and profile.is_published
    and cc_private.directory_profile_paid(profile.id)
    and cc_private.directory_gallery_photo_publicly_visible(profile.id, photo.id)
));

drop policy directory_gallery_owner_read on storage.objects;
create policy directory_gallery_owner_read on storage.objects
for select to authenticated
using (
  bucket_id = 'directory-gallery'
  and exists (select 1 from public.directory_profiles as profile
    where profile.id::text = pg_catalog.split_part(name, '/', 1)
      and cc_private.can_manage_directory_profile(profile.id))
);

drop policy directory_gallery_owner_update on storage.objects;
create policy directory_gallery_owner_update on storage.objects
for update to authenticated
using (
  bucket_id = 'directory-gallery'
  and exists (select 1 from public.directory_profiles as profile
    where profile.id::text = pg_catalog.split_part(name, '/', 1)
      and cc_private.can_manage_directory_profile(profile.id)
      and (cc_private.directory_profile_is_vip(profile.id)
        or cc_private.directory_gallery_photo_in_basic_set(profile.id, pg_catalog.split_part(name, '/', 2)::uuid)))
)
with check (
  bucket_id = 'directory-gallery'
  and exists (select 1 from public.directory_profiles as profile
    where profile.id::text = pg_catalog.split_part(name, '/', 1)
      and cc_private.can_manage_directory_profile(profile.id)
      and (cc_private.directory_profile_is_vip(profile.id)
        or cc_private.directory_gallery_photo_in_basic_set(profile.id, pg_catalog.split_part(name, '/', 2)::uuid)))
);

create function cc_private.guard_vip_creator_profile()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
    and new.creator_blog_monthly_linden > 0
    and not cc_private.directory_profile_is_vip(new.id) then
    raise exception 'vip_creator_blog_required' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function cc_private.guard_vip_creator_profile() from public, anon, authenticated;
create trigger directory_profile_vip_creator_offer
before insert or update of creator_blog_monthly_linden on public.directory_profiles
for each row execute function cc_private.guard_vip_creator_profile();

create function cc_private.guard_vip_creator_blog_post()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare target_profile uuid;
begin
  target_profile := case when tg_op = 'DELETE' then old.profile_id else new.profile_id end;
  if (select auth.uid()) is not null
    and not cc_private.directory_profile_is_vip(target_profile) then
    raise exception 'vip_creator_blog_required' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function cc_private.guard_vip_creator_blog_post() from public, anon, authenticated;
create trigger creator_blog_posts_vip_only
before insert or update or delete on public.creator_blog_posts
for each row execute function cc_private.guard_vip_creator_blog_post();

create function cc_private.guard_vip_creator_blog_content()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare target_profile uuid;
begin
  if (select auth.uid()) is not null then
    select post.profile_id into target_profile from public.creator_blog_posts as post
    where post.id = case when tg_op = 'DELETE' then old.post_id else new.post_id end;
    if target_profile is not null
      and not cc_private.directory_profile_is_vip(target_profile)
      then
      raise exception 'vip_creator_blog_required' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function cc_private.guard_vip_creator_blog_content() from public, anon, authenticated;
create trigger creator_blog_content_vip_only
before insert or update or delete on cc_private.creator_blog_post_content
for each row execute function cc_private.guard_vip_creator_blog_content();

create or replace function cc_private.can_upload_creator_blog_media(object_name text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare target_profile uuid;
begin
  if object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](webp|mp3|m4a|mp4|webm)$' then return false; end if;
  target_profile := pg_catalog.split_part(object_name, '/', 1)::uuid;
  return cc_private.can_manage_directory_profile(target_profile) and cc_private.directory_profile_is_vip(target_profile);
end;
$$;
revoke all on function cc_private.can_upload_creator_blog_media(text) from public, anon;
grant execute on function cc_private.can_upload_creator_blog_media(text) to authenticated, service_role;

create or replace function cc_private.can_read_creator_blog_media(object_name text, target_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from cc_private.creator_blog_post_content as content
    join public.creator_blog_posts as post on post.id = content.post_id
    join public.directory_profiles as profile on profile.id = post.profile_id
    where exists (
      select 1 from jsonb_array_elements(cc_private.creator_blog_attachments(content)) as item
      where item->>'media_path' = object_name
    )
      and post.is_published and profile.is_approved and profile.is_published
      and cc_private.directory_profile_paid(profile.id)
      and (cc_private.directory_profile_is_vip(profile.id)
        or cc_private.creator_blog_fan_has_access(profile.id, target_user))
      and (post.access_level = 'public'
        or cc_private.creator_blog_fan_has_access(profile.id, target_user))
  );
$$;
revoke all on function cc_private.can_read_creator_blog_media(text, uuid) from public;
grant execute on function cc_private.can_read_creator_blog_media(text, uuid) to anon, authenticated, service_role;

drop function public.creator_blog_public_offer(uuid);
create function public.creator_blog_public_offer(target_profile uuid)
returns table (
  creator_avatar_uuid uuid,
  monthly_price_linden integer,
  benefits text,
  terminal_slurl text,
  viewer_is_subscribed boolean,
  creator_is_vip boolean
)
language sql stable security definer set search_path = ''
as $$
  select owner.avatar_uuid,
    case when cc_private.directory_profile_is_vip(profile.id) then profile.creator_blog_monthly_linden else 0 end,
    case when cc_private.directory_profile_is_vip(profile.id) then profile.creator_blog_benefits else '' end,
    case when cc_private.directory_profile_is_vip(profile.id) then settings.terminal_slurl else '' end,
    cc_private.creator_blog_fan_has_access(profile.id, (select auth.uid())),
    cc_private.directory_profile_is_vip(profile.id)
  from public.directory_profiles as profile
  join cc_private.profile_owners as owner on owner.profile_id = profile.id
  join cc_private.verified_avatar_links as identity
    on identity.avatar_uuid = owner.avatar_uuid and identity.user_id = owner.user_id
  cross join cc_private.creator_blog_terminal_settings as settings
  where profile.id = target_profile and identity.revoked_at is null
    and profile.is_approved and profile.is_published and cc_private.directory_profile_paid(profile.id);
$$;
revoke all on function public.creator_blog_public_offer(uuid) from public;
grant execute on function public.creator_blog_public_offer(uuid) to anon, authenticated, service_role;

create or replace function public.creator_blog_offer_for_terminal(target_creator_avatar uuid)
returns table (profile_id uuid, creator_avatar_uuid uuid, creator_name text, monthly_price_linden integer)
language sql stable security definer set search_path = ''
as $$
  select profile.id, identity.avatar_uuid, profile.display_name, profile.creator_blog_monthly_linden
  from public.directory_profiles as profile
  join cc_private.profile_owners as owner on owner.profile_id = profile.id
  join cc_private.verified_avatar_links as identity
    on identity.avatar_uuid = owner.avatar_uuid and identity.user_id = owner.user_id
  where identity.avatar_uuid = target_creator_avatar and identity.revoked_at is null
    and profile.is_approved and profile.is_published and cc_private.directory_profile_paid(profile.id)
    and cc_private.directory_profile_is_vip(profile.id) and profile.creator_blog_monthly_linden > 0
  limit 1;
$$;
revoke all on function public.creator_blog_offer_for_terminal(uuid) from public, anon, authenticated;
grant execute on function public.creator_blog_offer_for_terminal(uuid) to service_role;

create or replace function public.creator_blog_prepare_payment(payment_reference uuid, payer_avatar uuid, target_creator_avatar uuid, paid_linden integer)
returns table (creator_profile_id uuid, creator_avatar_uuid uuid, amount_linden integer, payment_state text)
language plpgsql security definer set search_path = ''
as $$
declare previous cc_private.creator_content_payments%rowtype; target_profile uuid; expected_price integer;
begin
  if payment_reference is null or payer_avatar is null
    or payer_avatar = '00000000-0000-0000-0000-000000000000'::uuid
    or target_creator_avatar is null or payer_avatar = target_creator_avatar then
    raise exception 'invalid_creator_payment';
  end if;
  if not exists (select 1 from cc_private.verified_avatar_links where avatar_uuid = payer_avatar and revoked_at is null) then
    raise exception 'fan_avatar_not_verified';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(payment_reference::text, 14));
  select * into previous from cc_private.creator_content_payments where payment_id = payment_reference for update;
  if found then
    if previous.fan_avatar_uuid <> payer_avatar or previous.creator_avatar_uuid <> target_creator_avatar
      or previous.amount_linden <> paid_linden then raise exception 'creator_payment_reference_conflict'; end if;
    return query select previous.creator_profile_id, previous.creator_avatar_uuid, previous.amount_linden, previous.payment_state;
    return;
  end if;
  select profile.id, profile.creator_blog_monthly_linden into target_profile, expected_price
  from public.directory_profiles as profile
  join cc_private.profile_owners as owner on owner.profile_id = profile.id
  join cc_private.verified_avatar_links as identity
    on identity.avatar_uuid = owner.avatar_uuid and identity.user_id = owner.user_id
  where identity.avatar_uuid = target_creator_avatar and identity.revoked_at is null
    and profile.is_approved and profile.is_published and cc_private.directory_profile_paid(profile.id)
    and cc_private.directory_profile_is_vip(profile.id)
  limit 1;
  if target_profile is null or expected_price is null or expected_price <= 0
    or paid_linden is distinct from expected_price then raise exception 'invalid_creator_payment_amount'; end if;
  insert into cc_private.creator_content_payments(payment_id, fan_avatar_uuid, creator_avatar_uuid, creator_profile_id, amount_linden)
    values (payment_reference, payer_avatar, target_creator_avatar, target_profile, paid_linden);
  return query select target_profile, target_creator_avatar, paid_linden, 'prepared'::text;
end;
$$;
revoke all on function public.creator_blog_prepare_payment(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.creator_blog_prepare_payment(uuid, uuid, uuid, integer) to service_role;

create or replace function public.creator_blog_feed(target_profile uuid)
returns table (
  id uuid, post_type text, access_level text, title text, tag text, teaser text,
  body_markdown text, media_type text, media_path text, media_url text,
  is_locked boolean, published_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select post.id, post.post_type, post.access_level, post.title, post.tag, post.teaser,
    case when post.access_level = 'public' or cc_private.creator_blog_user_has_access(profile.id, (select auth.uid())) then content.body_markdown else null end,
    case when post.access_level = 'public' or cc_private.creator_blog_user_has_access(profile.id, (select auth.uid())) then content.media_type else null end,
    case when post.access_level = 'public' or cc_private.creator_blog_user_has_access(profile.id, (select auth.uid())) then content.media_path else null end,
    case when post.access_level = 'public' or cc_private.creator_blog_user_has_access(profile.id, (select auth.uid())) then content.media_url else null end,
    post.access_level = 'subscribers' and not cc_private.creator_blog_user_has_access(profile.id, (select auth.uid())),
    post.published_at
  from public.creator_blog_posts as post
  join public.directory_profiles as profile on profile.id = post.profile_id
  join cc_private.creator_blog_post_content as content on content.post_id = post.id
  where post.profile_id = target_profile and post.is_published
    and profile.is_approved and profile.is_published and cc_private.directory_profile_paid(profile.id)
    and (cc_private.directory_profile_is_vip(profile.id)
      or cc_private.creator_blog_fan_has_access(profile.id, (select auth.uid())))
  order by post.published_at desc, post.sort_order, post.id limit 100;
$$;
revoke all on function public.creator_blog_feed(uuid) from public;
grant execute on function public.creator_blog_feed(uuid) to anon, authenticated, service_role;

create or replace function public.creator_blog_feed_v2(target_profile uuid)
returns table (
  id uuid, post_type text, access_level text, title text, tag text, teaser text,
  body_markdown text, media_type text, media_path text, media_url text,
  is_locked boolean, published_at timestamptz, attachments jsonb
)
language sql stable security definer set search_path = ''
as $$
  select post.*,
    case when post.is_locked then null else cc_private.creator_blog_attachments(content) end
  from public.creator_blog_feed(target_profile) as post
  join cc_private.creator_blog_post_content as content on content.post_id = post.id
  join public.creator_blog_posts as metadata on metadata.id = post.id
  join public.directory_profiles as profile on profile.id = metadata.profile_id
  where cc_private.directory_profile_is_vip(profile.id)
    or cc_private.creator_blog_fan_has_access(profile.id, (select auth.uid()))
  order by post.published_at desc, metadata.sort_order, post.id;
$$;
revoke all on function public.creator_blog_feed_v2(uuid) from public;
grant execute on function public.creator_blog_feed_v2(uuid) to anon, authenticated, service_role;

commit;
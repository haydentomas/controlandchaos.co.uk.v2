begin;

alter table public.directory_profiles
  add column creator_blog_monthly_linden integer not null default 0
    check (creator_blog_monthly_linden between 0 and 1000000),
  add column creator_blog_benefits text not null default ''
    check (char_length(creator_blog_benefits) <= 1000);
grant update (creator_blog_monthly_linden, creator_blog_benefits) on public.directory_profiles to authenticated;

create table public.creator_blog_posts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.directory_profiles(id) on delete cascade,
  legacy_id text not null default '' check (char_length(legacy_id) <= 100),
  post_type text not null check (post_type in ('post', 'live_update')),
  access_level text not null check (access_level in ('public', 'subscribers')),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  tag text not null default '' check (char_length(tag) <= 60),
  teaser text not null default '' check (char_length(teaser) <= 1000),
  is_published boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);
create index creator_blog_posts_feed_idx on public.creator_blog_posts(profile_id, is_published, published_at desc, sort_order);
create unique index creator_blog_posts_legacy_key_idx on public.creator_blog_posts(profile_id, legacy_id) where legacy_id <> '';
alter table public.creator_blog_posts enable row level security;
revoke all on public.creator_blog_posts from public, anon, authenticated;
grant all on public.creator_blog_posts to service_role;

create table cc_private.creator_blog_post_content (
  post_id uuid primary key references public.creator_blog_posts(id) on delete cascade,
  body_markdown text not null default '' check (char_length(body_markdown) <= 30000),
  media_type text not null default 'text' check (media_type in ('text', 'image', 'audio', 'video')),
  media_path text not null default '',
  media_url text not null default '' check (char_length(media_url) <= 2048),
  check (media_path = '' or media_url = '')
);
alter table cc_private.creator_blog_post_content enable row level security;
revoke all on cc_private.creator_blog_post_content from public, anon, authenticated;
grant all on cc_private.creator_blog_post_content to service_role;

create table cc_private.creator_content_subscriptions (
  fan_avatar_uuid uuid not null check (fan_avatar_uuid <> '00000000-0000-0000-0000-000000000000'),
  creator_profile_id uuid not null references public.directory_profiles(id) on delete cascade,
  creator_avatar_uuid uuid not null references cc_private.verified_avatar_links(avatar_uuid),
  expires_at timestamptz not null,
  suspended_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (fan_avatar_uuid, creator_profile_id),
  check (fan_avatar_uuid <> creator_avatar_uuid)
);
create index creator_content_subscriptions_creator_idx on cc_private.creator_content_subscriptions(creator_profile_id, expires_at) where suspended_at is null;
alter table cc_private.creator_content_subscriptions enable row level security;
revoke all on cc_private.creator_content_subscriptions from public, anon, authenticated;
grant all on cc_private.creator_content_subscriptions to service_role;

create table cc_private.creator_content_payments (
  payment_id uuid primary key,
  fan_avatar_uuid uuid not null check (fan_avatar_uuid <> '00000000-0000-0000-0000-000000000000'),
  creator_avatar_uuid uuid not null references cc_private.verified_avatar_links(avatar_uuid),
  creator_profile_id uuid not null references public.directory_profiles(id),
  amount_linden integer not null check (amount_linden between 1 and 2147483647),
  payment_state text not null default 'prepared' check (payment_state in ('prepared', 'forwarding', 'refund_pending', 'paid', 'cancelled')),
  received_at timestamptz not null default now(),
  paid_at timestamptz,
  subscription_expires_at timestamptz,
  check (fan_avatar_uuid <> creator_avatar_uuid)
);
alter table cc_private.creator_content_payments enable row level security;
revoke all on cc_private.creator_content_payments from public, anon, authenticated;
grant all on cc_private.creator_content_payments to service_role;

create table cc_private.creator_blog_terminal_settings (
  singleton boolean primary key default true check (singleton),
  terminal_slurl text not null default '' check (terminal_slurl = '' or terminal_slurl ~ '^secondlife://[^[:space:]]+$'),
  updated_at timestamptz not null default now()
);
alter table cc_private.creator_blog_terminal_settings enable row level security;
revoke all on cc_private.creator_blog_terminal_settings from public, anon, authenticated;
grant all on cc_private.creator_blog_terminal_settings to service_role;
insert into cc_private.creator_blog_terminal_settings(singleton, terminal_slurl) values (true, '') on conflict (singleton) do nothing;

create function cc_private.creator_blog_user_has_access(target_profile uuid, target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user is not null and (
    cc_private.can_manage_directory_profile(target_profile)
    or exists (
      select 1
      from cc_private.creator_content_subscriptions as access
      join cc_private.verified_avatar_links as identity
        on identity.avatar_uuid = access.fan_avatar_uuid
      where access.creator_profile_id = target_profile
        and identity.user_id = target_user
        and identity.revoked_at is null
        and access.suspended_at is null
        and access.expires_at > pg_catalog.now()
    )
  );
$$;
revoke all on function cc_private.creator_blog_user_has_access(uuid, uuid) from public;
grant execute on function cc_private.creator_blog_user_has_access(uuid, uuid) to anon, authenticated, service_role;

create function cc_private.can_upload_creator_blog_media(object_name text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare target_profile uuid;
begin
  if object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](webp|mp3|m4a|mp4|webm)$' then return false; end if;
  target_profile := split_part(object_name, '/', 1)::uuid;
  return cc_private.can_manage_directory_profile(target_profile);
end;
$$;
revoke all on function cc_private.can_upload_creator_blog_media(text) from public, anon;
grant execute on function cc_private.can_upload_creator_blog_media(text) to authenticated, service_role;

create function cc_private.can_read_creator_blog_media(object_name text, target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from cc_private.creator_blog_post_content as content
    join public.creator_blog_posts as post on post.id = content.post_id
    join public.directory_profiles as profile on profile.id = post.profile_id
    where content.media_path = object_name
      and post.is_published
      and profile.is_approved and profile.is_published
      and cc_private.directory_profile_paid(profile.id)
      and (post.access_level = 'public' or cc_private.creator_blog_user_has_access(profile.id, target_user))
  );
$$;
revoke all on function cc_private.can_read_creator_blog_media(text, uuid) from public;
grant execute on function cc_private.can_read_creator_blog_media(text, uuid) to anon, authenticated, service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('creator-blog-media', 'creator-blog-media', false, 26214400, array['image/webp','audio/mpeg','audio/mp4','audio/aac','video/mp4','video/webm'])
on conflict (id) do update set public = false, file_size_limit = 26214400, allowed_mime_types = array['image/webp','audio/mpeg','audio/mp4','audio/aac','video/mp4','video/webm'];

create policy creator_blog_media_owner_upload on storage.objects
for insert to authenticated
with check (bucket_id = 'creator-blog-media' and cc_private.can_upload_creator_blog_media(name));
create policy creator_blog_media_owner_read on storage.objects
for select to authenticated
using (bucket_id = 'creator-blog-media' and exists (
  select 1 from public.directory_profiles as profile
  where profile.id::text = split_part(name, '/', 1)
    and cc_private.can_manage_directory_profile(profile.id)
));
create policy creator_blog_media_content_read on storage.objects
for select to anon, authenticated
using (bucket_id = 'creator-blog-media' and cc_private.can_read_creator_blog_media(name, (select auth.uid())));
create policy creator_blog_media_owner_delete on storage.objects
for delete to authenticated
using (bucket_id = 'creator-blog-media' and cc_private.can_upload_creator_blog_media(name));

create function public.creator_blog_public_offer(target_profile uuid)
returns table (creator_avatar_uuid uuid, monthly_price_linden integer, benefits text, terminal_slurl text, viewer_is_subscribed boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select owner.avatar_uuid, profile.creator_blog_monthly_linden, profile.creator_blog_benefits,
    settings.terminal_slurl, cc_private.creator_blog_user_has_access(profile.id, (select auth.uid()))
  from public.directory_profiles as profile
  join cc_private.profile_owners as owner on owner.profile_id = profile.id
  join cc_private.verified_avatar_links as identity on identity.avatar_uuid = owner.avatar_uuid and identity.user_id = owner.user_id
  cross join cc_private.creator_blog_terminal_settings as settings
  where profile.id = target_profile and identity.revoked_at is null
    and profile.is_approved and profile.is_published and cc_private.directory_profile_paid(profile.id);
$$;
revoke all on function public.creator_blog_public_offer(uuid) from public;
grant execute on function public.creator_blog_public_offer(uuid) to anon, authenticated, service_role;

create function public.creator_blog_offer_for_terminal(target_creator_avatar uuid)
returns table (profile_id uuid, creator_avatar_uuid uuid, creator_name text, monthly_price_linden integer)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id, identity.avatar_uuid, profile.display_name, profile.creator_blog_monthly_linden
  from public.directory_profiles as profile
  join cc_private.profile_owners as owner on owner.profile_id = profile.id
  join cc_private.verified_avatar_links as identity on identity.avatar_uuid = owner.avatar_uuid and identity.user_id = owner.user_id
  where identity.avatar_uuid = target_creator_avatar and identity.revoked_at is null
    and profile.is_approved and profile.is_published and profile.creator_blog_monthly_linden > 0
    and cc_private.directory_profile_paid(profile.id)
  limit 1;
$$;
revoke all on function public.creator_blog_offer_for_terminal(uuid) from public, anon, authenticated;
grant execute on function public.creator_blog_offer_for_terminal(uuid) to service_role;

create function public.creator_blog_set_offer(target_profile uuid, monthly_price integer, benefits text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not cc_private.can_manage_directory_profile(target_profile) then raise exception 'profile_access_denied' using errcode = '42501'; end if;
  if monthly_price is null or monthly_price < 0 or monthly_price > 1000000 then raise exception 'invalid_creator_blog_price'; end if;
  if benefits is null or char_length(benefits) > 1000 then raise exception 'invalid_creator_blog_benefits'; end if;
  update public.directory_profiles set creator_blog_monthly_linden=monthly_price, creator_blog_benefits=benefits where id=target_profile;
end;
$$;
revoke all on function public.creator_blog_set_offer(uuid, integer, text) from public, anon;
grant execute on function public.creator_blog_set_offer(uuid, integer, text) to authenticated, service_role;

create function public.creator_blog_set_terminal(terminal_slurl text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if terminal_slurl is null or char_length(terminal_slurl) > 2048 or (terminal_slurl <> '' and terminal_slurl !~ '^secondlife://[^[:space:]]+$') then raise exception 'invalid_creator_blog_terminal'; end if;
  insert into cc_private.creator_blog_terminal_settings(singleton, terminal_slurl, updated_at) values (true, terminal_slurl, pg_catalog.now())
  on conflict (singleton) do update set terminal_slurl=excluded.terminal_slurl, updated_at=pg_catalog.now();
end;
$$;
revoke all on function public.creator_blog_set_terminal(text) from public, anon, authenticated;
grant execute on function public.creator_blog_set_terminal(text) to service_role;

create function public.creator_blog_editor_posts(target_profile uuid)
returns table (
  id uuid, legacy_id text, post_type text, access_level text, title text, tag text, teaser text,
  body_markdown text, media_type text, media_path text, media_url text, is_published boolean,
  sort_order integer, created_at timestamptz, published_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not cc_private.can_manage_directory_profile(target_profile) then raise exception 'profile_access_denied' using errcode = '42501'; end if;
  return query select post.id, post.legacy_id, post.post_type, post.access_level, post.title, post.tag, post.teaser,
    content.body_markdown, content.media_type, content.media_path, content.media_url, post.is_published, post.sort_order, post.created_at, post.published_at
  from public.creator_blog_posts as post join cc_private.creator_blog_post_content as content on content.post_id=post.id
  where post.profile_id=target_profile order by post.sort_order, post.created_at desc, post.id;
end;
$$;
revoke all on function public.creator_blog_editor_posts(uuid) from public, anon;
grant execute on function public.creator_blog_editor_posts(uuid) to authenticated, service_role;

create function public.creator_blog_save_post(target_profile uuid, post_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
  existing_profile uuid;
  post_type_value text;
  access_value text;
  title_value text;
  tag_value text;
  teaser_value text;
  body_value text;
  media_type_value text;
  media_path_value text;
  media_url_value text;
  publish_value boolean;
  legacy_value text;
begin
  if not cc_private.can_manage_directory_profile(target_profile) then raise exception 'profile_access_denied' using errcode = '42501'; end if;
  if jsonb_typeof(post_data) is distinct from 'object' or octet_length(post_data::text) > 65536 then raise exception 'invalid_creator_post'; end if;
  if exists (select 1 from jsonb_object_keys(post_data) as field where field not in ('id','legacy_id','post_type','access_level','title','tag','teaser','body_markdown','media_type','media_path','media_url','is_published','sort_order')) then raise exception 'invalid_creator_post'; end if;
  if post_data ? 'id' and (jsonb_typeof(post_data->'id') is distinct from 'string' or post_data->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'invalid_creator_post'; end if;
  target_id := coalesce((post_data->>'id')::uuid, gen_random_uuid());
  select profile_id into existing_profile from public.creator_blog_posts where id=target_id;
  if found and existing_profile<>target_profile then raise exception 'invalid_creator_post'; end if;
  post_type_value := post_data->>'post_type';
  access_value := post_data->>'access_level';
  title_value := btrim(post_data->>'title');
  tag_value := coalesce(post_data->>'tag','');
  teaser_value := coalesce(post_data->>'teaser','');
  body_value := coalesce(post_data->>'body_markdown','');
  media_type_value := coalesce(post_data->>'media_type','text');
  media_path_value := coalesce(post_data->>'media_path','');
  media_url_value := coalesce(post_data->>'media_url','');
  publish_value := coalesce((post_data->>'is_published')::boolean,false);
  legacy_value := coalesce(post_data->>'legacy_id','');
  if post_type_value not in ('post','live_update') or access_value not in ('public','subscribers') then raise exception 'invalid_creator_post'; end if;
  if title_value is null or char_length(title_value) not between 1 and 160 or char_length(tag_value)>60 or char_length(teaser_value)>1000 or char_length(body_value)>30000 or char_length(legacy_value)>100 then raise exception 'invalid_creator_post'; end if;
  if media_type_value not in ('text','image','audio','video') or char_length(media_url_value)>2048 then raise exception 'invalid_creator_post'; end if;
  if media_url_value<>'' and (media_path_value<>'' or media_url_value !~ '^https://[^[:space:]]+$' or media_url_value ~ '^https://[^/?#]*@') then raise exception 'invalid_creator_post'; end if;
  if access_value='subscribers' and media_url_value<>'' then raise exception 'locked_media_requires_private_storage'; end if;
  if media_path_value<>'' and media_path_value !~ ('^'||target_profile::text||'/'||target_id::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](webp|mp3|m4a|mp4|webm)$') then raise exception 'invalid_creator_post'; end if;
  if access_value='subscribers' and publish_value and teaser_value='' then raise exception 'locked_post_requires_teaser'; end if;
  insert into public.creator_blog_posts(id,profile_id,legacy_id,post_type,access_level,title,tag,teaser,is_published,sort_order,published_at)
    values(target_id,target_profile,legacy_value,post_type_value,access_value,title_value,tag_value,teaser_value,publish_value,coalesce((post_data->>'sort_order')::integer,0),case when publish_value then now() else null end)
    on conflict(id) do update set legacy_id=excluded.legacy_id,post_type=excluded.post_type,access_level=excluded.access_level,title=excluded.title,
      tag=excluded.tag,teaser=excluded.teaser,is_published=excluded.is_published,sort_order=excluded.sort_order,
      published_at=case when excluded.is_published then coalesce(creator_blog_posts.published_at,now()) else null end,updated_at=now()
    where creator_blog_posts.profile_id=target_profile;
  if not found then raise exception 'invalid_creator_post'; end if;
  insert into cc_private.creator_blog_post_content(post_id,body_markdown,media_type,media_path,media_url)
    values(target_id,body_value,media_type_value,media_path_value,media_url_value)
    on conflict(post_id) do update set body_markdown=excluded.body_markdown,media_type=excluded.media_type,media_path=excluded.media_path,media_url=excluded.media_url;
  return target_id;
end;
$$;
revoke all on function public.creator_blog_save_post(uuid, jsonb) from public, anon;
grant execute on function public.creator_blog_save_post(uuid, jsonb) to authenticated, service_role;

create function public.creator_blog_save_posts(target_profile uuid, posts jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare post_data jsonb; saved_ids uuid[] := '{}';
begin
  if not cc_private.can_manage_directory_profile(target_profile) then raise exception 'profile_access_denied' using errcode = '42501'; end if;
  if jsonb_typeof(posts) is distinct from 'array' or jsonb_array_length(posts)>100 or octet_length(posts::text)>1048576 then raise exception 'invalid_creator_posts'; end if;
  perform 1 from public.directory_profiles where id=target_profile for update;
  for post_data in select value from jsonb_array_elements(posts) loop saved_ids := array_append(saved_ids, public.creator_blog_save_post(target_profile, post_data)); end loop;
  delete from public.creator_blog_posts where profile_id=target_profile and not (id=any(saved_ids));
end;
$$;
revoke all on function public.creator_blog_save_posts(uuid, jsonb) from public, anon;
grant execute on function public.creator_blog_save_posts(uuid, jsonb) to authenticated, service_role;

create function public.creator_blog_save_all(target_profile uuid, monthly_price integer, benefits text, posts jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not cc_private.can_manage_directory_profile(target_profile) then raise exception 'profile_access_denied' using errcode = '42501'; end if;
  perform public.creator_blog_set_offer(target_profile,monthly_price,benefits);
  perform public.creator_blog_save_posts(target_profile,posts);
end;
$$;
revoke all on function public.creator_blog_save_all(uuid, integer, text, jsonb) from public, anon;
grant execute on function public.creator_blog_save_all(uuid, integer, text, jsonb) to authenticated, service_role;

create function public.creator_blog_import_legacy(target_creator_avatar uuid, legacy_profile jsonb)
returns table (creator_profile_id uuid, imported_posts integer, locked_media_reupload integer, monthly_price_linden integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_profile uuid;
  monthly_price integer;
  benefits text;
  item record;
  imported_post_id uuid;
  legacy_key text;
  post_type_value text;
  access_value text;
  title_value text;
  tag_value text;
  teaser_value text;
  body_value text;
  media_type_value text;
  media_path_value text;
  media_url_value text;
  locked_value boolean;
  imported_count integer := 0;
  locked_media_count integer := 0;
begin
  if target_creator_avatar is null or target_creator_avatar='00000000-0000-0000-0000-000000000000'::uuid then raise exception 'invalid_legacy_creator'; end if;
  if jsonb_typeof(legacy_profile) is distinct from 'object' or octet_length(legacy_profile::text)>1048576 then raise exception 'invalid_legacy_profile'; end if;
  if jsonb_typeof(coalesce(legacy_profile->'posts','[]'::jsonb)) is distinct from 'array'
    or jsonb_typeof(coalesce(legacy_profile->'blog_posts','[]'::jsonb)) is distinct from 'array'
    or jsonb_array_length(coalesce(legacy_profile->'posts','[]'::jsonb))+jsonb_array_length(coalesce(legacy_profile->'blog_posts','[]'::jsonb))>100 then raise exception 'invalid_legacy_posts'; end if;
  select profile.id into target_profile
  from public.directory_profiles as profile
  join cc_private.profile_owners as owner on owner.profile_id=profile.id
  join cc_private.verified_avatar_links as identity on identity.avatar_uuid=owner.avatar_uuid and identity.user_id=owner.user_id
  where identity.avatar_uuid=target_creator_avatar and identity.revoked_at is null;
  if target_profile is null then raise exception 'legacy_creator_not_linked'; end if;
  monthly_price := coalesce(nullif(regexp_replace(coalesce(legacy_profile->>'fan_tier_price',''), '[^0-9]', '', 'g'), '')::integer, 0);
  if monthly_price>1000000 then monthly_price:=0; end if;
  benefits := left(coalesce(legacy_profile->>'fan_tier_desc',''),1000);
  update public.directory_profiles set creator_blog_monthly_linden=monthly_price,creator_blog_benefits=benefits where id=target_profile;
  for item in
    select 'feed'::text as source, value as post_data, ordinality::integer as position
      from jsonb_array_elements(coalesce(legacy_profile->'posts','[]'::jsonb)) with ordinality
    union all
    select 'blog'::text as source, value as post_data, ordinality::integer as position
      from jsonb_array_elements(coalesce(legacy_profile->'blog_posts','[]'::jsonb)) with ordinality
    order by source,position
  loop
    if jsonb_typeof(item.post_data) is distinct from 'object' then raise exception 'invalid_legacy_posts'; end if;
    legacy_key := left(item.source||':'||coalesce(nullif(item.post_data->>'id',''),item.position::text),100);
    title_value := left(coalesce(nullif(btrim(item.post_data->>'title'),''),'Update '||item.position::text),160);
    tag_value := left(coalesce(item.post_data->>'tag',''),60);
    body_value := left(coalesce(item.post_data->>'content',''),30000);
    locked_value := item.source='feed' and coalesce((item.post_data->>'is_locked')::boolean,false);
    access_value := case when locked_value then 'subscribers' else 'public' end;
    post_type_value := case when coalesce(item.post_data->>'post_type','')='live_update' then 'live_update' else 'post' end;
    media_url_value := coalesce(item.post_data->>'media_url','');
    media_type_value := case when item.post_data->>'type' in ('image','audio','video') then item.post_data->>'type'
      when media_url_value ~* '\\.(mp3|m4a|wav|ogg)(\\?|$)' then 'audio'
      when media_url_value ~* '\\.(mp4|webm)(\\?|$)' then 'video'
      when media_url_value<>'' then 'image' else 'text' end;
    media_path_value := '';
    if locked_value then
      if media_url_value<>'' then locked_media_count:=locked_media_count+1; end if;
      media_url_value:='';
      teaser_value:=left(coalesce(nullif(btrim(item.post_data->>'teaser'),''),'Subscriber-only post. Re-upload private media in V2.'),1000);
    else
      teaser_value:=left(coalesce(item.post_data->>'teaser',''),1000);
      if media_url_value !~ '^https://[^[:space:]]+$' or media_url_value ~ '^https://[^/?#]*@' then media_url_value:=''; end if;
    end if;
    insert into public.creator_blog_posts(profile_id,legacy_id,post_type,access_level,title,tag,teaser,is_published,sort_order,published_at)
      values(target_profile,legacy_key,post_type_value,access_value,title_value,tag_value,teaser_value,
        coalesce((legacy_profile->>'published')::boolean,true),-item.position,now()-(imported_count*interval '1 second'))
      on conflict(profile_id,legacy_id) where legacy_id<>'' do update set post_type=excluded.post_type,access_level=excluded.access_level,
        title=excluded.title,tag=excluded.tag,teaser=excluded.teaser,is_published=excluded.is_published,sort_order=excluded.sort_order,updated_at=now()
      returning id into imported_post_id;
    insert into cc_private.creator_blog_post_content(post_id,body_markdown,media_type,media_path,media_url)
      values(imported_post_id,body_value,media_type_value,media_path_value,media_url_value)
      on conflict(post_id) do update set body_markdown=excluded.body_markdown,media_type=excluded.media_type,media_path=excluded.media_path,media_url=excluded.media_url;
    imported_count:=imported_count+1;
  end loop;
  return query select target_profile,imported_count,locked_media_count,monthly_price;
end;
$$;
revoke all on function public.creator_blog_import_legacy(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.creator_blog_import_legacy(uuid,jsonb) to service_role;

create function public.creator_blog_feed(target_profile uuid)
returns table (id uuid, post_type text, access_level text, title text, tag text, teaser text, body_markdown text, media_type text, media_path text, media_url text, is_locked boolean, published_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select post.id,post.post_type,post.access_level,post.title,post.tag,post.teaser,
    case when post.access_level='public' or cc_private.creator_blog_user_has_access(profile.id,(select auth.uid())) then content.body_markdown else null end,
    case when post.access_level='public' or cc_private.creator_blog_user_has_access(profile.id,(select auth.uid())) then content.media_type else null end,
    case when post.access_level='public' or cc_private.creator_blog_user_has_access(profile.id,(select auth.uid())) then content.media_path else null end,
    case when post.access_level='public' or cc_private.creator_blog_user_has_access(profile.id,(select auth.uid())) then content.media_url else null end,
    post.access_level='subscribers' and not cc_private.creator_blog_user_has_access(profile.id,(select auth.uid())),post.published_at
  from public.creator_blog_posts as post
  join public.directory_profiles as profile on profile.id=post.profile_id
  join cc_private.creator_blog_post_content as content on content.post_id=post.id
  where post.profile_id=target_profile and post.is_published and profile.is_approved and profile.is_published and cc_private.directory_profile_paid(profile.id)
  order by post.published_at desc,post.sort_order,post.id limit 100;
$$;
revoke all on function public.creator_blog_feed(uuid) from public;
grant execute on function public.creator_blog_feed(uuid) to anon, authenticated, service_role;

create function public.creator_blog_prepare_payment(payment_reference uuid, payer_avatar uuid, target_creator_avatar uuid, paid_linden integer)
returns table(creator_profile_id uuid, creator_avatar_uuid uuid, amount_linden integer, payment_state text)
language plpgsql security definer set search_path = ''
as $$
declare previous cc_private.creator_content_payments%rowtype; target_profile uuid; expected_price integer;
begin
  if payment_reference is null or payer_avatar is null or payer_avatar='00000000-0000-0000-0000-000000000000'::uuid or target_creator_avatar is null or payer_avatar=target_creator_avatar then raise exception 'invalid_creator_payment'; end if;
  if not exists(select 1 from cc_private.verified_avatar_links where avatar_uuid=payer_avatar and revoked_at is null) then raise exception 'fan_avatar_not_verified'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(payment_reference::text,14));
  select * into previous from cc_private.creator_content_payments where payment_id=payment_reference for update;
  if found then
    if previous.fan_avatar_uuid<>payer_avatar or previous.creator_avatar_uuid<>target_creator_avatar or previous.amount_linden<>paid_linden then raise exception 'creator_payment_reference_conflict'; end if;
    return query select previous.creator_profile_id,previous.creator_avatar_uuid,previous.amount_linden,previous.payment_state; return;
  end if;
  select profile.id,profile.creator_blog_monthly_linden into target_profile,expected_price
  from public.directory_profiles as profile join cc_private.profile_owners as owner on owner.profile_id=profile.id
  join cc_private.verified_avatar_links as identity on identity.avatar_uuid=owner.avatar_uuid and identity.user_id=owner.user_id
  where identity.avatar_uuid=target_creator_avatar and identity.revoked_at is null and profile.is_approved and profile.is_published
    and cc_private.directory_profile_paid(profile.id) limit 1;
  if target_profile is null or expected_price is null or expected_price<=0 or paid_linden is distinct from expected_price then raise exception 'invalid_creator_payment_amount'; end if;
  insert into cc_private.creator_content_payments(payment_id,fan_avatar_uuid,creator_avatar_uuid,creator_profile_id,amount_linden)
    values(payment_reference,payer_avatar,target_creator_avatar,target_profile,paid_linden);
  return query select target_profile,target_creator_avatar,paid_linden,'prepared'::text;
end;
$$;
revoke all on function public.creator_blog_prepare_payment(uuid,uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.creator_blog_prepare_payment(uuid,uuid,uuid,integer) to service_role;

create function public.creator_blog_start_payout(payment_reference uuid,payer_avatar uuid,target_creator_avatar uuid,paid_linden integer)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare updated_count integer;
begin
  update cc_private.creator_content_payments set payment_state='forwarding'
  where payment_id=payment_reference and fan_avatar_uuid=payer_avatar and creator_avatar_uuid=target_creator_avatar and amount_linden=paid_linden and payment_state='prepared';
  get diagnostics updated_count = row_count;
  if updated_count=1 then return true; end if;
  if exists(select 1 from cc_private.creator_content_payments where payment_id=payment_reference and fan_avatar_uuid=payer_avatar and creator_avatar_uuid=target_creator_avatar and amount_linden=paid_linden and payment_state in ('forwarding','paid')) then return false; end if;
  raise exception 'creator_payment_not_prepared';
end;
$$;
revoke all on function public.creator_blog_start_payout(uuid,uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.creator_blog_start_payout(uuid,uuid,uuid,integer) to service_role;

create function public.creator_blog_confirm_payment(payment_reference uuid,payer_avatar uuid,target_creator_avatar uuid,paid_linden integer)
returns timestamptz language plpgsql security definer set search_path = ''
as $$
declare payment cc_private.creator_content_payments%rowtype; next_expiry timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(payment_reference::text,14));
  select * into payment from cc_private.creator_content_payments where payment_id=payment_reference for update;
  if not found or payment.fan_avatar_uuid<>payer_avatar or payment.creator_avatar_uuid<>target_creator_avatar or payment.amount_linden<>paid_linden then raise exception 'creator_payment_not_prepared'; end if;
  if not exists(select 1 from cc_private.verified_avatar_links where avatar_uuid=payer_avatar and revoked_at is null) then raise exception 'fan_avatar_not_verified'; end if;
  if payment.payment_state='paid' then return payment.subscription_expires_at; end if;
  if payment.payment_state<>'forwarding' then raise exception 'creator_payment_not_prepared'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(payer_avatar::text||target_creator_avatar::text,15));
  select greatest(expires_at,pg_catalog.now())+interval '30 days' into next_expiry from cc_private.creator_content_subscriptions where fan_avatar_uuid=payer_avatar and creator_profile_id=payment.creator_profile_id for update;
  if next_expiry is null then next_expiry:=pg_catalog.now()+interval '30 days'; end if;
  insert into cc_private.creator_content_subscriptions(fan_avatar_uuid,creator_profile_id,creator_avatar_uuid,expires_at,suspended_at,updated_at)
    values(payer_avatar,payment.creator_profile_id,target_creator_avatar,next_expiry,null,pg_catalog.now())
    on conflict(fan_avatar_uuid,creator_profile_id) do update set creator_avatar_uuid=excluded.creator_avatar_uuid,expires_at=excluded.expires_at,suspended_at=null,updated_at=pg_catalog.now();
  update cc_private.creator_content_payments set payment_state='paid',paid_at=pg_catalog.now(),subscription_expires_at=next_expiry where payment_id=payment_reference;
  return next_expiry;
end;
$$;
revoke all on function public.creator_blog_confirm_payment(uuid,uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.creator_blog_confirm_payment(uuid,uuid,uuid,integer) to service_role;

create function public.creator_blog_cancel_payment(payment_reference uuid,payer_avatar uuid,target_creator_avatar uuid,paid_linden integer)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  update cc_private.creator_content_payments set payment_state='refund_pending'
  where payment_id=payment_reference and fan_avatar_uuid=payer_avatar and creator_avatar_uuid=target_creator_avatar and amount_linden=paid_linden and payment_state='forwarding';
  if found then return true; end if;
  return exists(select 1 from cc_private.creator_content_payments where payment_id=payment_reference and fan_avatar_uuid=payer_avatar and creator_avatar_uuid=target_creator_avatar and amount_linden=paid_linden and payment_state='refund_pending');
end;
$$;
revoke all on function public.creator_blog_cancel_payment(uuid,uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.creator_blog_cancel_payment(uuid,uuid,uuid,integer) to service_role;

create function public.creator_blog_confirm_refund(payment_reference uuid,payer_avatar uuid,target_creator_avatar uuid,paid_linden integer)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  update cc_private.creator_content_payments set payment_state='cancelled'
  where payment_id=payment_reference and fan_avatar_uuid=payer_avatar and creator_avatar_uuid=target_creator_avatar and amount_linden=paid_linden and payment_state='refund_pending';
  return found;
end;
$$;
revoke all on function public.creator_blog_confirm_refund(uuid,uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.creator_blog_confirm_refund(uuid,uuid,uuid,integer) to service_role;

commit;

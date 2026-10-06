begin;

alter table cc_private.creator_blog_post_content
  add column attachments jsonb not null default '[]'::jsonb
  check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 10);

update cc_private.creator_blog_post_content
set attachments = jsonb_build_array(jsonb_build_object(
  'id', gen_random_uuid(), 'media_type', media_type, 'media_path', media_path, 'media_url', media_url
))
where media_type in ('image','audio','video') and (media_path <> '' or media_url <> '');

create function cc_private.creator_blog_attachments(content cc_private.creator_blog_post_content)
returns jsonb language sql stable set search_path = ''
as $$
  select case
    when jsonb_array_length(content.attachments) > 0 then content.attachments
    when content.media_type in ('image','audio','video') and (content.media_path <> '' or content.media_url <> '')
      then jsonb_build_array(jsonb_build_object('id', content.post_id, 'media_type', content.media_type, 'media_path', content.media_path, 'media_url', content.media_url))
    else '[]'::jsonb end;
$$;
revoke all on function cc_private.creator_blog_attachments(cc_private.creator_blog_post_content) from public, anon, authenticated;

alter function public.creator_blog_save_post(uuid,jsonb) set schema cc_private;
alter function cc_private.creator_blog_save_post(uuid,jsonb) rename to creator_blog_save_post_legacy;
revoke all on function cc_private.creator_blog_save_post_legacy(uuid,jsonb) from public, anon, authenticated, service_role;

create function public.creator_blog_save_post(target_profile uuid, post_data jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  target_id uuid;
  items jsonb;
  item jsonb;
  ids text[] := '{}';
  paths text[] := '{}';
  first_item jsonb;
  legacy_data jsonb;
  stored cc_private.creator_blog_post_content%rowtype;
  source_path text;
  source_url text;
  kind text;
begin
  if not cc_private.can_manage_directory_profile(target_profile) then raise exception 'profile_access_denied' using errcode='42501'; end if;
  if jsonb_typeof(post_data) is distinct from 'object' or octet_length(post_data::text)>65536 then raise exception 'invalid_creator_post'; end if;
  if post_data ? 'id' and (jsonb_typeof(post_data->'id') is distinct from 'string' or post_data->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'invalid_creator_post'; end if;
  target_id := coalesce((post_data->>'id')::uuid,gen_random_uuid());
  perform 1 from public.directory_profiles where id=target_profile for update;
  select * into stored from cc_private.creator_blog_post_content where post_id=target_id;
  if post_data ? 'attachments' then
    items := post_data->'attachments';
  else
    items := case when found then cc_private.creator_blog_attachments(stored) else '[]'::jsonb end;
    if jsonb_array_length(items)>1 then
      if coalesce(post_data->>'media_type','text') is distinct from stored.media_type
        or coalesce(post_data->>'media_path','') is distinct from stored.media_path
        or coalesce(post_data->>'media_url','') is distinct from stored.media_url then
        raise exception 'use_multi_attachment_editor';
      end if;
    elsif coalesce(post_data->>'media_type','text') in ('image','audio','video')
      and (coalesce(post_data->>'media_path','')<>'' or coalesce(post_data->>'media_url','')<>'') then
      items := jsonb_build_array(jsonb_build_object('id',coalesce(items->0->>'id',gen_random_uuid()::text),
        'media_type',post_data->>'media_type','media_path',coalesce(post_data->>'media_path',''),'media_url',coalesce(post_data->>'media_url','')));
    else items := '[]'::jsonb;
    end if;
  end if;
  if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>10 then raise exception 'invalid_creator_attachments'; end if;
  for item in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(item) is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(item) as field where field not in ('id','media_type','media_path','media_url'))
      or exists(select 1 from unnest(array['id','media_type','media_path','media_url']) as field where jsonb_typeof(item->field) is distinct from 'string')
      then raise exception 'invalid_creator_attachments'; end if;
    if item->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or item->>'id'=any(ids) then raise exception 'invalid_creator_attachments'; end if;
    ids := array_append(ids,item->>'id');
    kind := item->>'media_type';
    source_path := item->>'media_path';
    source_url := item->>'media_url';
    if kind not in ('image','audio','video') or (source_path='' and source_url='') or (source_path<>'' and source_url<>'') then raise exception 'invalid_creator_attachments'; end if;
    if source_url<>'' then
      if char_length(source_url)>2048 or source_url !~ '^https://[^[:space:]\\]+$' or source_url ~ '^https://[^/?#]*@' then raise exception 'invalid_creator_attachments'; end if;
      if post_data->>'access_level'='subscribers' then raise exception 'locked_media_requires_private_storage'; end if;
    else
      if source_path !~ ('^'||target_profile::text||'/'||target_id::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](webp|mp3|m4a|mp4|webm)$')
        or source_path=any(paths)
        or (kind='image' and source_path !~ '[.]webp$')
        or (kind='audio' and source_path !~ '[.](mp3|m4a)$')
        or (kind='video' and source_path !~ '[.](mp4|webm)$') then raise exception 'invalid_creator_attachments'; end if;
      paths := array_append(paths,source_path);
    end if;
  end loop;
  first_item := items->0;
  legacy_data := (post_data-'attachments') || jsonb_build_object(
    'id',target_id,'media_type',coalesce(first_item->>'media_type','text'),
    'media_path',coalesce(first_item->>'media_path',''),'media_url',coalesce(first_item->>'media_url',''));
  perform cc_private.creator_blog_save_post_legacy(target_profile,legacy_data);
  update cc_private.creator_blog_post_content set attachments=items where post_id=target_id;
  return target_id;
end;
$$;
revoke all on function public.creator_blog_save_post(uuid,jsonb) from public,anon;
grant execute on function public.creator_blog_save_post(uuid,jsonb) to authenticated,service_role;

create function public.creator_blog_save_all_v2(target_profile uuid,monthly_price integer,benefits text,posts jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform public.creator_blog_save_all(target_profile,monthly_price,benefits,posts);
end;
$$;
revoke all on function public.creator_blog_save_all_v2(uuid,integer,text,jsonb) from public,anon;
grant execute on function public.creator_blog_save_all_v2(uuid,integer,text,jsonb) to authenticated,service_role;

create function public.creator_blog_editor_posts_v2(target_profile uuid)
returns table(id uuid,legacy_id text,post_type text,access_level text,title text,tag text,teaser text,
  body_markdown text,media_type text,media_path text,media_url text,is_published boolean,sort_order integer,
  created_at timestamptz,published_at timestamptz,attachments jsonb)
language plpgsql security definer set search_path = ''
as $$
begin
  if not cc_private.can_manage_directory_profile(target_profile) then raise exception 'profile_access_denied' using errcode='42501'; end if;
  return query select post.*,cc_private.creator_blog_attachments(content)
    from public.creator_blog_editor_posts(target_profile) as post
    join cc_private.creator_blog_post_content as content on content.post_id=post.id
    order by post.sort_order,post.created_at desc,post.id;
end;
$$;
revoke all on function public.creator_blog_editor_posts_v2(uuid) from public,anon;
grant execute on function public.creator_blog_editor_posts_v2(uuid) to authenticated,service_role;

create function public.creator_blog_feed_v2(target_profile uuid)
returns table(id uuid,post_type text,access_level text,title text,tag text,teaser text,body_markdown text,
  media_type text,media_path text,media_url text,is_locked boolean,published_at timestamptz,attachments jsonb)
language sql stable security definer set search_path = ''
as $$
  select post.*,case when post.is_locked then null else cc_private.creator_blog_attachments(content) end
  from public.creator_blog_feed(target_profile) as post
  join cc_private.creator_blog_post_content as content on content.post_id=post.id
  join public.creator_blog_posts as metadata on metadata.id=post.id
  order by post.published_at desc,metadata.sort_order,post.id;
$$;
revoke all on function public.creator_blog_feed_v2(uuid) from public;
grant execute on function public.creator_blog_feed_v2(uuid) to anon,authenticated,service_role;

create or replace function cc_private.can_read_creator_blog_media(object_name text,target_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists(
    select 1 from cc_private.creator_blog_post_content as content
    join public.creator_blog_posts as post on post.id=content.post_id
    join public.directory_profiles as profile on profile.id=post.profile_id
    where exists(select 1 from jsonb_array_elements(cc_private.creator_blog_attachments(content)) as item where item->>'media_path'=object_name)
      and post.is_published and profile.is_approved and profile.is_published
      and cc_private.directory_profile_paid(profile.id)
      and (post.access_level='public' or cc_private.creator_blog_user_has_access(profile.id,target_user))
  );
$$;

commit;

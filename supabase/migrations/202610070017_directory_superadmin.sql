begin;

create table cc_private.directory_superadmins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  avatar_uuid uuid not null unique references cc_private.verified_avatar_links(avatar_uuid) on delete cascade,
  granted_at timestamptz not null default pg_catalog.now()
);
alter table cc_private.directory_superadmins enable row level security;
revoke all on cc_private.directory_superadmins from public, anon, authenticated;
grant all on cc_private.directory_superadmins to service_role;

create table cc_private.directory_admin_listing_state (
  profile_id uuid primary key references public.directory_profiles(id) on delete cascade,
  state text not null check (state in ('unpublished', 'suspended', 'archived')),
  previous_is_approved boolean not null,
  previous_is_published boolean not null,
  reason text not null default '' check (char_length(reason) <= 500),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default pg_catalog.now()
);
alter table cc_private.directory_admin_listing_state enable row level security;
revoke all on cc_private.directory_admin_listing_state from public, anon, authenticated;
grant all on cc_private.directory_admin_listing_state to service_role;

create table cc_private.directory_admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null,
  action text not null,
  target_type text not null check (target_type in ('listing', 'directory_subscription', 'creator_subscription')),
  target_id uuid not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now()
);
create index directory_admin_audit_created_idx on cc_private.directory_admin_audit(created_at desc);
alter table cc_private.directory_admin_audit enable row level security;
revoke all on cc_private.directory_admin_audit from public, anon, authenticated;
grant all on cc_private.directory_admin_audit to service_role;

-- Bootstrap the superadmin from the already verified ControlandChaos avatar link.
do $$
declare matching_count integer; admin_user uuid; admin_avatar uuid;
begin
  select count(*), (pg_catalog.array_agg(identity.user_id))[1], (pg_catalog.array_agg(identity.avatar_uuid))[1]
    into matching_count, admin_user, admin_avatar
  from cc_private.verified_avatar_links as identity
  where pg_catalog.lower(pg_catalog.btrim(identity.sl_username)) = 'controlandchaos'
    and identity.revoked_at is null;
  if matching_count <> 1 then
    raise exception 'expected one active verified controlandchaos avatar link; found %', matching_count;
  end if;
  insert into cc_private.directory_superadmins(user_id, avatar_uuid)
    values (admin_user, admin_avatar)
    on conflict (user_id) do update set avatar_uuid = excluded.avatar_uuid;
end;
$$;

create function cc_private.is_directory_superadmin(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user is not null and exists (
    select 1
    from cc_private.directory_superadmins as admin
    join cc_private.verified_avatar_links as identity
      on identity.avatar_uuid = admin.avatar_uuid
     and identity.user_id = admin.user_id
    where admin.user_id = target_user
      and identity.revoked_at is null
  );
$$;
revoke all on function cc_private.is_directory_superadmin(uuid) from public, anon, authenticated;
grant execute on function cc_private.is_directory_superadmin(uuid) to service_role;

create function public.my_directory_admin_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select cc_private.is_directory_superadmin((select auth.uid()));
$$;
revoke all on function public.my_directory_admin_access() from public, anon;
grant execute on function public.my_directory_admin_access() to authenticated, service_role;

create function public.admin_directory_listings(search_query text default '')
returns table (
  profile_data jsonb,
  moderation_state text,
  directory_plan_code text,
  directory_expires_at timestamptz,
  directory_is_lifetime boolean,
  directory_is_suspended boolean,
  directory_is_active boolean,
  active_creator_subscribers bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not cc_private.is_directory_superadmin((select auth.uid())) then
    raise exception 'directory_admin_required' using errcode = '42501';
  end if;
  if char_length(coalesce(search_query, '')) > 120 then raise exception 'invalid_admin_search'; end if;
  return query
  select pg_catalog.to_jsonb(profile),
    coalesce(state.state, case when profile.is_approved and profile.is_published then 'published' else 'draft' end),
    directory.plan_code,
    directory.expires_at,
    coalesce(directory.is_lifetime, false),
    directory.suspended_at is not null,
    coalesce(cc_private.directory_subscription_active(directory.avatar_uuid), false),
    (select count(*)::bigint from cc_private.creator_content_subscriptions as creator
      where creator.creator_profile_id = profile.id
        and creator.suspended_at is null and creator.expires_at > pg_catalog.now())
  from public.directory_profiles as profile
  left join cc_private.directory_subscriptions as directory on directory.profile_id = profile.id
  left join cc_private.directory_admin_listing_state as state on state.profile_id = profile.id
  where coalesce(search_query, '') = ''
    or pg_catalog.strpos(pg_catalog.lower(pg_catalog.concat_ws(' ', profile.display_name, profile.sl_username, profile.slug, profile.id::text)), pg_catalog.lower(search_query)) > 0
  order by profile.display_name, profile.id;
end;
$$;
revoke all on function public.admin_directory_listings(text) from public, anon;
grant execute on function public.admin_directory_listings(text) to authenticated, service_role;

create function public.admin_directory_subscribers(search_query text default '', subscription_type_filter text default 'all')
returns table (
  subscription_type text,
  subscriber_avatar_uuid uuid,
  subscriber_username text,
  profile_id uuid,
  profile_slug text,
  profile_name text,
  plan_code text,
  amount_linden integer,
  expires_at timestamptz,
  is_lifetime boolean,
  is_suspended boolean,
  is_active boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not cc_private.is_directory_superadmin((select auth.uid())) then
    raise exception 'directory_admin_required' using errcode = '42501';
  end if;
  if char_length(coalesce(search_query, '')) > 120 or subscription_type_filter not in ('all', 'directory', 'creator') then
    raise exception 'invalid_admin_filter';
  end if;
  return query
  with subscriptions as (
    select 'directory'::text as kind, directory.avatar_uuid, identity.sl_username,
      directory.profile_id, profile.slug, profile.display_name, directory.plan_code,
      plan.amount_linden, directory.expires_at, directory.is_lifetime,
      directory.suspended_at is not null as is_suspended,
      cc_private.directory_subscription_active(directory.avatar_uuid) as is_active
    from cc_private.directory_subscriptions as directory
    left join cc_private.verified_avatar_links as identity on identity.avatar_uuid = directory.avatar_uuid
    left join public.directory_profiles as profile on profile.id = directory.profile_id
    left join cc_private.directory_plans as plan on plan.code = directory.plan_code
    union all
    select 'creator'::text, creator.fan_avatar_uuid, identity.sl_username,
      creator.creator_profile_id, profile.slug, profile.display_name, 'creator_monthly'::text,
      profile.creator_blog_monthly_linden, creator.expires_at, false,
      creator.suspended_at is not null,
      creator.suspended_at is null and creator.expires_at > pg_catalog.now()
    from cc_private.creator_content_subscriptions as creator
    left join cc_private.verified_avatar_links as identity on identity.avatar_uuid = creator.fan_avatar_uuid
    left join public.directory_profiles as profile on profile.id = creator.creator_profile_id
  )
  select subscriptions.kind, subscriptions.avatar_uuid,
    coalesce(subscriptions.sl_username, subscriptions.avatar_uuid::text),
    subscriptions.profile_id, subscriptions.slug, subscriptions.display_name,
    subscriptions.plan_code, subscriptions.amount_linden, subscriptions.expires_at,
    subscriptions.is_lifetime, subscriptions.is_suspended, subscriptions.is_active
  from subscriptions
  where (subscription_type_filter = 'all' or subscriptions.kind = subscription_type_filter)
    and (coalesce(search_query, '') = '' or
      pg_catalog.strpos(pg_catalog.lower(pg_catalog.concat_ws(' ', subscriptions.sl_username, subscriptions.avatar_uuid::text,
        subscriptions.display_name, subscriptions.slug, subscriptions.plan_code)), pg_catalog.lower(search_query)) > 0)
  order by subscriptions.display_name, subscriptions.kind, subscriptions.expires_at desc;
end;
$$;
revoke all on function public.admin_directory_subscribers(text, text) from public, anon;
grant execute on function public.admin_directory_subscribers(text, text) to authenticated, service_role;

create function public.admin_update_directory_profile(target_profile uuid, profile_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare current_profile public.directory_profiles%rowtype; updated_profile public.directory_profiles%rowtype;
begin
  if not cc_private.is_directory_superadmin((select auth.uid())) then
    raise exception 'directory_admin_required' using errcode = '42501';
  end if;
  if target_profile is null or pg_catalog.jsonb_typeof(profile_changes) is distinct from 'object'
    or pg_catalog.octet_length(profile_changes::text) > 65536
    or profile_changes = '{}'::jsonb then raise exception 'invalid_admin_profile_update'; end if;
  if exists (
    select 1 from pg_catalog.jsonb_object_keys(profile_changes) as field(name)
    where field.name <> all (array[
      'display_name','role_type','headline','tagline','about','avatar_image','banner_image',
      'starting_rate','availability','tags','is_featured','availability_note','boundaries',
      'booking_instructions','rate_categories','booking_hours','hardware_title','hardware_compat',
      'wishlist_title','wishlist','creator_blog_monthly_linden','creator_blog_benefits'
    ])
  ) then raise exception 'invalid_admin_profile_update'; end if;
  select * into current_profile from public.directory_profiles where id = target_profile for update;
  if not found then raise exception 'directory_profile_not_found'; end if;
  updated_profile := pg_catalog.jsonb_populate_record(current_profile, profile_changes);
  update public.directory_profiles set
    display_name = updated_profile.display_name,
    role_type = updated_profile.role_type,
    headline = updated_profile.headline,
    tagline = updated_profile.tagline,
    about = updated_profile.about,
    avatar_image = updated_profile.avatar_image,
    banner_image = updated_profile.banner_image,
    starting_rate = updated_profile.starting_rate,
    availability = updated_profile.availability,
    tags = updated_profile.tags,
    is_featured = updated_profile.is_featured,
    availability_note = updated_profile.availability_note,
    boundaries = updated_profile.boundaries,
    booking_instructions = updated_profile.booking_instructions,
    rate_categories = updated_profile.rate_categories,
    booking_hours = updated_profile.booking_hours,
    hardware_title = updated_profile.hardware_title,
    hardware_compat = updated_profile.hardware_compat,
    wishlist_title = updated_profile.wishlist_title,
    wishlist = updated_profile.wishlist,
    creator_blog_monthly_linden = updated_profile.creator_blog_monthly_linden,
    creator_blog_benefits = updated_profile.creator_blog_benefits
  where id = target_profile
  returning * into updated_profile;
  insert into cc_private.directory_admin_audit(actor_user_id, action, target_type, target_id, details)
    values ((select auth.uid()), 'update_listing', 'listing', target_profile,
      pg_catalog.jsonb_build_object('fields', (select pg_catalog.jsonb_agg(name) from pg_catalog.jsonb_object_keys(profile_changes) as field(name))));
  return pg_catalog.to_jsonb(updated_profile);
end;
$$;
revoke all on function public.admin_update_directory_profile(uuid, jsonb) from public, anon;
grant execute on function public.admin_update_directory_profile(uuid, jsonb) to authenticated, service_role;

create function public.admin_set_listing_state(target_profile uuid, action text, reason text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare profile public.directory_profiles%rowtype; saved_state cc_private.directory_admin_listing_state%rowtype;
begin
  if not cc_private.is_directory_superadmin((select auth.uid())) then
    raise exception 'directory_admin_required' using errcode = '42501';
  end if;
  if action not in ('publish','unpublish','suspend','archive','restore') or char_length(coalesce(reason,'')) > 500 then
    raise exception 'invalid_listing_state_action';
  end if;
  select * into profile from public.directory_profiles where id = target_profile for update;
  if not found then raise exception 'directory_profile_not_found'; end if;
  if action = 'restore' then
    select * into saved_state from cc_private.directory_admin_listing_state where profile_id = target_profile for update;
    if not found then raise exception 'listing_not_suspended'; end if;
    update public.directory_profiles set is_approved = saved_state.previous_is_approved,
      is_published = saved_state.previous_is_published where id = target_profile;
    delete from cc_private.directory_admin_listing_state where profile_id = target_profile;
  elsif action = 'publish' then
    update public.directory_profiles set is_approved = true, is_published = true where id = target_profile;
    delete from cc_private.directory_admin_listing_state where profile_id = target_profile;
  else
    insert into cc_private.directory_admin_listing_state(profile_id, state, previous_is_approved, previous_is_published, reason, updated_by)
      values (target_profile,
        case action when 'suspend' then 'suspended' when 'archive' then 'archived' else 'unpublished' end,
        profile.is_approved, profile.is_published, coalesce(reason,''), (select auth.uid()))
      on conflict (profile_id) do update set state = excluded.state, reason = excluded.reason,
        updated_by = excluded.updated_by, updated_at = pg_catalog.now();
    update public.directory_profiles set is_published = false,
      is_approved = case when action = 'archive' then false else is_approved end
      where id = target_profile;
  end if;
  insert into cc_private.directory_admin_audit(actor_user_id, action, target_type, target_id, details)
    values ((select auth.uid()), 'listing_' || action, 'listing', target_profile, pg_catalog.jsonb_build_object('reason', coalesce(reason,'')));
end;
$$;
revoke all on function public.admin_set_listing_state(uuid, text, text) from public, anon;
grant execute on function public.admin_set_listing_state(uuid, text, text) to authenticated, service_role;

create function public.admin_set_subscription_state(subscription_type text, subscriber_avatar uuid, target_profile uuid, action text, extension_days integer default null)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare resulting_expiry timestamptz; lifetime boolean; before_suspended timestamptz;
begin
  if not cc_private.is_directory_superadmin((select auth.uid())) then
    raise exception 'directory_admin_required' using errcode = '42501';
  end if;
  if subscription_type not in ('directory','creator') or action not in ('suspend','restore','extend') then raise exception 'invalid_subscription_action'; end if;
  if subscriber_avatar is null or (subscription_type = 'creator' and target_profile is null) then raise exception 'invalid_subscription_action'; end if;
  if action = 'extend' and (extension_days is null or extension_days not between 1 and 3650) then raise exception 'invalid_extension_days'; end if;
  if action <> 'extend' and extension_days is not null then raise exception 'invalid_extension_days'; end if;
  if subscription_type = 'directory' then
    select expires_at, is_lifetime, suspended_at into resulting_expiry, lifetime, before_suspended
      from cc_private.directory_subscriptions where avatar_uuid = subscriber_avatar and (profile_id = target_profile or target_profile is null) for update;
    if not found then raise exception 'directory_subscription_not_found'; end if;
    if action = 'suspend' then update cc_private.directory_subscriptions set suspended_at = coalesce(suspended_at, pg_catalog.now()) where avatar_uuid = subscriber_avatar;
    elsif action = 'restore' then update cc_private.directory_subscriptions set suspended_at = null where avatar_uuid = subscriber_avatar;
    else
      if lifetime then raise exception 'cannot_extend_lifetime_subscription'; end if;
      update cc_private.directory_subscriptions set expires_at = (case when expires_at > pg_catalog.now() then expires_at else pg_catalog.now() end) + extension_days * interval '1 day', suspended_at = null where avatar_uuid = subscriber_avatar returning expires_at into resulting_expiry;
    end if;
  else
    select expires_at, false, suspended_at into resulting_expiry, lifetime, before_suspended
      from cc_private.creator_content_subscriptions where fan_avatar_uuid = subscriber_avatar and creator_profile_id = target_profile for update;
    if not found then raise exception 'creator_subscription_not_found'; end if;
    if action = 'suspend' then update cc_private.creator_content_subscriptions set suspended_at = coalesce(suspended_at, pg_catalog.now()), updated_at = pg_catalog.now() where fan_avatar_uuid = subscriber_avatar and creator_profile_id = target_profile;
    elsif action = 'restore' then update cc_private.creator_content_subscriptions set suspended_at = null, updated_at = pg_catalog.now() where fan_avatar_uuid = subscriber_avatar and creator_profile_id = target_profile;
    else update cc_private.creator_content_subscriptions set expires_at = (case when expires_at > pg_catalog.now() then expires_at else pg_catalog.now() end) + extension_days * interval '1 day', suspended_at = null, updated_at = pg_catalog.now() where fan_avatar_uuid = subscriber_avatar and creator_profile_id = target_profile returning expires_at into resulting_expiry;
    end if;
  end if;
  insert into cc_private.directory_admin_audit(actor_user_id, action, target_type, target_id, details)
    values ((select auth.uid()), 'subscription_' || action,
      case when subscription_type = 'directory' then 'directory_subscription' else 'creator_subscription' end,
      coalesce(target_profile, subscriber_avatar),
      pg_catalog.jsonb_build_object('avatar_uuid', subscriber_avatar, 'profile_id', target_profile, 'extension_days', extension_days, 'was_suspended', before_suspended is not null));
  return resulting_expiry;
end;
$$;
revoke all on function public.admin_set_subscription_state(text, uuid, uuid, text, integer) from public, anon;
grant execute on function public.admin_set_subscription_state(text, uuid, uuid, text, integer) to authenticated, service_role;

commit;

begin;

create function public.my_creator_blog_subscriptions()
returns table (
  creator_profile_id uuid,
  creator_avatar_uuid uuid,
  creator_slug text,
  creator_name text,
  expires_at timestamptz,
  is_active boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select subscription.creator_profile_id,
    subscription.creator_avatar_uuid,
    profile.slug,
    profile.display_name,
    subscription.expires_at,
    subscription.suspended_at is null and subscription.expires_at > pg_catalog.now()
  from cc_private.creator_content_subscriptions as subscription
  join cc_private.verified_avatar_links as identity
    on identity.avatar_uuid = subscription.fan_avatar_uuid
  join public.directory_profiles as profile
    on profile.id = subscription.creator_profile_id
  where identity.user_id = (select auth.uid())
    and identity.revoked_at is null
  order by subscription.expires_at desc, profile.display_name;
$$;

revoke all on function public.my_creator_blog_subscriptions() from public, anon, authenticated;
grant execute on function public.my_creator_blog_subscriptions() to authenticated;

commit;

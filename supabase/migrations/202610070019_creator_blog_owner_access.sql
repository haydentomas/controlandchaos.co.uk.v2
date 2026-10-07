begin;

create or replace function public.creator_blog_public_offer(target_profile uuid)
returns table (
  creator_avatar_uuid uuid,
  monthly_price_linden integer,
  benefits text,
  terminal_slurl text,
  viewer_is_subscribed boolean,
  creator_is_vip boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select owner.avatar_uuid,
    case when cc_private.directory_profile_is_vip(profile.id) then profile.creator_blog_monthly_linden else 0 end,
    case when cc_private.directory_profile_is_vip(profile.id) then profile.creator_blog_benefits else '' end,
    case when cc_private.directory_profile_is_vip(profile.id) then settings.terminal_slurl else '' end,
    cc_private.creator_blog_user_has_access(profile.id, (select auth.uid())),
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

commit;

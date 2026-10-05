begin;

alter table cc_private.verified_avatar_links
  add column sl_username text check (sl_username is null or char_length(btrim(sl_username)) between 1 and 100);

create table cc_private.avatar_verification_challenges (
  code uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  consumed_at timestamptz
);
create index avatar_verification_challenges_user_created_idx on cc_private.avatar_verification_challenges(user_id, created_at desc);
alter table cc_private.avatar_verification_challenges enable row level security;
revoke all on table cc_private.avatar_verification_challenges from public, anon, authenticated;
grant all on table cc_private.avatar_verification_challenges to service_role;

create function cc_private.request_avatar_verification()
returns table(challenge_code uuid, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  account_id uuid := auth.uid();
begin
  if account_id is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(account_id::text, 0));
  if exists (select 1 from cc_private.avatar_verification_challenges as challenge where challenge.user_id = account_id and challenge.created_at > now() - interval '1 minute')
    or (select count(*) from cc_private.avatar_verification_challenges as challenge where challenge.user_id = account_id and challenge.created_at > now() - interval '1 day') >= 10
  then raise exception 'verification_rate_limited'; end if;
  update cc_private.avatar_verification_challenges as challenge
    set expires_at = least(challenge.expires_at, now())
    where challenge.user_id = account_id and challenge.consumed_at is null;
  return query insert into cc_private.avatar_verification_challenges(user_id)
    values (account_id) returning code, avatar_verification_challenges.expires_at;
end;
$$;

create function cc_private.my_verified_avatars()
returns table(avatar_uuid uuid, sl_username text, verified_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select identity.avatar_uuid, identity.sl_username, identity.verified_at
  from cc_private.verified_avatar_links as identity
  where identity.user_id = (select auth.uid()) and identity.revoked_at is null;
$$;

create function cc_private.consume_avatar_verification(challenge_code uuid, avatar_id uuid, avatar_username text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  challenge cc_private.avatar_verification_challenges%rowtype;
  identity cc_private.verified_avatar_links%rowtype;
begin
  if avatar_id is null or avatar_id = '00000000-0000-0000-0000-000000000000'::uuid
    or avatar_username is null or char_length(btrim(avatar_username)) not between 1 and 100
  then raise exception 'invalid_avatar'; end if;
  select * into challenge from cc_private.avatar_verification_challenges where code = challenge_code for update;
  if not found or challenge.consumed_at is not null or challenge.expires_at <= now() then raise exception 'verification_expired_or_used'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(avatar_id::text, 0));
  select * into identity from cc_private.verified_avatar_links where verified_avatar_links.avatar_uuid = avatar_id for update;
  if found then
    if identity.user_id <> challenge.user_id then raise exception 'avatar_already_linked'; end if;
    if identity.revoked_at is not null then raise exception 'avatar_link_revoked'; end if;
    update cc_private.verified_avatar_links set sl_username = btrim(avatar_username) where verified_avatar_links.avatar_uuid = avatar_id;
  else
    insert into cc_private.verified_avatar_links(avatar_uuid, user_id, sl_username)
      values (avatar_id, challenge.user_id, btrim(avatar_username));
  end if;
  update cc_private.avatar_verification_challenges set consumed_at = now() where code = challenge_code;
  return avatar_id;
end;
$$;

revoke all on function cc_private.request_avatar_verification(), cc_private.my_verified_avatars() from public, anon;
grant execute on function cc_private.request_avatar_verification(), cc_private.my_verified_avatars() to authenticated, service_role;
revoke all on function cc_private.consume_avatar_verification(uuid, uuid, text) from public, anon, authenticated;
grant execute on function cc_private.consume_avatar_verification(uuid, uuid, text) to service_role;

create function public.request_avatar_verification()
returns table(challenge_code uuid, expires_at timestamptz)
language sql security invoker set search_path = ''
as $$ select * from cc_private.request_avatar_verification(); $$;
create function public.my_verified_avatars()
returns table(avatar_uuid uuid, sl_username text, verified_at timestamptz)
language sql stable security invoker set search_path = ''
as $$ select * from cc_private.my_verified_avatars(); $$;
create function public.consume_avatar_verification(challenge_code uuid, avatar_id uuid, avatar_username text)
returns uuid language sql security invoker set search_path = ''
as $$ select cc_private.consume_avatar_verification(challenge_code, avatar_id, avatar_username); $$;

revoke all on function public.request_avatar_verification(), public.my_verified_avatars() from public, anon;
grant execute on function public.request_avatar_verification(), public.my_verified_avatars() to authenticated, service_role;
revoke all on function public.consume_avatar_verification(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.consume_avatar_verification(uuid, uuid, text) to service_role;

commit;
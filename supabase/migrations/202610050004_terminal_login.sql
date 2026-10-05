begin;

create table cc_private.terminal_login_challenges (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  avatar_uuid uuid not null references cc_private.verified_avatar_links(avatar_uuid) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 minutes'),
  consumed_at timestamptz
);
create index terminal_login_avatar_created_idx on cc_private.terminal_login_challenges(avatar_uuid, created_at desc);
alter table cc_private.terminal_login_challenges enable row level security;
revoke all on cc_private.terminal_login_challenges from public, anon, authenticated;
grant all on cc_private.terminal_login_challenges to service_role;

create function public.issue_terminal_login(target_avatar uuid, login_hash text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  account_id uuid;
begin
  if login_hash is null or login_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_login'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_avatar::text, 0));
  select user_id into account_id from cc_private.verified_avatar_links
    where avatar_uuid = target_avatar and revoked_at is null;
  if not found then return null; end if;
  if exists (select 1 from cc_private.terminal_login_challenges where avatar_uuid = target_avatar and created_at > now() - interval '1 minute')
    or (select count(*) from cc_private.terminal_login_challenges where avatar_uuid = target_avatar and created_at > now() - interval '1 day') >= 10
  then raise exception 'terminal_login_rate_limited'; end if;
  update cc_private.terminal_login_challenges set expires_at = least(expires_at, now())
    where avatar_uuid = target_avatar and consumed_at is null;
  insert into cc_private.terminal_login_challenges(token_hash, avatar_uuid, user_id)
    values (login_hash, target_avatar, account_id);
  return account_id;
end;
$$;

create function public.consume_terminal_login(login_hash text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  challenge cc_private.terminal_login_challenges%rowtype;
begin
  select * into challenge from cc_private.terminal_login_challenges where token_hash = login_hash;
  if not found or challenge.consumed_at is not null or challenge.expires_at <= now() then raise exception 'terminal_login_expired_or_used'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(challenge.avatar_uuid::text, 0));
  select * into challenge from cc_private.terminal_login_challenges where token_hash = login_hash for update;
  if not found or challenge.consumed_at is not null or challenge.expires_at <= now() then raise exception 'terminal_login_expired_or_used'; end if;
  if not exists (select 1 from cc_private.verified_avatar_links
    where avatar_uuid = challenge.avatar_uuid and user_id = challenge.user_id and revoked_at is null)
  then raise exception 'terminal_login_denied'; end if;
  update cc_private.terminal_login_challenges set consumed_at = now() where token_hash = login_hash;
  return challenge.user_id;
end;
$$;

revoke all on function public.issue_terminal_login(uuid,text), public.consume_terminal_login(text) from public, anon, authenticated;
grant execute on function public.issue_terminal_login(uuid,text), public.consume_terminal_login(text) to service_role;

commit;
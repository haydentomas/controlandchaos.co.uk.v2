begin;

create or replace function public.issue_terminal_login(target_avatar uuid, login_hash text)
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
  if exists (select 1 from cc_private.terminal_login_challenges where avatar_uuid = target_avatar and created_at > now() - interval '10 seconds')
    or (select count(*) from cc_private.terminal_login_challenges where avatar_uuid = target_avatar and created_at > now() - interval '1 day') >= 100
  then raise exception 'terminal_login_rate_limited'; end if;
  update cc_private.terminal_login_challenges set expires_at = least(expires_at, now())
    where avatar_uuid = target_avatar and consumed_at is null;
  insert into cc_private.terminal_login_challenges(token_hash, avatar_uuid, user_id)
    values (login_hash, target_avatar, account_id);
  return account_id;
end;
$$;

revoke all on function public.issue_terminal_login(uuid,text) from public, anon, authenticated;
grant execute on function public.issue_terminal_login(uuid,text) to service_role;

commit;
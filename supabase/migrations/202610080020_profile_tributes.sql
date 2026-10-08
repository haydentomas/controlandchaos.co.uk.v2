begin;

create table cc_private.tribute_settings (
  profile_id uuid primary key references public.directory_profiles(id) on delete cascade,
  enabled boolean not null default false,
  goal_linden integer not null default 0 check (goal_linden between 0 and 1000000000),
  goal_title text not null default '' check (char_length(goal_title) <= 100)
);
create table cc_private.tribute_payments (
  payment_id uuid primary key check (payment_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  payer_avatar_uuid uuid not null check (payer_avatar_uuid <> '00000000-0000-0000-0000-000000000000'::uuid),
  creator_avatar_uuid uuid not null,
  creator_profile_id uuid not null references public.directory_profiles(id),
  amount_linden integer not null check (amount_linden between 1 and 1000000),
  payer_name text not null check (char_length(btrim(payer_name)) between 1 and 100),
  show_name boolean not null,
  payment_state text not null default 'prepared' check (payment_state in ('prepared','forwarding','paid','refund_pending','cancelled')),
  received_at timestamptz not null default now(),
  paid_at timestamptz,
  check (payer_avatar_uuid <> creator_avatar_uuid)
);
create index tribute_paid_profile_idx on cc_private.tribute_payments(creator_profile_id,paid_at) where payment_state='paid';
alter table cc_private.tribute_settings enable row level security;
alter table cc_private.tribute_payments enable row level security;
revoke all on cc_private.tribute_settings, cc_private.tribute_payments from public, anon, authenticated;
grant all on cc_private.tribute_settings, cc_private.tribute_payments to service_role;

create function public.tribute_owner_settings(target_profile uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not cc_private.can_manage_directory_profile(target_profile) then raise exception 'tribute_access_denied' using errcode='42501'; end if;
  return coalesce((select jsonb_build_object('enabled',enabled,'goal_linden',goal_linden,'goal_title',goal_title)
    from cc_private.tribute_settings where profile_id=target_profile),jsonb_build_object('enabled',false,'goal_linden',0,'goal_title',''));
end;
$$;
create function public.tribute_save_settings(target_profile uuid, enabled boolean, goal_linden integer, goal_title text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not cc_private.can_manage_directory_profile(target_profile) then raise exception 'tribute_access_denied' using errcode='42501'; end if;
  if $2 is null or $3 is null or $3<0 or $3>1000000000 or $4 is null or char_length($4)>100 then raise exception 'invalid_tribute_settings'; end if;
  insert into cc_private.tribute_settings(profile_id,enabled,goal_linden,goal_title) values($1,$2,$3,btrim($4))
    on conflict(profile_id) do update set enabled=excluded.enabled,goal_linden=excluded.goal_linden,goal_title=excluded.goal_title;
  return true;
end;
$$;
revoke all on function public.tribute_owner_settings(uuid),public.tribute_save_settings(uuid,boolean,integer,text) from public,anon,authenticated;
grant execute on function public.tribute_owner_settings(uuid),public.tribute_save_settings(uuid,boolean,integer,text) to authenticated;

create function public.tribute_offer_for_terminal(target_creator_avatar uuid)
returns table(profile_id uuid,creator_avatar_uuid uuid,creator_name text)
language sql stable security definer set search_path = '' as $$
  select profile.id,identity.avatar_uuid,profile.display_name
  from public.directory_profiles as profile
  join cc_private.tribute_settings as settings on settings.profile_id=profile.id and settings.enabled
  join cc_private.profile_owners as owner on owner.profile_id=profile.id
  join cc_private.verified_avatar_links as identity on identity.avatar_uuid=owner.avatar_uuid and identity.user_id=owner.user_id
  where identity.avatar_uuid=$1 and identity.revoked_at is null and profile.is_approved and profile.is_published
    and cc_private.directory_profile_paid(profile.id) limit 1;
$$;
revoke all on function public.tribute_offer_for_terminal(uuid) from public,anon,authenticated;
grant execute on function public.tribute_offer_for_terminal(uuid) to service_role;

create function public.tribute_payment(stage text,payment_reference uuid,payer_avatar uuid,target_creator_avatar uuid,paid_linden integer,payer_name text,show_name boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare receipt cc_private.tribute_payments%rowtype; target_profile uuid; started boolean;
begin
  if $1 is null or $1 not in ('prepare','start','confirm','cancel','refund_confirm') or $2 is null
    or $2='00000000-0000-0000-0000-000000000000'::uuid or $3 is null
    or $3='00000000-0000-0000-0000-000000000000'::uuid or $4 is null or $3=$4
    or $5 is null or $5<1 or $5>1000000 or $6 is null or char_length(btrim($6)) not between 1 and 100
    or $7 is null then raise exception 'invalid_tribute_payment'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($2::text,20));
  select * into receipt from cc_private.tribute_payments where payment_id=$2 for update;
  if not found then
    if $1<>'prepare' then raise exception 'tribute_not_prepared'; end if;
    select offer.profile_id into target_profile from public.tribute_offer_for_terminal($4) as offer;
    if target_profile is null then raise exception 'tribute_unavailable'; end if;
    insert into cc_private.tribute_payments(payment_id,payer_avatar_uuid,creator_avatar_uuid,creator_profile_id,amount_linden,payer_name,show_name)
      values($2,$3,$4,target_profile,$5,btrim($6),$7) returning * into receipt;
  end if;
  if receipt.payer_avatar_uuid<>$3 or receipt.creator_avatar_uuid<>$4 or receipt.amount_linden<>$5
    or receipt.payer_name<>btrim($6) or receipt.show_name<>$7 then raise exception 'tribute_reference_conflict'; end if;
  if $1='prepare' then
    return jsonb_build_object('payout',jsonb_build_object('creator_avatar_uuid',receipt.creator_avatar_uuid,'amount_linden',receipt.amount_linden,'payment_state',receipt.payment_state));
  elsif $1='start' then
    if receipt.payment_state not in ('prepared','forwarding','paid') then raise exception 'tribute_not_prepared'; end if;
    started:=receipt.payment_state='prepared';
    if started then update cc_private.tribute_payments set payment_state='forwarding' where payment_id=$2; end if;
    return jsonb_build_object('start_payout',started);
  elsif $1='confirm' then
    if receipt.payment_state not in ('forwarding','paid') then raise exception 'tribute_not_forwarding'; end if;
    update cc_private.tribute_payments set payment_state='paid',paid_at=coalesce(paid_at,pg_catalog.now()) where payment_id=$2;
    return jsonb_build_object('confirmed',true);
  elsif $1='cancel' then
    if receipt.payment_state not in ('forwarding','refund_pending') then raise exception 'tribute_not_forwarding'; end if;
    update cc_private.tribute_payments set payment_state='refund_pending' where payment_id=$2;
    return jsonb_build_object('refund_required',true);
  else
    if receipt.payment_state not in ('refund_pending','cancelled') then raise exception 'tribute_refund_not_pending'; end if;
    update cc_private.tribute_payments set payment_state='cancelled' where payment_id=$2;
    return jsonb_build_object('refunded',true);
  end if;
end;
$$;
revoke all on function public.tribute_payment(text,uuid,uuid,uuid,integer,text,boolean) from public,anon,authenticated;
grant execute on function public.tribute_payment(text,uuid,uuid,uuid,integer,text,boolean) to service_role;

create function public.tribute_public_summary(target_profile uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare settings cc_private.tribute_settings%rowtype; recipient uuid; total bigint; tribute_count bigint; leaders jsonb; biggest jsonb;
begin
  select * into settings from cc_private.tribute_settings where profile_id=$1 and enabled;
  if not found then return null; end if;
  select offer.creator_avatar_uuid into recipient from cc_private.profile_owners as owner
    cross join lateral public.tribute_offer_for_terminal(owner.avatar_uuid) as offer
    where owner.profile_id=$1 and offer.profile_id=$1 limit 1;
  if recipient is null then return null; end if;
  select coalesce(sum(amount_linden),0),count(*) into total,tribute_count from cc_private.tribute_payments
    where creator_profile_id=$1 and payment_state='paid';
  select coalesce(jsonb_agg(jsonb_build_object('name',ranked.name,'total_linden',ranked.total_linden,'count',ranked.count)
    order by ranked.total_linden desc,ranked.name),'[]'::jsonb) into leaders from (
      select (array_agg(payer_name order by paid_at desc,payment_id))[1] as name,sum(amount_linden) as total_linden,count(*) as count
      from cc_private.tribute_payments where creator_profile_id=$1 and payment_state='paid' and show_name
      group by payer_avatar_uuid order by sum(amount_linden) desc,payer_avatar_uuid limit 10
    ) as ranked;
  select jsonb_build_object('name',payer_name,'amount_linden',amount_linden) into biggest from cc_private.tribute_payments
    where creator_profile_id=$1 and payment_state='paid' and show_name order by amount_linden desc,paid_at,payment_id limit 1;
  return jsonb_build_object('total_linden',total,'count',tribute_count,'goal_linden',settings.goal_linden,'goal_title',settings.goal_title,
    'creator_avatar_uuid',recipient,'terminal_slurl',coalesce((select terminal_slurl from cc_private.creator_blog_terminal_settings where singleton),''),
    'leaders',leaders,'biggest',biggest);
end;
$$;
revoke all on function public.tribute_public_summary(uuid) from public;
grant execute on function public.tribute_public_summary(uuid) to anon,authenticated,service_role;

commit;
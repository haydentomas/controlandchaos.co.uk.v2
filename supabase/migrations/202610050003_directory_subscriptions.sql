begin;

create table cc_private.directory_plans (
  code text primary key check (code ~ '^[a-z0-9_]+$'),
  tier text not null default 'basic' check (tier in ('basic', 'vip')),
  amount_linden integer check (amount_linden between 1 and 2147483647),
  duration_days integer check (duration_days between 1 and 3660),
  is_lifetime boolean not null default false,
  enabled boolean not null default false,
  check (not enabled or amount_linden is not null),
  check ((is_lifetime and duration_days is null) or (not is_lifetime and duration_days is not null))
);

insert into cc_private.directory_plans(code, tier, duration_days, is_lifetime) values
  ('basic_monthly', 'basic', 30, false),
  ('basic_lifetime', 'basic', null, true),
  ('vip_monthly', 'vip', 30, false),
  ('vip_lifetime', 'vip', null, true);

create table cc_private.directory_subscriptions (
  avatar_uuid uuid primary key check (avatar_uuid <> '00000000-0000-0000-0000-000000000000'),
  plan_code text not null references cc_private.directory_plans(code),
  expires_at timestamptz,
  is_lifetime boolean not null default false,
  suspended_at timestamptz,
  profile_id uuid unique references public.directory_profiles(id),
  check ((is_lifetime and expires_at is null) or (not is_lifetime and expires_at is not null))
);

create table cc_private.directory_payments (
  payment_id uuid primary key,
  avatar_uuid uuid not null references cc_private.directory_subscriptions(avatar_uuid),
  plan_code text not null references cc_private.directory_plans(code),
  amount_linden integer not null check (amount_linden > 0),
  received_at timestamptz not null default now()
);

create table cc_private.directory_reminders (
  id uuid primary key default gen_random_uuid(),
  avatar_uuid uuid not null references cc_private.directory_subscriptions(avatar_uuid),
  kind text not null check (kind in ('expiring', 'expired')),
  subscription_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique (avatar_uuid, kind, subscription_expires_at)
);

alter table cc_private.directory_plans enable row level security;
alter table cc_private.directory_subscriptions enable row level security;
alter table cc_private.directory_payments enable row level security;
alter table cc_private.directory_reminders enable row level security;
revoke all on cc_private.directory_plans, cc_private.directory_subscriptions, cc_private.directory_payments, cc_private.directory_reminders from public, anon, authenticated;
grant all on cc_private.directory_plans, cc_private.directory_subscriptions, cc_private.directory_payments, cc_private.directory_reminders to service_role;

create function cc_private.directory_subscription_active(target_avatar uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from cc_private.directory_subscriptions
    where avatar_uuid = target_avatar and suspended_at is null
      and (is_lifetime or expires_at > now()));
$$;

create function cc_private.directory_profile_paid(target_profile uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from cc_private.directory_subscriptions
    where profile_id = target_profile and suspended_at is null
      and (is_lifetime or expires_at > now()));
$$;

create or replace function cc_private.can_manage_directory_profile(target_profile uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from cc_private.profile_owners as ownership
    join cc_private.verified_avatar_links as identity
      on identity.avatar_uuid = ownership.avatar_uuid and identity.user_id = ownership.user_id
    where ownership.profile_id = target_profile
      and ownership.user_id = (select auth.uid()) and identity.revoked_at is null
      and cc_private.directory_profile_paid(target_profile)
  );
$$;

drop policy directory_public_read on public.directory_profiles;
create policy directory_public_read on public.directory_profiles
for select to anon, authenticated
using (is_approved and is_published and cc_private.directory_profile_paid(id));

create function cc_private.provision_paid_directory_profile(target_avatar uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  identity cc_private.verified_avatar_links%rowtype;
  subscription cc_private.directory_subscriptions%rowtype;
  target_profile uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_avatar::text, 0));
  select * into identity from cc_private.verified_avatar_links where avatar_uuid = target_avatar;
  if not found or identity.revoked_at is not null or identity.sl_username is null then return null; end if;
  select * into subscription from cc_private.directory_subscriptions where avatar_uuid = target_avatar for update;
  if not found or not cc_private.directory_subscription_active(target_avatar) then return null; end if;
  target_profile := subscription.profile_id;
  if target_profile is null then
    insert into public.directory_profiles(slug, display_name, sl_username, role_type, is_approved)
      values ('avatar-' || target_avatar::text, identity.sl_username, identity.sl_username, 'switch', true)
      returning id into target_profile;
    update cc_private.directory_subscriptions set profile_id = target_profile where avatar_uuid = target_avatar;
  end if;
  insert into cc_private.profile_owners(profile_id, user_id, avatar_uuid)
    values (target_profile, identity.user_id, target_avatar)
    on conflict (profile_id) do nothing;
  return target_profile;
end;
$$;

create function cc_private.provision_after_avatar_verification()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform cc_private.provision_paid_directory_profile(new.avatar_uuid);
  return new;
end;
$$;
create trigger directory_provision_after_verification
after insert or update on cc_private.verified_avatar_links
for each row execute function cc_private.provision_after_avatar_verification();

create function public.register_directory_payment(payment_reference uuid, payer_avatar uuid, purchased_plan text, paid_linden integer)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  plan cc_private.directory_plans%rowtype;
  previous cc_private.directory_payments%rowtype;
  current_tier text;
  target_profile uuid;
begin
  if payment_reference is null or payer_avatar is null or payer_avatar = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'invalid_payment';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(payment_reference::text, 1));
  select * into previous from cc_private.directory_payments where payment_id = payment_reference;
  if found then
    if previous.avatar_uuid <> payer_avatar or previous.plan_code is distinct from purchased_plan or previous.amount_linden is distinct from paid_linden then
      raise exception 'payment_reference_conflict';
    end if;
    return cc_private.provision_paid_directory_profile(payer_avatar);
  end if;
  select * into plan from cc_private.directory_plans where code = purchased_plan and enabled;
  if not found or paid_linden is distinct from plan.amount_linden then raise exception 'invalid_payment_plan_or_amount'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(payer_avatar::text, 0));
  select catalogue.tier into current_tier from cc_private.directory_subscriptions as subscription
    join cc_private.directory_plans as catalogue on catalogue.code = subscription.plan_code
    where subscription.avatar_uuid = payer_avatar and (subscription.is_lifetime or subscription.expires_at > now());
  if found and current_tier <> plan.tier then raise exception 'subscription_tier_change_unavailable'; end if;
  insert into cc_private.directory_subscriptions(avatar_uuid, plan_code, expires_at, is_lifetime)
    values (payer_avatar, purchased_plan,
      case when plan.is_lifetime then null else now() + pg_catalog.make_interval(days => plan.duration_days) end, plan.is_lifetime)
    on conflict (avatar_uuid) do update set
      plan_code = case when directory_subscriptions.is_lifetime then directory_subscriptions.plan_code else excluded.plan_code end,
      is_lifetime = directory_subscriptions.is_lifetime or excluded.is_lifetime,
      expires_at = case when directory_subscriptions.is_lifetime or excluded.is_lifetime then null
        else greatest(now(), directory_subscriptions.expires_at) + pg_catalog.make_interval(days => plan.duration_days) end;
  insert into cc_private.directory_payments(payment_id, avatar_uuid, plan_code, amount_linden)
    values (payment_reference, payer_avatar, purchased_plan, paid_linden);
  target_profile := cc_private.provision_paid_directory_profile(payer_avatar);
  return target_profile;
end;
$$;

create function public.queue_directory_reminders()
returns void language sql security definer set search_path = ''
as $$
  insert into cc_private.directory_reminders(avatar_uuid, kind, subscription_expires_at)
    select avatar_uuid, case when expires_at <= now() then 'expired' else 'expiring' end, expires_at
    from cc_private.directory_subscriptions
    where not is_lifetime and suspended_at is null and expires_at <= now() + interval '3 days'
    on conflict (avatar_uuid, kind, subscription_expires_at) do nothing;
$$;

create function public.directory_payment_plans(target_avatar uuid default null)
returns table(code text, tier text, amount_linden integer, duration_days integer, is_lifetime boolean)
language sql stable security definer set search_path = ''
as $$
  select catalogue.code, catalogue.tier, catalogue.amount_linden, catalogue.duration_days, catalogue.is_lifetime
  from cc_private.directory_plans as catalogue
  where catalogue.enabled and catalogue.code in ('basic_monthly', 'basic_lifetime', 'vip_monthly', 'vip_lifetime')
    and not exists (select 1 from cc_private.directory_subscriptions as subscription
      join cc_private.directory_plans as existing on existing.code = subscription.plan_code
      where subscription.avatar_uuid = target_avatar
        and (subscription.suspended_at is not null or subscription.is_lifetime
          or (subscription.expires_at > now() and existing.tier <> catalogue.tier)))
  order by catalogue.code;
$$;

create function public.my_directory_subscriptions()
returns table(avatar_uuid uuid, profile_id uuid, plan_code text, expires_at timestamptz, is_lifetime boolean, is_active boolean)
language sql stable security definer set search_path = ''
as $$
  select subscription.avatar_uuid, subscription.profile_id, subscription.plan_code,
    subscription.expires_at, subscription.is_lifetime,
    cc_private.directory_subscription_active(subscription.avatar_uuid)
  from cc_private.directory_subscriptions as subscription
  join cc_private.verified_avatar_links as identity on identity.avatar_uuid = subscription.avatar_uuid
  where identity.user_id = (select auth.uid()) and identity.revoked_at is null;
$$;

revoke all on function cc_private.directory_subscription_active(uuid), cc_private.directory_profile_paid(uuid), cc_private.provision_paid_directory_profile(uuid), cc_private.provision_after_avatar_verification() from public, anon, authenticated;
grant execute on function cc_private.directory_profile_paid(uuid) to anon, authenticated;
revoke all on function public.register_directory_payment(uuid,uuid,text,integer), public.queue_directory_reminders(), public.my_directory_subscriptions() from public, anon, authenticated;
revoke all on function public.directory_payment_plans(uuid) from public, anon, authenticated;
grant execute on function public.directory_payment_plans(uuid) to service_role;
grant execute on function public.register_directory_payment(uuid,uuid,text,integer), public.queue_directory_reminders() to service_role;
grant execute on function public.my_directory_subscriptions() to authenticated, service_role;

commit;
begin;

alter table cc_private.directory_reminders
  add column claim_token uuid,
  add column claimed_by uuid,
  add column claimed_until timestamptz;
create index directory_reminders_pending_idx on cc_private.directory_reminders(created_at)
  where delivered_at is null;

create function public.claim_directory_reminder(kiosk_id uuid)
returns table(id uuid, claim_token uuid)
language plpgsql security definer set search_path = ''
as $$
declare
  selected_id uuid;
begin
  if kiosk_id is null or kiosk_id = '00000000-0000-0000-0000-000000000000'::uuid then raise exception 'invalid_kiosk'; end if;
  perform public.queue_directory_reminders();
  select reminder.id into selected_id
    from cc_private.directory_reminders as reminder
    join cc_private.directory_subscriptions as subscription on subscription.avatar_uuid = reminder.avatar_uuid
    where reminder.delivered_at is null and (reminder.claimed_until is null or reminder.claimed_until <= now())
      and not subscription.is_lifetime and subscription.suspended_at is null
      and subscription.expires_at = reminder.subscription_expires_at
      and ((reminder.kind = 'expiring' and subscription.expires_at > now() and subscription.expires_at <= now() + interval '3 days')
        or (reminder.kind = 'expired' and subscription.expires_at <= now()))
    order by reminder.created_at, reminder.id
    for update of reminder skip locked limit 1;
  if selected_id is null then return; end if;
  return query update cc_private.directory_reminders as reminder
    set claim_token = gen_random_uuid(), claimed_by = kiosk_id, claimed_until = now() + interval '5 minutes'
    where reminder.id = selected_id returning reminder.id, reminder.claim_token;
end;
$$;

create function public.authorize_directory_reminder(reminder_id uuid, delivery_token uuid, kiosk_id uuid)
returns table(avatar_uuid uuid, kind text, expires_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select reminder.avatar_uuid, reminder.kind, subscription.expires_at
  from cc_private.directory_reminders as reminder
  join cc_private.directory_subscriptions as subscription on subscription.avatar_uuid = reminder.avatar_uuid
  where reminder.id = reminder_id and reminder.claim_token = delivery_token and reminder.claimed_by = kiosk_id
    and reminder.delivered_at is null and reminder.claimed_until > now()
    and not subscription.is_lifetime and subscription.suspended_at is null
    and subscription.expires_at = reminder.subscription_expires_at
    and ((reminder.kind = 'expiring' and subscription.expires_at > now() and subscription.expires_at <= now() + interval '3 days')
      or (reminder.kind = 'expired' and subscription.expires_at <= now()));
$$;

create function public.acknowledge_directory_reminder(reminder_id uuid, delivery_token uuid, kiosk_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  update cc_private.directory_reminders set delivered_at = coalesce(delivered_at, now())
    where id = reminder_id and claim_token = delivery_token and claimed_by = kiosk_id;
  return found;
end;
$$;

revoke all on function public.claim_directory_reminder(uuid), public.authorize_directory_reminder(uuid,uuid,uuid), public.acknowledge_directory_reminder(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.claim_directory_reminder(uuid), public.authorize_directory_reminder(uuid,uuid,uuid), public.acknowledge_directory_reminder(uuid,uuid,uuid) to service_role;

commit;
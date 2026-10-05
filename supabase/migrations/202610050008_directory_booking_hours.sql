begin;

create function cc_private.valid_directory_booking_hours(hours jsonb)
returns boolean language plpgsql immutable set search_path = ''
as $$
declare
  selected_days text[];
  start_minutes integer;
  end_minutes integer;
  window_minutes integer;
begin
  if hours is null then return true; end if;
  if jsonb_typeof(hours) <> 'object' then return false; end if;
  if exists (select 1 from jsonb_object_keys(hours) as field where field not in ('timezone','days','start_time','end_time','slot_minutes','notes')) then return false; end if;
  if jsonb_typeof(hours->'timezone') is distinct from 'string' or (hours->>'timezone') not in ('America/Los_Angeles','America/New_York','Europe/London','Europe/Berlin','Etc/UTC') then return false; end if;
  if jsonb_typeof(hours->'days') is distinct from 'array' then return false; end if;
  if jsonb_array_length(hours->'days') > 7 then return false; end if;
  if exists (select 1 from jsonb_array_elements(hours->'days') as value
    where jsonb_typeof(value) <> 'string' or (value #>> '{}') not in ('mon','tue','wed','thu','fri','sat','sun')) then return false; end if;
  select array_agg(value) into selected_days from jsonb_array_elements_text(hours->'days');
  if cardinality(selected_days) is distinct from (select count(distinct value)::integer from unnest(selected_days) as value)
    and selected_days is not null then return false; end if;
  if jsonb_typeof(hours->'start_time') is distinct from 'string' or (hours->>'start_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return false; end if;
  if jsonb_typeof(hours->'end_time') is distinct from 'string' or (hours->>'end_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return false; end if;
  if jsonb_typeof(hours->'slot_minutes') is distinct from 'number' or (hours->>'slot_minutes') not in ('30','60','120') then return false; end if;
  if jsonb_typeof(hours->'notes') is distinct from 'string' or char_length(hours->>'notes') > 1000 then return false; end if;
  start_minutes := split_part(hours->>'start_time', ':', 1)::integer * 60 + split_part(hours->>'start_time', ':', 2)::integer;
  end_minutes := split_part(hours->>'end_time', ':', 1)::integer * 60 + split_part(hours->>'end_time', ':', 2)::integer;
  if start_minutes = end_minutes then return false; end if;
  window_minutes := (end_minutes - start_minutes + 1440) % 1440;
  if selected_days is not null and window_minutes < (hours->>'slot_minutes')::integer then return false; end if;
  return true;
end;
$$;

revoke all on function cc_private.valid_directory_booking_hours(jsonb) from public;
grant execute on function cc_private.valid_directory_booking_hours(jsonb) to anon, authenticated, service_role;
alter table public.directory_profiles
  add column availability_note text not null default '' check (char_length(availability_note) <= 500),
  add column booking_hours jsonb check (cc_private.valid_directory_booking_hours(booking_hours));
grant update (availability_note, booking_hours) on public.directory_profiles to authenticated;

commit;
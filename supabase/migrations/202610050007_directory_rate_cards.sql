begin;

create function cc_private.valid_directory_rate_categories(categories jsonb)
returns boolean language plpgsql immutable set search_path = ''
as $$
declare
  category jsonb;
  item jsonb;
  identifiers text[] := '{}';
  item_count integer := 0;
begin
  if categories is null or jsonb_typeof(categories) <> 'array' then return false; end if;
  if jsonb_array_length(categories) > 20 or octet_length(categories::text) > 262144 then return false; end if;
  for category in select value from jsonb_array_elements(categories) loop
    if jsonb_typeof(category) <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(category) as field where field not in ('id','title','description','items')) then return false; end if;
    if jsonb_typeof(category->'id') is distinct from 'string' or (category->>'id') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return false; end if;
    if (category->>'id') = any(identifiers) then return false; end if;
    identifiers := array_append(identifiers, category->>'id');
    if jsonb_typeof(category->'title') is distinct from 'string' or char_length(btrim(category->>'title')) not between 1 and 100 then return false; end if;
    if jsonb_typeof(category->'description') is distinct from 'string' or char_length(category->>'description') > 1000 then return false; end if;
    if jsonb_typeof(category->'items') is distinct from 'array' then return false; end if;
    if jsonb_array_length(category->'items') > 30 then return false; end if;
    for item in select value from jsonb_array_elements(category->'items') loop
      item_count := item_count + 1;
      if item_count > 300 or jsonb_typeof(item) <> 'object' then return false; end if;
      if exists (select 1 from jsonb_object_keys(item) as field where field not in ('id','name','price','unit','description')) then return false; end if;
      if jsonb_typeof(item->'id') is distinct from 'string' or (item->>'id') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return false; end if;
      if (item->>'id') = any(identifiers) then return false; end if;
      identifiers := array_append(identifiers, item->>'id');
      if jsonb_typeof(item->'name') is distinct from 'string' or char_length(btrim(item->>'name')) not between 1 and 100 then return false; end if;
      if jsonb_typeof(item->'price') is distinct from 'string' or char_length(item->>'price') > 100 then return false; end if;
      if jsonb_typeof(item->'unit') is distinct from 'string' or char_length(item->>'unit') > 100 then return false; end if;
      if jsonb_typeof(item->'description') is distinct from 'string' or char_length(item->>'description') > 2000 then return false; end if;
    end loop;
  end loop;
  return true;
end;
$$;

revoke all on function cc_private.valid_directory_rate_categories(jsonb) from public;
grant execute on function cc_private.valid_directory_rate_categories(jsonb) to anon, authenticated, service_role;
alter table public.directory_profiles add column rate_categories jsonb not null default '[]'::jsonb
  check (cc_private.valid_directory_rate_categories(rate_categories));
grant update (rate_categories) on public.directory_profiles to authenticated;

commit;
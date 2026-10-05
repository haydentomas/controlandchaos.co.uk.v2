select
  namespace.nspname as schema_name,
  relation.relname as table_name,
  relation.relrowsecurity as rls_enabled
from pg_catalog.pg_class as relation
join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
where (namespace.nspname = 'public' and relation.relname = 'directory_profiles')
   or (namespace.nspname = 'cc_private' and relation.relname in ('verified_avatar_links', 'profile_owners'))
order by schema_name, table_name;

select policyname, roles, cmd
from pg_catalog.pg_policies
where schemaname = 'public' and tablename = 'directory_profiles'
order by policyname;

select
  has_table_privilege('anon', 'public.directory_profiles', 'SELECT') as anon_can_read,
  has_table_privilege('anon', 'public.directory_profiles', 'INSERT') as anon_can_insert,
  has_table_privilege('anon', 'public.directory_profiles', 'UPDATE') as anon_can_update,
  has_column_privilege('authenticated', 'public.directory_profiles', 'display_name', 'UPDATE') as owner_content_update_granted,
  has_column_privilege('authenticated', 'public.directory_profiles', 'is_approved', 'UPDATE') as client_can_approve;
select relation.relname as table_name, relation.relrowsecurity as rls_enabled
from pg_catalog.pg_class as relation
join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
where namespace.nspname = 'cc_private' and relation.relname = 'avatar_verification_challenges';

select
  has_function_privilege('anon', 'public.request_avatar_verification()', 'EXECUTE') as anon_can_request,
  has_function_privilege('authenticated', 'public.request_avatar_verification()', 'EXECUTE') as account_can_request,
  has_function_privilege('authenticated', 'public.consume_avatar_verification(uuid,uuid,text)', 'EXECUTE') as account_can_consume,
  has_function_privilege('service_role', 'public.consume_avatar_verification(uuid,uuid,text)', 'EXECUTE') as server_can_consume,
  has_table_privilege('authenticated', 'cc_private.avatar_verification_challenges', 'SELECT') as account_can_read_all_codes;
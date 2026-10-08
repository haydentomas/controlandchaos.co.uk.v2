select
  to_regclass('cc_private.tribute_settings') is not null as settings_exist,
  to_regclass('cc_private.tribute_payments') is not null as ledger_exists,
  has_function_privilege('anon','public.tribute_public_summary(uuid)','execute') as public_totals_allowed,
  not has_function_privilege('anon','public.tribute_payment(text,uuid,uuid,uuid,integer,text,boolean)','execute') as anonymous_confirmation_denied,
  not has_function_privilege('authenticated','public.tribute_payment(text,uuid,uuid,uuid,integer,text,boolean)','execute') as browser_confirmation_denied,
  has_function_privilege('service_role','public.tribute_payment(text,uuid,uuid,uuid,integer,text,boolean)','execute') as terminal_confirmation_allowed,
  not has_table_privilege('anon','cc_private.tribute_payments','select') as anonymous_ledger_denied,
  not has_table_privilege('authenticated','cc_private.tribute_payments','select') as browser_ledger_denied;

select relname,relrowsecurity
from pg_catalog.pg_class
where oid in ('cc_private.tribute_settings'::regclass,'cc_private.tribute_payments'::regclass);
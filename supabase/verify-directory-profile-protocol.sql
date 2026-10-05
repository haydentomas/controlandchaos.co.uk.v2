select
  has_column_privilege('anon', 'public.directory_profiles', 'boundaries', 'UPDATE') as anon_can_edit_boundaries,
  has_column_privilege('authenticated', 'public.directory_profiles', 'boundaries', 'UPDATE') as account_can_edit_boundaries,
  has_column_privilege('authenticated', 'public.directory_profiles', 'booking_instructions', 'UPDATE') as account_can_edit_instructions,
  has_function_privilege('anon', 'public.save_directory_profile_media(uuid,jsonb,jsonb)', 'EXECUTE') as anon_can_save_media,
  has_function_privilege('authenticated', 'public.save_directory_profile_media(uuid,jsonb,jsonb)', 'EXECUTE') as account_can_save_media;

select column_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'directory_profiles'
  and column_name in ('boundaries', 'booking_instructions')
order by column_name;

select
  has_function_privilege('anon', 'public.directory_booking_recipient(uuid)', 'EXECUTE') as anon_can_resolve_booking_email,
  has_function_privilege('authenticated', 'public.directory_booking_recipient(uuid)', 'EXECUTE') as account_can_resolve_booking_email,
  has_function_privilege('service_role', 'public.directory_booking_recipient(uuid)', 'EXECUTE') as server_can_resolve_booking_email,
  has_function_privilege('anon', 'public.my_directory_booking_contact(uuid)', 'EXECUTE') as anon_can_read_booking_contact,
  has_function_privilege('authenticated', 'public.my_directory_booking_contact(uuid)', 'EXECUTE') as account_can_read_booking_contact,
  has_function_privilege('anon', 'public.save_directory_profile_booking(uuid,jsonb,jsonb,text)', 'EXECUTE') as anon_can_save_booking_profile,
  has_function_privilege('authenticated', 'public.save_directory_profile_booking(uuid,jsonb,jsonb,text)', 'EXECUTE') as account_can_save_booking_profile,
  has_column_privilege('anon', 'public.directory_gallery_photos', 'show_in_sidebar', 'UPDATE') as anon_can_change_sidebar_gallery,
  has_column_privilege('authenticated', 'public.directory_gallery_photos', 'show_in_sidebar', 'UPDATE') as account_can_change_sidebar_gallery_directly;

select
  has_column_privilege('anon', 'public.directory_profiles', 'hardware_title', 'UPDATE') as anon_can_edit_hardware,
  has_column_privilege('authenticated', 'public.directory_profiles', 'hardware_title', 'UPDATE') as account_can_edit_hardware,
  has_column_privilege('anon', 'public.directory_profiles', 'hardware_compat', 'UPDATE') as anon_can_edit_hardware_items,
  has_column_privilege('authenticated', 'public.directory_profiles', 'hardware_compat', 'UPDATE') as account_can_edit_hardware_items,
  has_column_privilege('anon', 'public.directory_profiles', 'wishlist_title', 'UPDATE') as anon_can_edit_wishlist,
  has_column_privilege('authenticated', 'public.directory_profiles', 'wishlist_title', 'UPDATE') as account_can_edit_wishlist,
  has_column_privilege('anon', 'public.directory_profiles', 'wishlist', 'UPDATE') as anon_can_edit_wishlist_items,
  has_column_privilege('authenticated', 'public.directory_profiles', 'wishlist', 'UPDATE') as account_can_edit_wishlist_items;
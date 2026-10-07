select
  has_function_privilege('anon', 'public.creator_blog_public_offer(uuid)', 'EXECUTE') as anon_can_read_creator_offer,
  has_function_privilege('anon', 'public.creator_blog_feed_v2(uuid)', 'EXECUTE') as anon_can_read_public_blog_feed,
  has_function_privilege('anon', 'public.save_directory_profile_media(uuid,jsonb,jsonb)', 'EXECUTE') as anon_can_save_gallery,
  has_function_privilege('authenticated', 'public.save_directory_profile_media(uuid,jsonb,jsonb)', 'EXECUTE') as account_can_save_gallery,
  has_function_privilege('anon', 'public.creator_blog_prepare_payment(uuid,uuid,uuid,integer)', 'EXECUTE') as anon_can_prepare_creator_payment,
  has_function_privilege('service_role', 'public.creator_blog_prepare_payment(uuid,uuid,uuid,integer)', 'EXECUTE') as terminal_can_prepare_creator_payment;

select plan.code, plan.tier
from cc_private.directory_plans as plan
where plan.code in ('basic_monthly', 'basic_lifetime', 'vip_monthly', 'vip_lifetime')
order by plan.code;

select trigger_name, event_manipulation, event_object_table
from information_schema.triggers
where trigger_schema in ('public', 'cc_private')
  and trigger_name in (
    'directory_gallery_basic_overflow_guard',
    'directory_gallery_photo_limit',
    'directory_profile_vip_creator_offer',
    'creator_blog_posts_vip_only',
    'creator_blog_content_vip_only'
  )
order by event_object_table, trigger_name;

select schemaname, tablename, policyname, cmd
from pg_catalog.pg_policies
where (schemaname = 'public' and tablename = 'directory_gallery_photos')
   or (schemaname = 'storage' and tablename = 'objects' and policyname like 'directory_gallery_%')
order by schemaname, tablename, policyname;

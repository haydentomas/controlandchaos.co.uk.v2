-- Read-only checks after applying migration 15. All booleans should be true.
select
  exists(select 1 from information_schema.columns
    where table_schema='cc_private' and table_name='creator_blog_post_content' and column_name='attachments') as attachments_column_exists,
  to_regprocedure('public.creator_blog_editor_posts_v2(uuid)') is not null as editor_rpc_exists,
  to_regprocedure('public.creator_blog_feed_v2(uuid)') is not null as feed_rpc_exists,
  to_regprocedure('public.creator_blog_save_all_v2(uuid,integer,text,jsonb)') is not null as save_rpc_exists,
  exists(select 1 from storage.buckets where id='creator-blog-media' and public=false) as media_bucket_private;

select
  not has_function_privilege('anon','public.creator_blog_editor_posts_v2(uuid)','execute') as anonymous_editor_denied,
  has_function_privilege('authenticated','public.creator_blog_editor_posts_v2(uuid)','execute') as authenticated_editor_allowed,
  has_function_privilege('anon','public.creator_blog_feed_v2(uuid)','execute') as anonymous_redacted_feed_allowed,
  not has_function_privilege('anon','public.creator_blog_save_all_v2(uuid,integer,text,jsonb)','execute') as anonymous_save_denied,
  has_function_privilege('authenticated','public.creator_blog_save_all_v2(uuid,integer,text,jsonb)','execute') as authenticated_save_allowed,
  not has_function_privilege('authenticated','cc_private.creator_blog_save_post_legacy(uuid,jsonb)','execute') as legacy_helper_direct_access_denied,
  not has_table_privilege('anon','cc_private.creator_blog_post_content','select') as anonymous_private_content_denied,
  not has_table_privilege('authenticated','cc_private.creator_blog_post_content','select') as authenticated_private_content_denied;

select
  count(*) filter (where content.media_path<>'' or content.media_url<>'') as posts_with_existing_media,
  count(*) filter (where content.media_path<>'' or content.media_url<>'')
    = count(*) filter (where (content.media_path<>'' or content.media_url<>'') and jsonb_array_length(content.attachments)>0) as existing_media_backfilled,
  coalesce(bool_and(jsonb_array_length(content.attachments)<=10),true) as all_attachment_counts_valid
from cc_private.creator_blog_post_content as content;

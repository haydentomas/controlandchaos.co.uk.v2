with gallery_cap as (
	select count(*) as profiles_over_gallery_cap
	from (
		select profile_id
		from public.directory_gallery_photos
		group by profile_id
		having count(*) > 20
	) as over_cap
)
select
	(
		select jsonb_build_object(
			'id', id,
			'public', public,
			'file_size_limit', file_size_limit,
			'allowed_mime_types', allowed_mime_types
		)
		from storage.buckets
		where id = 'directory-gallery'
	) as bucket,
	gallery_cap.profiles_over_gallery_cap,
	has_function_privilege('anon', 'cc_private.can_upload_directory_gallery_object(text)', 'EXECUTE') as anon_can_upload,
	has_function_privilege('authenticated', 'cc_private.can_upload_directory_gallery_object(text)', 'EXECUTE') as account_can_request_upload,
	has_function_privilege('service_role', 'cc_private.can_upload_directory_gallery_object(text)', 'EXECUTE') as server_can_check_upload,
	(
		select coalesce(
			jsonb_agg(jsonb_build_object('name', conname, 'definition', pg_get_constraintdef(oid)) order by conname),
			'[]'::jsonb
		)
		from pg_constraint
		where conrelid = 'public.directory_gallery_photos'::regclass
			and conname in (
				'directory_gallery_photos_storage_owner_path_check',
				'directory_gallery_photos_storage_photo_path_check',
				'directory_gallery_photos_source_check'
			)
	) as gallery_constraints,
	(
		select coalesce(array_agg(tgname::text order by tgname), array[]::text[])
		from pg_trigger
		where tgrelid = 'public.directory_gallery_photos'::regclass
			and not tgisinternal
			and tgname = 'directory_gallery_photo_limit'
	) as gallery_limit_triggers,
	(
		select coalesce(
			jsonb_agg(jsonb_build_object('name', policyname, 'roles', roles, 'command', cmd) order by policyname),
			'[]'::jsonb
		)
		from pg_policies
		where schemaname = 'storage'
			and tablename = 'objects'
			and policyname like 'directory_gallery_%'
	) as storage_policies
from gallery_cap;

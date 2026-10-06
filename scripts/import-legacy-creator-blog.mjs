import fs from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const sourceUrl = new URL('../../main/directory/profiles.json', import.meta.url);
const apply = process.argv.includes('--apply');
const legacyProfiles = JSON.parse(await fs.readFile(sourceUrl, 'utf8'));
if (!Array.isArray(legacyProfiles)) throw new Error('Expected the V1 directory profile array.');

const profiles = legacyProfiles.filter(profile =>
  profile && typeof profile.avatar_uuid === 'string'
  && (Array.isArray(profile.posts) || Array.isArray(profile.blog_posts))
  && ((profile.posts?.length || 0) + (profile.blog_posts?.length || 0) > 0)
);

const summaries = profiles.map(profile => ({
  creator: profile.sl_username || profile.name || profile.avatar_uuid,
  feedPosts: profile.posts?.length || 0,
  publicBlogPosts: profile.blog_posts?.length || 0,
  locked: (profile.posts || []).filter(post => post?.is_locked === true).length,
  lockedMediaNeedsReupload: (profile.posts || []).filter(post => post?.is_locked === true && post?.media_url).length,
  monthlyLinden: Number(String(profile.fan_tier_price || '').replace(/[^0-9]/g, '')) || 0
}));

if (!apply) {
  console.log('Dry run only. No data was sent to Supabase.');
  console.table(summaries);
  console.log('Review the import, then rerun with --apply after migration 14 is installed.');
} else {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret?.startsWith('sb_secret_')) throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in the local environment before using --apply.');
  const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  let imported = 0;
  for (const profile of profiles) {
    const { data, error } = await client.rpc('creator_blog_import_legacy', {
      target_creator_avatar: profile.avatar_uuid,
      legacy_profile: profile
    });
    if (error || !Array.isArray(data) || !data[0]) throw new Error(`Import failed for ${profile.sl_username || profile.avatar_uuid}. Rerun is safe after resolving the migration/profile mapping.`);
    imported += data[0].imported_posts;
    console.log(`${profile.sl_username || profile.avatar_uuid}: ${data[0].imported_posts} posts imported; ${data[0].locked_media_reupload} locked media files need private re-upload.`);
  }
  console.log(`Imported ${imported} posts across ${profiles.length} V1 creators. Re-running is idempotent by legacy post ID.`);
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { blogAttachments, validateBlogAttachments, missingBlogV2Rpc } from '../src/modules/creator-blog-media.js';

const owner = '11111111-1111-4111-8111-111111111111';
const fan = '22222222-2222-4222-8222-222222222222';
const avatar = '33333333-3333-4333-8333-333333333333';
const fanAvatar = '44444444-4444-4444-8444-444444444444';
const postId = '55555555-5555-4555-8555-555555555555';
const id = index => `${String(index).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;

test('attachment validation enforces ten mixed items, exact sources and private subscriber media', () => {
  const post = { id: postId, access_level: 'public' };
  const attachments = Array.from({ length: 10 }, (_, index) => ({ id: id(index), media_type: ['image','audio','video'][index % 3], media_path: '', media_url: `https://example.test/${index}` }));
  assert.equal(validateBlogAttachments(attachments, post).length, 10);
  assert.throws(() => validateBlogAttachments([...attachments, { ...attachments[0], id: id(11) }], post), /10 attachments/);
  assert.throws(() => validateBlogAttachments([attachments[0], attachments[0]], post), /identifiers/);
  assert.throws(() => validateBlogAttachments(attachments, { ...post, access_level: 'subscribers' }), /privately/);
  assert.throws(() => validateBlogAttachments([{ ...attachments[0], media_url: 'https://user:pass@example.test/media' }], post), /safe HTTPS/);
  assert.throws(() => validateBlogAttachments([{ ...attachments[0], media_url: '' }], post), /needs a private/);
  assert.deepEqual(blogAttachments({ ...post, attachments: [] }), []);
  assert.equal(blogAttachments({ ...post, media_type: 'image', media_path: 'legacy' }).length, 1);
  assert.equal(missingBlogV2Rpc({ code: '42501' }), false);
  assert.equal(missingBlogV2Rpc({ code: 'PGRST202' }), true);
});

test('migration 15 preserves existing media, validates atomic mixed saves and protects every attachment', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(bucket_id text,name text,primary key(bucket_id,name)); alter table storage.objects enable row level security;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth,storage to anon,authenticated,service_role;
      grant select,insert,delete on storage.objects to anon,authenticated,service_role;`);
    for (const file of ['202610040001_directory_foundation.sql','202610040002_avatar_verification.sql','202610050003_directory_subscriptions.sql','202610060014_creator_blog_subscriptions.sql']) {
      await db.exec(await fs.readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    }
    await db.query('insert into auth.users values ($1,$2,now()),($3,$4,now())', [owner,'owner@example.test',fan,'fan@example.test']);
    await db.query('insert into cc_private.verified_avatar_links(avatar_uuid,user_id,sl_username) values ($1,$2,$3),($4,$5,$6)', [avatar,owner,'creator.resident',fanAvatar,fan,'fan.resident']);
    await db.exec("update cc_private.directory_plans set enabled=true,amount_linden=1 where code='basic_monthly'");
    const profile = (await db.query('select public.register_directory_payment($1,$2,$3,$4) as id', [id(90),avatar,'basic_monthly',1])).rows[0].id;
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.exec('set role authenticated');
    await db.query('update public.directory_profiles set is_published=true where id=$1', [profile]);
    const path = index => `${profile}/${postId}/${id(index)}.${['webp','mp3','mp4'][index % 3]}`;
    const oldPost = { id: postId, post_type: 'post', access_level: 'subscribers', title: 'Mixed private post', teaser: 'Teaser only', body_markdown: 'Private body', media_type: 'image', media_path: path(0), media_url: '', is_published: true };
    await db.query('select public.creator_blog_save_all($1,1500,$2,$3::jsonb)', [profile,'Benefits',JSON.stringify([oldPost])]);
    await db.exec('reset role');
    await db.exec(await fs.readFile(new URL('../supabase/migrations/202610060015_creator_blog_attachments.sql', import.meta.url), 'utf8'));
    const preserved = (await db.query('select attachments from public.creator_blog_editor_posts_v2($1)', [profile])).rows[0].attachments;
    assert.equal(preserved.length, 1);
    assert.equal(preserved[0].media_path, path(0));
    await db.exec('set role authenticated');
    const attachments = Array.from({ length: 10 }, (_, index) => ({ id: id(index), media_type: ['image','audio','video'][index % 3], media_path: path(index), media_url: '' }));
    const mixed = { ...oldPost, attachments };
    const save = post => db.query('select public.creator_blog_save_all_v2($1,1500,$2,$3::jsonb)', [profile,'Benefits',JSON.stringify([post])]);
    for (const item of attachments) await db.query('insert into storage.objects values ($1,$2)', ['creator-blog-media',item.media_path]);
    await save(mixed);
    assert.deepEqual((await db.query('select attachments from public.creator_blog_editor_posts_v2($1)', [profile])).rows[0].attachments, attachments);
    await db.query('select public.creator_blog_save_post($1,$2::jsonb)', [profile,JSON.stringify({ ...oldPost, title: 'Legacy title edit' })]);
    assert.deepEqual((await db.query('select attachments from public.creator_blog_editor_posts_v2($1)', [profile])).rows[0].attachments, attachments);
    await assert.rejects(db.query('select public.creator_blog_save_post($1,$2::jsonb)', [profile,JSON.stringify({ ...oldPost, media_path: '' })]), /use_multi_attachment_editor/);
    for (const invalid of [
      [...attachments, { ...attachments[0], id: id(11) }],
      [attachments[0], attachments[0]],
      [{ ...attachments[0], media_path: `${fanAvatar}/${postId}/${id(0)}.webp` }],
      [{ ...attachments[0], media_path: `${profile}/${id(88)}/${id(0)}.webp` }],
      [{ ...attachments[0], media_url: 'https://example.test/public', media_path: '' }],
      [{ ...attachments[0], media_type: 'audio' }],
      [{ ...attachments[0], unexpected: true }],
      null
    ]) {
      await assert.rejects(save({ ...mixed, attachments: invalid }), /invalid_creator_attachments|locked_media_requires_private_storage/);
    }
    assert.equal((await db.query('select attachments from public.creator_blog_editor_posts_v2($1)', [profile])).rows[0].attachments.length, 10);
    await assert.rejects(db.query('select public.creator_blog_save_all_v2($1,999,$2,$3::jsonb)', [profile,'Changed',JSON.stringify([{ ...mixed, attachments: null }])]), /invalid_creator_attachments/);
    assert.equal((await db.query('select creator_blog_monthly_linden from public.directory_profiles where id=$1', [profile])).rows[0].creator_blog_monthly_linden, 1500);
    await db.exec("reset role; select set_config('request.jwt.claim.sub','',false); set role anon");
    const locked = (await db.query('select * from public.creator_blog_feed_v2($1)', [profile])).rows[0];
    assert.equal(locked.attachments, null);
    assert.equal(locked.body_markdown, null);
    assert.equal(locked.media_path, null);
    assert.equal((await db.query("select * from storage.objects where bucket_id='creator-blog-media'")).rows.length, 0);
    await assert.rejects(db.query('select * from public.creator_blog_editor_posts_v2($1)', [profile]), /permission denied/);
    await assert.rejects(db.query('select * from cc_private.creator_blog_post_content'), /permission denied/);
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [fan]);
    await db.exec('set role authenticated');
    await assert.rejects(save(mixed), /profile_access_denied/);
    await db.exec('reset role');
    await db.query('insert into cc_private.creator_content_subscriptions(fan_avatar_uuid,creator_profile_id,creator_avatar_uuid,expires_at) values ($1,$2,$3,now()+interval \'30 days\')', [fanAvatar,profile,avatar]);
    await db.exec('set role authenticated');
    assert.equal((await db.query('select attachments from public.creator_blog_feed_v2($1)', [profile])).rows[0].attachments.length, 10);
    assert.equal((await db.query("select * from storage.objects where bucket_id='creator-blog-media'")).rows.length, 10);
    await db.exec('reset role');
    await db.query('update cc_private.creator_content_subscriptions set expires_at=now()-interval \'1 second\'');
    await db.exec('set role authenticated');
    assert.equal((await db.query('select attachments from public.creator_blog_feed_v2($1)', [profile])).rows[0].attachments, null);
    assert.equal((await db.query("select * from storage.objects where bucket_id='creator-blog-media'")).rows.length, 0);
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.exec('set role authenticated');
    await save({ ...mixed, attachments: [attachments[2],attachments[0]] });
    assert.deepEqual((await db.query('select attachments from public.creator_blog_editor_posts_v2($1)', [profile])).rows[0].attachments, [attachments[2],attachments[0]]);
    await save({ ...mixed, attachments: [] });
    const empty = (await db.query('select * from public.creator_blog_editor_posts_v2($1)', [profile])).rows[0];
    assert.deepEqual(empty.attachments, []);
    assert.equal(empty.media_path, '');
    await db.exec('reset role');
    const checks = await db.exec(await fs.readFile(new URL('../supabase/verify-creator-blog-attachments.sql', import.meta.url), 'utf8'));
    for (const result of checks.slice(0,2)) assert.ok(Object.values(result.rows[0]).every(value => value === true));
    assert.equal(checks[2].rows[0].existing_media_backfilled, true);
  } finally { await db.close(); }
});

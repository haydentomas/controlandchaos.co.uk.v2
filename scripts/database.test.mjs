import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await fs.readFile(new URL('../supabase/migrations/202610040001_directory_foundation.sql', import.meta.url), 'utf8');
const verification = await fs.readFile(new URL('../supabase/verify-directory.sql', import.meta.url), 'utf8');
const demoSeed = await fs.readFile(new URL('../supabase/seed-directory-demo.sql', import.meta.url), 'utf8');
const owner = '11111111-1111-4111-8111-111111111111';
const stranger = '22222222-2222-4222-8222-222222222222';
const avatar = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ownedProfile = '33333333-3333-4333-8333-333333333333';
const publicProfile = '44444444-4444-4444-8444-444444444444';

test('directory migration enforces public, owner and privileged-column permissions in Postgres', async context => {
  const database = new PGlite();
  try {
    await database.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;
    `);
    await database.exec(migration);
    await database.query('insert into auth.users(id) values ($1), ($2)', [owner, stranger]);
    await database.query('insert into cc_private.verified_avatar_links(avatar_uuid, user_id) values ($1, $2)', [avatar, owner]);
    await database.query(`insert into public.directory_profiles(id, slug, display_name, sl_username, role_type, is_approved, is_published) values
      ($1, 'owner-draft', 'Owner Draft', 'owner.resident', 'sub', false, false),
      ($2, 'public-example', 'Public Example', 'example.resident', 'domme', true, true)`, [ownedProfile, publicProfile]);
    await database.query('insert into cc_private.profile_owners(profile_id, user_id, avatar_uuid) values ($1, $2, $3)', [ownedProfile, owner, avatar]);

    const actAs = async (role, identity = '') => {
      await database.exec('reset role');
      await database.query("select set_config('request.jwt.claim.sub', $1, false)", [identity]);
      await database.exec(`set role ${role}`);
    };
    const denied = statement => assert.rejects(database.query(statement), error => error.code === '42501');

    await context.test('anonymous visitors read only approved published content and cannot write', async () => {
      await actAs('anon');
      assert.deepEqual((await database.query('select slug from public.directory_profiles order by slug')).rows, [{ slug: 'public-example' }]);
      await denied("insert into public.directory_profiles(slug,display_name,sl_username,role_type) values ('fake','Fake','fake.resident','sub')");
      await denied("update public.directory_profiles set display_name = 'Changed'");
      await denied('delete from public.directory_profiles');
      await denied('select * from cc_private.profile_owners');
      await denied('select * from cc_private.verified_avatar_links');
    });

    await context.test('verified owner reads a draft and can update content without auto-approval', async () => {
      await actAs('authenticated', owner);
      assert.equal((await database.query('select id from public.directory_profiles')).rows.length, 2);
      const updated = await database.query('update public.directory_profiles set display_name = $1, is_published = true where id = $2 returning display_name, is_approved', ['Updated Owner', ownedProfile]);
      assert.deepEqual(updated.rows, [{ display_name: 'Updated Owner', is_approved: false }]);
      await actAs('anon');
      assert.equal((await database.query('select id from public.directory_profiles')).rows.length, 1);
    });

    await context.test('another signed-in account cannot read or modify the owner draft', async () => {
      await actAs('authenticated', stranger);
      assert.deepEqual((await database.query('select slug from public.directory_profiles')).rows, [{ slug: 'public-example' }]);
      assert.equal((await database.query('update public.directory_profiles set display_name = $1 where id = $2 returning id', ['Stolen', ownedProfile])).rows.length, 0);
      assert.equal((await database.query('update public.directory_profiles set display_name = $1 where id = $2 returning id', ['Stolen', publicProfile])).rows.length, 0);
      await actAs('authenticated', owner);
      assert.equal((await database.query('select display_name from public.directory_profiles where id = $1', [ownedProfile])).rows[0].display_name, 'Updated Owner');
    });

    await context.test('owners cannot modify approval, prominence, IDs or verified identity', async () => {
      await actAs('authenticated', owner);
      for (const assignment of ["is_approved = true", "is_featured = true", "slug = 'stolen-slug'", "sl_username = 'different.resident'", `id = '${publicProfile}'`, "created_at = now()", "updated_at = now()"]) {
        await denied(`update public.directory_profiles set ${assignment} where id = '${ownedProfile}'`);
      }
      await denied(`insert into cc_private.verified_avatar_links(avatar_uuid,user_id) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','${owner}')`);
      await denied(`update cc_private.profile_owners set user_id = '${stranger}'`);
      await denied(`delete from public.directory_profiles where id = '${ownedProfile}'`);
    });

    await context.test('revoked avatar ownership disables creator reads and writes', async () => {
      await actAs('postgres');
      await database.query('update cc_private.verified_avatar_links set revoked_at = now() where avatar_uuid = $1', [avatar]);
      await actAs('authenticated', owner);
      assert.equal((await database.query('select id from public.directory_profiles where id = $1', [ownedProfile])).rows.length, 0);
      assert.equal((await database.query('update public.directory_profiles set display_name = $1 where id = $2 returning id', ['Revoked change', ownedProfile])).rows.length, 0);
      await actAs('postgres');
      assert.equal((await database.query('select display_name from public.directory_profiles where id = $1', [ownedProfile])).rows[0].display_name, 'Updated Owner');
    });

    await context.test('privileged setup can approve profiles and constraints reject unsafe content', async () => {
      await actAs('service_role');
      assert.equal((await database.query('update public.directory_profiles set is_approved = true where id = $1 returning id', [ownedProfile])).rows.length, 1);
      await actAs('anon');
      assert.equal((await database.query('select id from public.directory_profiles')).rows.length, 2);
      await actAs('postgres');
      await assert.rejects(database.query("update public.directory_profiles set avatar_image = 'javascript:alert(1)' where id = $1", [ownedProfile]), error => error.code === '23514');
      await assert.rejects(database.query("update public.directory_profiles set role_type = 'admin' where id = $1", [ownedProfile]), error => error.code === '23514');
      const tables = await database.query("select relname, relrowsecurity from pg_class where relname in ('directory_profiles','verified_avatar_links','profile_owners')");
      assert.equal(tables.rows.length, 3);
      assert.ok(tables.rows.every(table => table.relrowsecurity));
      const results = await database.exec(verification);
      assert.equal(results[0].rows.length, 3);
      assert.ok(results[0].rows.every(table => table.rls_enabled));
      assert.equal(results[1].rows.length, 3);
      assert.deepEqual(results[2].rows, [{ anon_can_read: true, anon_can_insert: false, anon_can_update: false, owner_content_update_granted: true, client_can_approve: false }]);
      await database.exec(demoSeed);
      await database.exec(demoSeed);
      assert.equal((await database.query("select id from public.directory_profiles where slug in ('demo-dominant','demo-submissive')")).rows.length, 2);
      assert.equal((await database.query("select profile_id from cc_private.profile_owners where profile_id in (select id from public.directory_profiles where slug like 'demo-%')")).rows.length, 0);
      await actAs('anon');
      assert.equal((await database.query("select id from public.directory_profiles where slug = 'demo-unpublished-control'")).rows.length, 0);
    });
  } finally {
    await database.close();
  }
});
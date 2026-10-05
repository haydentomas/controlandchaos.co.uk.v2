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

test('paid directory access provisions automatically and enforces expiry in Postgres', async context => {
  const database = new PGlite();
  const pendingAvatar = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
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
    for (const filename of ['202610040002_avatar_verification.sql', '202610050003_directory_subscriptions.sql']) {
      await database.exec(await fs.readFile(new URL(`../supabase/migrations/${filename}`, import.meta.url), 'utf8'));
    }
    await database.query('insert into auth.users(id) values ($1), ($2)', [owner, stranger]);
    assert.deepEqual((await database.query('select * from public.directory_payment_plans()')).rows, []);
    await database.exec(`insert into cc_private.directory_plans(code, amount_linden, duration_days, is_lifetime, enabled)
      values ('monthly', 100, 30, false, true), ('lifetime', 1000, null, true, true)`);
    await database.query('insert into cc_private.verified_avatar_links(avatar_uuid,user_id,sl_username) values ($1,$2,$3)', [avatar, owner, 'owner.resident']);
    const actAs = async (role, identity = '') => {
      await database.exec('reset role');
      await database.query("select set_config('request.jwt.claim.sub', $1, false)", [identity]);
      await database.exec(`set role ${role}`);
    };
    const pay = (reference, target = avatar, plan = 'monthly', amount = 100) => database.query(
      'select public.register_directory_payment($1,$2,$3,$4) as profile', [reference, target, plan, amount]);
    let profile;
    let expiry;
    await context.test('clients cannot grant access or read private billing records', async () => {
      for (const role of ['anon', 'authenticated']) {
        await actAs(role, owner);
        await assert.rejects(pay(ownedProfile), error => error.code === '42501');
        await assert.rejects(database.query('select * from public.directory_payment_plans($1)', [avatar]), error => error.code === '42501');
        await assert.rejects(database.query('select * from cc_private.directory_payments'), error => error.code === '42501');
        await assert.rejects(database.query('select public.queue_directory_reminders()'), error => error.code === '42501');
      }
    });
    await context.test('four unpriced plans reject sales and configured plans use server-defined tiers', async () => {
      await actAs('service_role');
      assert.deepEqual((await database.query('select code,amount_linden,enabled from cc_private.directory_plans where code like $1 order by code', ['%_%'])).rows.filter(plan => plan.code.includes('_')), [
        { code: 'basic_lifetime', amount_linden: null, enabled: false },
        { code: 'basic_monthly', amount_linden: null, enabled: false },
        { code: 'vip_lifetime', amount_linden: null, enabled: false },
        { code: 'vip_monthly', amount_linden: null, enabled: false }
      ]);
      await assert.rejects(pay(ownedProfile, avatar, 'basic_monthly', 100), /invalid_payment_plan_or_amount/);
      await assert.rejects(database.query("update cc_private.directory_plans set enabled=true where code='basic_monthly'"), error => error.code === '23514');
      await database.exec("update cc_private.directory_plans set amount_linden=case when is_lifetime then 1000 else 100 end, enabled=true where code in ('basic_monthly','basic_lifetime','vip_monthly','vip_lifetime')");
      assert.equal((await database.query('select * from public.directory_payment_plans($1)', [avatar])).rows.length, 4);
    });
    await context.test('payment creates approved draft and owner, but retries do not add time', async () => {
      await actAs('service_role');
      profile = (await pay(ownedProfile)).rows[0].profile;
      expiry = (await database.query('select expires_at from cc_private.directory_subscriptions where avatar_uuid=$1', [avatar])).rows[0].expires_at;
      assert.equal((await pay(ownedProfile)).rows[0].profile, profile);
      assert.equal((await database.query('select expires_at from cc_private.directory_subscriptions where avatar_uuid=$1', [avatar])).rows[0].expires_at.getTime(), expiry.getTime());
      await assert.rejects(pay(ownedProfile, pendingAvatar), /payment_reference_conflict/);
      await assert.rejects(pay(publicProfile, avatar, 'monthly', 1), /invalid_payment_plan_or_amount/);
      await actAs('authenticated', owner);
      assert.equal((await database.query('select profile_id,is_active from public.my_directory_subscriptions()')).rows[0].is_active, true);
      assert.equal((await database.query('update public.directory_profiles set is_published=true, about=$1 where id=$2 returning is_approved', ['Preserved content', profile])).rows[0].is_approved, true);
      await assert.rejects(database.query('update public.directory_profiles set is_approved=false'), error => error.code === '42501');
      await actAs('anon');
      assert.equal((await database.query('select id from public.directory_profiles')).rows.length, 1);
      await actAs('service_role');
      assert.deepEqual((await database.query('select code from public.directory_payment_plans($1)', [avatar])).rows, [{ code: 'basic_lifetime' }, { code: 'basic_monthly' }]);
      await assert.rejects(pay('abababab-abab-4bab-8bab-abababababab', avatar, 'vip_lifetime', 1000), /subscription_tier_change_unavailable/);
      await actAs('authenticated', stranger);
      assert.equal((await database.query('select * from public.my_directory_subscriptions()')).rows.length, 0);
      assert.equal((await database.query('update public.directory_profiles set about=$1 where id=$2 returning id', ['Stolen', profile])).rows.length, 0);
    });
    await context.test('renewal extends existing time and expired access is denied without an audit', async () => {
      await actAs('service_role');
      await pay(publicProfile);
      const renewed = (await database.query('select expires_at from cc_private.directory_subscriptions where avatar_uuid=$1', [avatar])).rows[0].expires_at;
      assert.equal(renewed.getTime() - expiry.getTime(), 30 * 86400000);
      await database.query("update cc_private.directory_subscriptions set expires_at=now()-interval '1 second' where avatar_uuid=$1", [avatar]);
      await actAs('anon');
      assert.equal((await database.query('select id from public.directory_profiles')).rows.length, 0);
      await actAs('authenticated', owner);
      assert.equal((await database.query('update public.directory_profiles set about=$1 where id=$2 returning id', ['Expired edit', profile])).rows.length, 0);
      assert.equal((await database.query('select is_active from public.my_directory_subscriptions()')).rows[0].is_active, false);
      assert.equal((await database.query('select * from public.my_verified_avatars()')).rows.length, 1);
      await actAs('service_role');
      await pay('55555555-5555-4555-8555-555555555555');
      await actAs('authenticated', owner);
      assert.equal((await database.query('select about from public.directory_profiles where id=$1', [profile])).rows[0].about, 'Preserved content');
    });
    await context.test('payment before signup provisions when avatar verification completes', async () => {
      await actAs('service_role');
      assert.equal((await pay('66666666-6666-4666-8666-666666666666', pendingAvatar)).rows[0].profile, null);
      await database.query('insert into cc_private.verified_avatar_links(avatar_uuid,user_id,sl_username) values ($1,$2,$3)', [pendingAvatar, stranger, 'pending.resident']);
      assert.ok((await database.query('select profile_id from cc_private.directory_subscriptions where avatar_uuid=$1', [pendingAvatar])).rows[0].profile_id);
    });
    await context.test('reminders are deduplicated and lifetime access survives monthly purchases', async () => {
      await actAs('service_role');
      await database.query("update cc_private.directory_subscriptions set expires_at=now()+interval '2 days' where avatar_uuid=$1", [avatar]);
      await database.exec('select public.queue_directory_reminders(); select public.queue_directory_reminders()');
      assert.equal((await database.query('select kind from cc_private.directory_reminders')).rows.length, 1);
      await database.query("update cc_private.directory_subscriptions set expires_at=now()-interval '1 second' where avatar_uuid=$1", [avatar]);
      await database.exec('select public.queue_directory_reminders(); select public.queue_directory_reminders()');
      assert.deepEqual((await database.query('select kind from cc_private.directory_reminders order by kind')).rows, [{ kind: 'expired' }, { kind: 'expiring' }]);
      await pay('77777777-7777-4777-8777-777777777777', avatar, 'lifetime', 1000);
      await pay('88888888-8888-4888-8888-888888888888');
      assert.deepEqual((await database.query('select is_lifetime,expires_at from cc_private.directory_subscriptions where avatar_uuid=$1', [avatar])).rows, [{ is_lifetime: true, expires_at: null }]);
      assert.deepEqual((await database.query('select * from public.directory_payment_plans($1)', [avatar])).rows, []);
      await database.query('update cc_private.directory_subscriptions set suspended_at=now() where avatar_uuid=$1', [avatar]);
      await pay('99999999-9999-4999-8999-999999999999');
      await actAs('authenticated', owner);
      assert.equal((await database.query('select is_active from public.my_directory_subscriptions()')).rows[0].is_active, false);
    });
  } finally {
    await database.close();
  }
});

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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { parseHTML } from 'linkedom';
import { createVerificationHandler } from '../netlify/functions/verify-avatar.mjs';
import { initAvatarVerification, requestAvatarChallenge, verifiedAvatars } from '../src/modules/avatar-verification.js';

const foundation = await fs.readFile(new URL('../supabase/migrations/202610040001_directory_foundation.sql', import.meta.url), 'utf8');
const verification = await fs.readFile(new URL('../supabase/migrations/202610040002_avatar_verification.sql', import.meta.url), 'utf8');
const verifySql = await fs.readFile(new URL('../supabase/verify-avatar-verification.sql', import.meta.url), 'utf8');
const owner = '11111111-1111-4111-8111-111111111111';
const stranger = '22222222-2222-4222-8222-222222222222';
const avatar = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('signing out discards an in-flight verification challenge response', async () => {
  const { document } = parseHTML('<section data-avatar-verification><p data-avatar-status></p><code class="preview-hidden" data-avatar-code></code><button data-avatar-request></button><button data-avatar-refresh></button></section>');
  const previous = globalThis.document;
  globalThis.document = document;
  let notify;
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  try {
    initAvatarVerification({ auth: { onAuthStateChange: listener => { notify = listener; } }, rpc: async () => pending });
    document.querySelector('[data-avatar-request]').click();
    notify('SIGNED_OUT');
    complete({ data: [{ challenge_code: 'old-account-code', expires_at: '2026-10-04T12:00:00Z' }], error: null });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(document.querySelector('[data-avatar-code]').textContent, '');
    assert.equal(document.querySelector('[data-avatar-status]').textContent, '');
    assert.ok(document.querySelector('[data-avatar-code]').classList.contains('preview-hidden'));
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test('kiosk endpoint denies spoofed callers and accepts only a configured object and secret', async () => {
  const environment = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_fake_test_only', CC_VERIFICATION_KIOSK_SECRET: 'fake-test-secret-not-for-production-1234', CC_VERIFICATION_KIOSK_OWNER: owner, CC_VERIFICATION_KIOSK_OBJECT: avatar };
  let request;
  const handler = createVerificationHandler(environment, () => ({ rpc: async (name, payload) => { request = { name, payload }; return { error: null }; } }));
  const event = { httpMethod: 'POST', headers: { 'x-cc-kiosk-secret': environment.CC_VERIFICATION_KIOSK_SECRET, 'x-secondlife-owner-key': owner, 'x-secondlife-object-key': avatar }, body: JSON.stringify({ code: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', avatar_uuid: avatar, username: 'avatar.resident' }) };
  assert.equal((await handler({ ...event, httpMethod: 'GET' })).statusCode, 405);
  assert.equal((await handler({ ...event, headers: {} })).statusCode, 403);
  assert.equal((await handler({ ...event, headers: { ...event.headers, 'x-secondlife-object-key': stranger } })).statusCode, 403);
  assert.equal((await handler({ ...event, body: JSON.stringify({ ...JSON.parse(event.body), user_id: stranger }) })).statusCode, 400);
  assert.equal(request, undefined);
  assert.equal((await handler(event)).statusCode, 200);
  assert.equal(request.name, 'consume_avatar_verification');
  assert.equal(request.payload.avatar_id, avatar);
  const disabled = createVerificationHandler({});
  assert.equal((await disabled(event)).statusCode, 503);
});

test('browser challenge operations do not accept an avatar or account assignment', async () => {
  const calls = [];
  const client = { rpc: async name => { calls.push(name); return { data: name === 'request_avatar_verification' ? [{ challenge_code: 'fake-code', expires_at: '2026-10-04T12:00:00Z' }] : [], error: null }; } };
  assert.equal((await requestAvatarChallenge(client)).challenge_code, 'fake-code');
  assert.deepEqual(await verifiedAvatars(client), []);
  assert.deepEqual(calls, ['request_avatar_verification', 'my_verified_avatars']);
});

test('avatar challenges require authentication and privileged, single-use consumption', async () => {
  const database = new PGlite();
  try {
    await database.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated,service_role;
      grant execute on function auth.uid() to anon,authenticated,service_role;`);
    await database.exec(foundation);
    await database.exec(verification);
    const checks = await database.exec(verifySql);
    assert.equal(checks[0].rows[0].rls_enabled, true);
    assert.deepEqual(checks[1].rows, [{ anon_can_request: false, account_can_request: true, account_can_consume: false, server_can_consume: true, account_can_read_all_codes: false }]);
    await database.query('insert into auth.users(id) values ($1),($2)', [owner, stranger]);
    const actAs = async (role, user = '') => {
      await database.exec('reset role');
      await database.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
      await database.exec(`set role ${role}`);
    };
    await actAs('anon');
    await assert.rejects(database.query('select * from public.request_avatar_verification()'), error => error.code === '42501');
    await actAs('authenticated', owner);
    const challenge = (await database.query('select * from public.request_avatar_verification()')).rows[0];
    assert.ok(challenge.challenge_code);
    await assert.rejects(database.query('select * from public.request_avatar_verification()'), /verification_rate_limited/);
    await assert.rejects(database.query('select * from cc_private.avatar_verification_challenges'), error => error.code === '42501');
    await assert.rejects(database.query('select public.consume_avatar_verification($1,$2,$3)', [challenge.challenge_code, avatar, 'verified.resident']), error => error.code === '42501');
    await actAs('service_role');
    assert.equal((await database.query('select public.consume_avatar_verification($1,$2,$3) as avatar', [challenge.challenge_code, avatar, 'verified.resident'])).rows[0].avatar, avatar);
    await assert.rejects(database.query('select public.consume_avatar_verification($1,$2,$3)', [challenge.challenge_code, avatar, 'verified.resident']), /verification_expired_or_used/);
    await actAs('authenticated', stranger);
    assert.deepEqual((await database.query('select * from public.my_verified_avatars()')).rows, []);
    const other = (await database.query('select * from public.request_avatar_verification()')).rows[0];
    await actAs('service_role');
    await assert.rejects(database.query('select public.consume_avatar_verification($1,$2,$3)', [other.challenge_code, avatar, 'verified.resident']), /avatar_already_linked/);
    await actAs('authenticated', owner);
    const linked = (await database.query('select * from public.my_verified_avatars()')).rows;
    assert.equal(linked.length, 1);
    assert.equal(linked[0].avatar_uuid, avatar);
    await actAs('postgres');
    await database.query('update cc_private.avatar_verification_challenges set expires_at=now() where code=$1', [other.challenge_code]);
    await actAs('service_role');
    await assert.rejects(database.query('select public.consume_avatar_verification($1,$2,$3)', [other.challenge_code, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'other.resident']), /verification_expired_or_used/);
    await actAs('postgres');
    await database.query('update cc_private.verified_avatar_links set revoked_at=now() where avatar_uuid=$1', [avatar]);
    await database.query("update cc_private.avatar_verification_challenges set created_at=now()-interval '2 minutes' where user_id=$1", [owner]);
    await actAs('authenticated', owner);
    const revoked = (await database.query('select * from public.request_avatar_verification()')).rows[0];
    await actAs('service_role');
    await assert.rejects(database.query('select public.consume_avatar_verification($1,$2,$3)', [revoked.challenge_code, avatar, 'verified.resident']), /avatar_link_revoked/);
  } finally { await database.close(); }
});
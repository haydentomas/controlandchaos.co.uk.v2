import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createTerminalLoginHandler } from '../netlify/functions/terminal-login.mjs';

const owner = '11111111-1111-4111-8111-111111111111';
const object = '22222222-2222-4222-8222-222222222222';
const avatar = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const environment = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_fake_test_only', CC_VERIFICATION_KIOSK_SECRET: 'fake-terminal-login-secret-for-tests-12345', CC_VERIFICATION_KIOSK_OWNER: owner, CC_VERIFICATION_KIOSK_OBJECT: object };
const event = payload => ({ httpMethod: 'POST', headers: { 'x-cc-kiosk-secret': environment.CC_VERIFICATION_KIOSK_SECRET, 'x-secondlife-owner-key': owner, 'x-secondlife-object-key': object }, body: JSON.stringify(payload) });
const hash = token => createHash('sha256').update(token).digest('hex');

test('terminal login issuance is trusted-object-only and stores a hash instead of the link token', async () => {
  const calls = [];
  const handler = createTerminalLoginHandler(environment, () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { data: owner }; } }));
  assert.equal((await handler({ ...event({ action: 'issue', avatar_uuid: avatar }), headers: {} })).statusCode, 403);
  assert.equal((await handler(event({ action: 'issue', avatar_uuid: avatar, user_id: owner }))).statusCode, 400);
  assert.equal(calls.length, 0);
  const response = await handler(event({ action: 'issue', avatar_uuid: avatar }));
  assert.equal(response.statusCode, 200);
  const url = new URL(JSON.parse(response.body).url);
  assert.equal(url.search, '');
  const token = new URLSearchParams(url.hash.slice(1)).get('terminal_token');
  assert.equal(token.length, 64);
  assert.deepEqual(calls[0], { name: 'issue_terminal_login', args: { target_avatar: avatar, login_hash: hash(token) } });
});

test('redemption derives confirmed account identity from the consumed challenge, never browser input', async () => {
  const calls = [];
  const handler = createTerminalLoginHandler(environment, () => ({
    rpc: async (name, args) => { calls.push({ name, args }); return { data: owner }; },
    auth: { admin: {
      getUserById: async id => { assert.equal(id, owner); return { data: { user: { id: owner, email: 'fake@example.test', email_confirmed_at: '2026-10-05' } } }; },
      generateLink: async payload => { assert.equal(payload.email, 'fake@example.test'); return { data: { user: { id: owner }, properties: { hashed_token: 'fake-otp-hash' } } }; }
    } }
  }));
  const token = 'a'.repeat(64);
  assert.equal((await handler(event({ action: 'redeem', token, email: 'attacker@example.test' }))).statusCode, 400);
  assert.equal((await handler({ ...event({ action: 'redeem', token }), headers: { origin: 'https://unsafe.test' } })).statusCode, 400);
  const response = await handler(event({ action: 'redeem', token }));
  assert.deepEqual(JSON.parse(response.body), { token_hash: 'fake-otp-hash' });
  assert.deepEqual(calls[0], { name: 'consume_terminal_login', args: { login_hash: hash(token) } });
  assert.equal(response.headers['Cache-Control'], 'no-store');
});

test('terminal challenges deny browser issuance/consumption, replay, expiry and revoked identities', async () => {
  const database = new PGlite();
  try {
    await database.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated,service_role;`);
    for (const file of ['202610040001_directory_foundation.sql', '202610040002_avatar_verification.sql', '202610050004_terminal_login.sql']) {
      await database.exec(await fs.readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    }
    await database.query('insert into auth.users(id) values ($1)', [owner]);
    await database.query('insert into cc_private.verified_avatar_links(avatar_uuid,user_id,sl_username) values ($1,$2,$3)', [avatar, owner, 'test.resident']);
    for (const role of ['anon', 'authenticated']) {
      await database.exec(`set role ${role}`);
      await assert.rejects(database.query('select public.issue_terminal_login($1,$2)', [avatar, 'a'.repeat(64)]), error => error.code === '42501');
      await assert.rejects(database.query('select public.consume_terminal_login($1)', ['a'.repeat(64)]), error => error.code === '42501');
      await database.exec('reset role');
    }
    assert.equal((await database.query('select public.issue_terminal_login($1,$2) as id', [avatar, 'a'.repeat(64)])).rows[0].id, owner);
    await assert.rejects(database.query('select public.issue_terminal_login($1,$2)', [avatar, 'b'.repeat(64)]), /rate_limited/);
    assert.equal((await database.query('select public.consume_terminal_login($1) as id', ['a'.repeat(64)])).rows[0].id, owner);
    await assert.rejects(database.query('select public.consume_terminal_login($1)', ['a'.repeat(64)]), /expired_or_used/);
    await database.query("insert into cc_private.terminal_login_challenges(token_hash,avatar_uuid,user_id,expires_at) values ($1,$2,$3,now()-interval '1 second')", ['b'.repeat(64), avatar, owner]);
    await assert.rejects(database.query('select public.consume_terminal_login($1)', ['b'.repeat(64)]), /expired_or_used/);
    await database.query('insert into cc_private.terminal_login_challenges(token_hash,avatar_uuid,user_id) values ($1,$2,$3)', ['c'.repeat(64), avatar, owner]);
    await database.query('update cc_private.verified_avatar_links set revoked_at=now() where avatar_uuid=$1', [avatar]);
    await assert.rejects(database.query('select public.consume_terminal_login($1)', ['c'.repeat(64)]), /denied/);
  } finally { await database.close(); }
});

test('unknown avatars receive signup URL without login authority and unconfirmed accounts cannot log in', async () => {
  const unknown = createTerminalLoginHandler(environment, () => ({ rpc: async () => ({ data: null }) }));
  assert.deepEqual(JSON.parse((await unknown(event({ action: 'issue', avatar_uuid: avatar }))).body), { url: 'https://controlandchaosv2.netlify.app/auth.html#terminal_setup=1' });
  for (const account of [
    { id: owner, email: 'fake@example.test' },
    { id: owner, email: 'fake@example.test', email_confirmed_at: '2026-10-05', banned_until: '2099-01-01' },
    { id: object, email: 'fake@example.test', email_confirmed_at: '2026-10-05' }
  ]) {
    let generated = false;
    const handler = createTerminalLoginHandler(environment, () => ({ rpc: async () => ({ data: owner }), auth: { admin: {
      getUserById: async () => ({ data: { user: account } }),
      generateLink: async () => { generated = true; throw new Error('Must not generate'); }
    } } }));
    assert.equal((await handler(event({ action: 'redeem', token: 'a'.repeat(64) }))).statusCode, 403);
    assert.equal(generated, false);
  }
});
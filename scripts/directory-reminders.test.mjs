import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createReminderHandler } from '../netlify/functions/directory-reminders.mjs';

const owner = '11111111-1111-4111-8111-111111111111';
const object = '22222222-2222-4222-8222-222222222222';
const avatar = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const environment = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_fake_test_only', CC_PAYMENT_KIOSK_SECRET: 'fake-reminder-secret-for-tests-only-12345', CC_PAYMENT_KIOSK_OWNER: owner, CC_PAYMENT_KIOSK_OBJECT: object };
const event = payload => ({ httpMethod: 'POST', headers: { 'x-cc-payment-secret': environment.CC_PAYMENT_KIOSK_SECRET, 'x-secondlife-owner-key': owner, 'x-secondlife-object-key': object }, body: JSON.stringify(payload) });

test('terminal reminder polling is separate from payments and persists submission before acknowledgement retry', async () => {
  const script = await fs.readFile(new URL('./CC_V2_Directory_Terminal.lsl', import.meta.url), 'utf8');
  assert.match(script, /key reminderRequest = NULL_KEY/);
  assert.match(script, /pumpReminders\(\);/);
  assert.match(script, /nextReminderPoll = llGetUnixTime\(\) \+ 300/);
  assert.match(script, /llInstantMessage\(\(key\)recipient, message\)/);
  assert.match(script, /llJsonGetValue\(journal, \["state"\]\) != "submitted"/);
  assert.match(script, /sendReminderRequest\("ack", llJsonGetValue\(journal, \["ack"\]\)\)/);
  assert.ok(script.indexOf('"state", "sending"') < script.indexOf('llInstantMessage((key)recipient, message)'));
  assert.match(script, /sendReminderRequest\("authorize"/);
  assert.doesNotMatch(script, /llGiveMoney|llTransferLindenDollars|PERMISSION_DEBIT/);
});

test('reminder endpoint authenticates terminal and derives kiosk identity, recipient and text server-side', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: name === 'authorize_directory_reminder' ? [{ avatar_uuid: avatar, kind: 'expiring', expires_at: '2099-10-05T00:00:00Z' }] : [] }; } };
  const handler = createReminderHandler(environment, () => client);
  assert.equal((await handler({ ...event({ action: 'claim' }), httpMethod: 'GET' })).statusCode, 405);
  assert.equal((await handler({ ...event({ action: 'claim' }), headers: {} })).statusCode, 403);
  assert.equal((await handler(event({ action: 'claim', avatar_uuid: avatar }))).statusCode, 400);
  assert.equal((await handler(event({ action: 'ack', id: owner, claim_token: object, kiosk_id: avatar }))).statusCode, 400);
  assert.equal(calls.length, 0);
  assert.deepEqual(JSON.parse((await handler(event({ action: 'claim' }))).body), { reminder: null });
  const response = await handler(event({ action: 'authorize', id: owner, claim_token: object }));
  const result = JSON.parse(response.body).reminder;
  assert.equal(result.avatar_uuid, avatar);
  assert.match(result.message, /expires at/);
  assert.deepEqual(calls[1], { name: 'authorize_directory_reminder', args: { kiosk_id: object, reminder_id: owner, delivery_token: object } });
});

test('reminder claims are leased, revalidated against renewals and acknowledged idempotently', async () => {
  const database = new PGlite();
  try {
    await database.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated,service_role;`);
    for (const file of ['202610040001_directory_foundation.sql', '202610040002_avatar_verification.sql', '202610050003_directory_subscriptions.sql', '202610050006_directory_reminder_delivery.sql']) {
      await database.exec(await fs.readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    }
    for (const role of ['anon', 'authenticated']) {
      await database.exec(`set role ${role}`);
      await assert.rejects(database.query('select * from public.claim_directory_reminder($1)', [object]), error => error.code === '42501');
      await assert.rejects(database.query('select * from public.authorize_directory_reminder($1,$2,$3)', [owner, owner, object]), error => error.code === '42501');
      await assert.rejects(database.query('select public.acknowledge_directory_reminder($1,$2,$3)', [owner, owner, object]), error => error.code === '42501');
      await database.exec('reset role');
    }
    await database.query("insert into cc_private.directory_subscriptions(avatar_uuid,plan_code,expires_at) values ($1,'basic_monthly',now()+interval '2 days')", [avatar]);
    await database.exec('set role service_role');
    const claim = () => database.query('select * from public.claim_directory_reminder($1)', [object]);
    const authorize = receipt => database.query('select * from public.authorize_directory_reminder($1,$2,$3)', [receipt.id, receipt.claim_token, object]);
    const receipt = (await claim()).rows[0];
    assert.ok(receipt.id);
    assert.equal((await claim()).rows.length, 0);
    assert.equal((await authorize(receipt)).rows[0].kind, 'expiring');
    assert.equal((await database.query('select * from public.authorize_directory_reminder($1,$2,$3)', [receipt.id, owner, object])).rows.length, 0);
    await database.query("update cc_private.directory_subscriptions set expires_at=now()+interval '32 days' where avatar_uuid=$1", [avatar]);
    assert.equal((await authorize(receipt)).rows.length, 0);
    assert.equal((await claim()).rows.length, 0);
    await database.query("update cc_private.directory_subscriptions set expires_at=now()-interval '1 second' where avatar_uuid=$1", [avatar]);
    const expired = (await claim()).rows[0];
    assert.equal((await authorize(expired)).rows[0].kind, 'expired');
    await database.query("update cc_private.directory_reminders set claimed_until=now()-interval '1 second' where id=$1", [expired.id]);
    assert.equal((await authorize(expired)).rows.length, 0);
    const retry = (await claim()).rows[0];
    assert.equal(retry.id, expired.id);
    assert.notEqual(retry.claim_token, expired.claim_token);
    assert.equal((await database.query('select public.acknowledge_directory_reminder($1,$2,$3) as accepted', [expired.id, expired.claim_token, object])).rows[0].accepted, false);
    for (let attempt = 0; attempt < 2; attempt++) assert.equal((await database.query('select public.acknowledge_directory_reminder($1,$2,$3) as accepted', [retry.id, retry.claim_token, object])).rows[0].accepted, true);
    assert.equal((await claim()).rows.length, 0);
    await database.query("update cc_private.directory_subscriptions set is_lifetime=true,expires_at=null,plan_code='basic_lifetime' where avatar_uuid=$1", [avatar]);
    assert.equal((await claim()).rows.length, 0);
    await database.query("update cc_private.directory_subscriptions set is_lifetime=false,expires_at=now()+interval '1 day',plan_code='basic_monthly',suspended_at=now() where avatar_uuid=$1", [avatar]);
    assert.equal((await claim()).rows.length, 0);
  } finally { await database.close(); }
});

test('reminder endpoint handles stale jobs and failed acknowledgements without leaking backend details', async () => {
  const handler = createReminderHandler(environment, () => ({ rpc: async name => ({ data: name === 'acknowledge_directory_reminder' ? false : [] }) }));
  assert.deepEqual(JSON.parse((await handler(event({ action: 'authorize', id: owner, claim_token: object }))).body), { reminder: null });
  assert.equal((await handler(event({ action: 'ack', id: owner, claim_token: object }))).statusCode, 409);
  const failed = createReminderHandler(environment, () => ({ rpc: async () => ({ error: { message: 'private database detail' } }) }));
  const response = await failed(event({ action: 'claim' }));
  assert.equal(response.statusCode, 503);
  assert.ok(!response.body.includes('private database detail'));
});
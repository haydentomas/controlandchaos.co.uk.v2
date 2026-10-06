import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createPaymentHandler } from '../netlify/functions/directory-payment.mjs';

const owner = '11111111-1111-4111-8111-111111111111';
const object = '22222222-2222-4222-8222-222222222222';
const avatar = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const reference = '33333333-3333-4333-8333-333333333333';
const environment = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_fake_test_only', CC_PAYMENT_KIOSK_SECRET: 'fake-payment-secret-for-tests-only-12345', CC_PAYMENT_KIOSK_OWNER: owner, CC_PAYMENT_KIOSK_OBJECT: object };
const event = payload => ({ httpMethod: 'POST', headers: { 'x-cc-payment-secret': environment.CC_PAYMENT_KIOSK_SECRET, 'x-secondlife-owner-key': owner, 'x-secondlife-object-key': object }, body: JSON.stringify(payload) });
const payment = { action: 'payment', payment_reference: reference, avatar_uuid: avatar, plan: 'basic_monthly', amount_linden: 100 };

test('creator pass terminal requires finance-owner debit permission and async payout confirmation', async () => {
  const script = await fs.readFile(new URL('./CC_V2_Directory_Terminal.lsl', import.meta.url), 'utf8');
  assert.doesNotMatch(script, /llGiveMoney/);
  assert.match(script, /llRequestPermissions\(llGetOwner\(\), PERMISSION_DEBIT\)/);
  assert.match(script, /llTransferLindenDollars\(creatorAvatar, creatorAmount\)/);
  assert.match(script, /transaction_result\(key transaction, integer success, string data\)/);
  assert.match(script, /creator_blog_start/);
  assert.match(script, /creator_blog_confirm/);
  assert.match(script, /cc_v2_creator_payment_/);
  assert.match(script, /All sales are final\. No refunds\./);
  assert.match(script, /cc_v2_unapplied_/);
  assert.match(script, /llLinksetDataWrite\("cc_v2_payment_" \+ reference, payload\)/);
});

test('payment endpoint denies untrusted callers before any database calls', async () => {
  let calls = 0;
  const handler = createPaymentHandler(environment, () => { calls++; throw new Error('Not reached'); });
  assert.equal((await handler({ ...event(payment), httpMethod: 'GET' })).statusCode, 405);
  for (const headers of [{}, { ...event(payment).headers, 'x-cc-payment-secret': 'wrong' }, { ...event(payment).headers, 'x-secondlife-object-key': avatar }, { ...event(payment).headers, 'x-secondlife-owner-key': avatar }]) {
    assert.equal((await handler({ ...event(payment), headers })).statusCode, 403);
  }
  assert.equal((await createPaymentHandler({})(event(payment))).statusCode, 503);
  assert.equal(calls, 0);
});

test('payment endpoint rejects forged duration, ownership and malformed amounts', async () => {
  let calls = 0;
  const handler = createPaymentHandler(environment, () => { calls++; throw new Error('Not reached'); });
  for (const payload of [null, [], { ...payment, duration_days: 36500 }, { ...payment, user_id: owner }, { ...payment, is_vip: true }, { ...payment, amount_linden: '100' }, { ...payment, amount_linden: 0 }, { ...payment, amount_linden: 1.5 }, { ...payment, plan: 'free' }, { ...payment, avatar_uuid: '00000000-0000-0000-0000-000000000000' }]) {
    assert.equal((await handler(event(payload))).statusCode, 400);
  }
  assert.equal((await handler({ ...event(payment), body: 'x'.repeat(2049) })).statusCode, 400);
  assert.equal(calls, 0);
});

test('plans default to no sales and payment retries retain the original receipt', async () => {
  const calls = [];
  const handler = createPaymentHandler(environment, () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { data: name === 'directory_payment_plans' ? [] : null, error: null }; } }));
  assert.deepEqual(JSON.parse((await handler(event({ action: 'plans', avatar_uuid: avatar }))).body), { plans: [] });
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await handler(event(payment));
    assert.equal(result.statusCode, 200);
    assert.equal(JSON.parse(result.body).payment_reference, reference);
    assert.equal(JSON.parse(result.body).profile_id, null);
  }
  assert.deepEqual(calls[1], { name: 'register_directory_payment', args: { payment_reference: reference, payer_avatar: avatar, purchased_plan: 'basic_monthly', paid_linden: 100 } });
  assert.deepEqual(calls[1], calls[2]);
});

test('payment failures expose no backend errors or credentials', async () => {
  for (const failure of [{ message: 'payment_reference_conflict' }, { message: 'private backend detail' }]) {
    const handler = createPaymentHandler(environment, () => ({ rpc: async () => ({ error: failure }) }));
    const response = await handler(event(payment));
    assert.equal(response.statusCode, failure.message === 'payment_reference_conflict' ? 409 : 503);
    assert.ok(!response.body.includes(failure.message));
    assert.ok(!response.body.includes(environment.SUPABASE_SECRET_KEY));
  }
});

test('creator subscription actions are available only through the trusted in-world kiosk flow', async () => {
  const creator = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const calls = [];
  const client = { rpc: async (name, args) => {
    calls.push({ name, args });
    if (name === 'creator_blog_offer_for_terminal') return { data: [{ profile_id: reference, creator_avatar_uuid: creator, creator_name: 'Creator', monthly_price_linden: 1500 }], error: null };
    if (name === 'creator_blog_prepare_payment') return { data: [{ creator_profile_id: reference, creator_avatar_uuid: creator, amount_linden: 1500, payment_state: 'prepared' }], error: null };
    if (name === 'creator_blog_start_payout') return { data: true, error: null };
    if (name === 'creator_blog_confirm_payment') return { data: '2026-11-05T00:00:00.000Z', error: null };
    if (name === 'creator_blog_cancel_payment') return { data: true, error: null };
    if (name === 'creator_blog_confirm_refund') return { data: true, error: null };
    return { data: null, error: { message: 'unexpected rpc' } };
  } };
  const handler = createPaymentHandler(environment, () => client);
  const purchase = { payment_reference: reference, avatar_uuid: avatar, creator_avatar_uuid: creator, amount_linden: 1500 };
  assert.equal((await handler(event({ action: 'creator_blog_offer', creator_avatar_uuid: creator }))).statusCode, 200);
  for (const action of ['creator_blog_prepare', 'creator_blog_start', 'creator_blog_confirm', 'creator_blog_cancel', 'creator_blog_refund_confirm']) {
    const result = await handler(event({ action, ...purchase }));
    assert.equal(result.statusCode, 200, action);
  }
  assert.equal(calls.map(call => call.name).join(','), 'creator_blog_offer_for_terminal,creator_blog_prepare_payment,creator_blog_start_payout,creator_blog_confirm_payment,creator_blog_cancel_payment,creator_blog_confirm_refund');
  assert.equal((await handler(event({ action: 'creator_blog_prepare', ...purchase, creator_profile_id: reference }))).statusCode, 400);
  assert.equal((await handler({ ...event({ action: 'creator_blog_offer', creator_avatar_uuid: creator }), headers: { ...event({}).headers, 'x-secondlife-object-key': avatar } })).statusCode, 403);
});

test('creator blog payout endpoint gates every action behind the trusted terminal identity', async () => {
  const creator = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const calls = [];
  const client = { rpc: async (name, args) => {
    calls.push({ name, args });
    if (name === 'creator_blog_offer_for_terminal') return { data: [{ profile_id: reference, creator_avatar_uuid: creator, creator_name: 'Creator', monthly_price_linden: 1500 }], error: null };
    if (name === 'creator_blog_prepare_payment') return { data: [{ creator_profile_id: reference, creator_avatar_uuid: creator, amount_linden: 1500, payment_state: 'prepared' }], error: null };
    if (name === 'creator_blog_start_payout') return { data: true, error: null };
    if (name === 'creator_blog_confirm_payment') return { data: '2026-11-05T00:00:00.000Z', error: null };
    if (name === 'creator_blog_cancel_payment') return { data: true, error: null };
    if (name === 'creator_blog_confirm_refund') return { data: true, error: null };
    return { data: null, error: { message: 'unexpected rpc' } };
  } };
  const handler = createPaymentHandler(environment, () => client);
  const purchase = { payment_reference: reference, avatar_uuid: avatar, creator_avatar_uuid: creator, amount_linden: 1500 };
  assert.equal((await handler(event({ action: 'creator_blog_offer', creator_avatar_uuid: creator }))).statusCode, 200);
  for (const action of ['creator_blog_prepare', 'creator_blog_start', 'creator_blog_confirm', 'creator_blog_cancel', 'creator_blog_refund_confirm']) {
    assert.equal((await handler(event({ action, ...purchase }))).statusCode, 200, action);
  }
  assert.deepEqual(calls.map(call => call.name), [
    'creator_blog_offer_for_terminal', 'creator_blog_prepare_payment', 'creator_blog_start_payout',
    'creator_blog_confirm_payment', 'creator_blog_cancel_payment', 'creator_blog_confirm_refund'
  ]);
  assert.equal((await handler(event({ action: 'creator_blog_prepare', ...purchase, creator_profile_id: reference }))).statusCode, 400);
  assert.equal((await handler({ ...event({ action: 'creator_blog_offer', creator_avatar_uuid: creator }), headers: { ...event(payment).headers, 'x-secondlife-object-key': avatar } })).statusCode, 403);
});

test('combined terminal routes verification separately without enabling payment for menu or verification sessions', async () => {
  const script = await fs.readFile(new URL('./CC_V2_Directory_Terminal.lsl', import.meta.url), 'utf8');
  assert.equal((script.match(/touch_start\(integer count\)/g) || []).length, 1);
  assert.ok(script.indexOf('string firstPending()') < script.indexOf('loadPlans()'));
  assert.match(script, /\["Directory Plans", "Creator Pass", "Verify Avatar", "My Account", "Cancel"\]/);
  assert.match(script, /"X-CC-Kiosk-Secret", VERIFICATION_SECRET/);
  assert.match(script, /"X-CC-Payment-Secret", KIOSK_SECRET/);
  assert.match(script, /key verificationRequest = NULL_KEY/);
  assert.match(script, /key paymentRequest = NULL_KEY/);
  assert.match(script, /menuMode != "pay"/);
  assert.match(script, /menuMode == "creator_pay"/);
  assert.match(script, /verificationRequest != NULL_KEY && now >= verificationDeadline/);
  assert.match(script, /"avatar_uuid", \(string\)avatar, "username", username/);
  assert.match(script, /"action", "issue", "avatar_uuid", \(string\)accountAvatar/);
  assert.match(script, /llLoadURL\(accountAvatar,/);
  assert.doesNotMatch(script, /ll(?:OwnerSay|RegionSayTo|InstantMessage)\([^;]*terminal_token/s);
});

test('terminal reads a private notecard without embedded secrets and remains gated until complete', async () => {
  const script = await fs.readFile(new URL('./CC_V2_Directory_Terminal.lsl', import.meta.url), 'utf8');
  assert.match(script, /string CONFIG_NOTECARD = "CC_V2_Terminal_Config"/);
  assert.match(script, /string KIOSK_SECRET = "";/);
  assert.match(script, /string VERIFICATION_SECRET = "";/);
  assert.match(script, /llGetNotecardLine\(CONFIG_NOTECARD, configLine\)/);
  assert.match(script, /request != configRequest/);
  assert.match(script, /if \(!configurationReady\)/);
  assert.match(script, /llJsonValueType\(line, \[\]\) != JSON_OBJECT/);
  assert.match(script, /llJsonValueType\(line, \[setting\]\) != JSON_STRING/);
  assert.match(script, /configPaymentSecret == configVerificationSecret/);
  assert.match(script, /length < 32 \|\| length > 128/);
  assert.match(script, /change & CHANGED_INVENTORY\) llResetScript\(\)/);
  assert.doesNotMatch(script, /ll(?:OwnerSay|RegionSayTo|InstantMessage)\([^;\r\n]*(?:,\s*|\+\s*)(?:data|line|value|configPaymentSecret|configVerificationSecret)\b/);
  const startup = script.slice(script.indexOf('state_entry()'), script.indexOf('dataserver(key request'));
  assert.match(startup, /loadConfiguration\(\)/);
  assert.doesNotMatch(startup, /sendPending\(\)/);
});
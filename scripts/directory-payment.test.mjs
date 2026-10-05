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

test('terminal states final-sale terms and contains no refund or debit-permission calls', async () => {
  const script = await fs.readFile(new URL('./CC_V2_Directory_Terminal.lsl', import.meta.url), 'utf8');
  assert.doesNotMatch(script, /llGiveMoney|llTransferLindenDollars|PERMISSION_DEBIT|llRequestPermissions/);
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
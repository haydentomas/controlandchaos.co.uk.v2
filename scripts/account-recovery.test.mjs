import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoverCreatorAccount } from './recover-creator-account.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const environment = {
  SUPABASE_URL: 'https://fqzcaragavsutdkswsnm.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_fake_test_only',
  CC_RECOVERY_EMAIL: ' owner@example.test ',
  CC_RECOVERY_USER_ID: id,
  CC_RECOVERY_PASSWORD: 'fake-test-password-long'
};
function setup(overrides = {}) {
  const calls = [];
  const user = { id, email: 'owner@example.test', email_confirmed_at: '2026-10-04T00:00:00Z', ...overrides.user };
  const factory = (url, key, options) => {
    assert.equal(url, environment.SUPABASE_URL);
    assert.equal(key, environment.SUPABASE_SECRET_KEY);
    assert.equal(options.auth.persistSession, false);
    return { auth: {
      admin: {
        getUserById: async target => { calls.push(['lookup', target]); return { data: { user }, error: overrides.lookupError }; },
        updateUserById: async (target, payload) => { calls.push(['update', target, payload]); return { error: overrides.updateError }; }
      },
      signInWithPassword: async payload => {
        calls.push(['signin', payload]);
        return { data: { user, session: {} }, error: overrides.signInError };
      },
      signOut: async options => { calls.push(['signout', options]); return { error: overrides.signOutError }; }
    } };
  };
  return { calls, factory };
}

test('owner recovery changes only the verified target password and checks normal sign-in', async () => {
  const { calls, factory } = setup();
  assert.match(await recoverCreatorAccount(environment, factory), /normal password sign-in verified/);
  assert.deepEqual(calls, [
    ['lookup', id],
    ['update', id, { password: environment.CC_RECOVERY_PASSWORD }],
    ['signin', { email: 'owner@example.test', password: environment.CC_RECOVERY_PASSWORD }],
    ['signout', { scope: 'local' }]
  ]);
});

test('invalid inputs never contact Supabase', async () => {
  for (const change of [
    { SUPABASE_URL: 'https://wrong.supabase.co' }, { SUPABASE_SECRET_KEY: 'sb_publishable_fake' },
    { CC_RECOVERY_EMAIL: '' }, { CC_RECOVERY_USER_ID: 'invalid' }, { CC_RECOVERY_PASSWORD: 'short' }
  ]) {
    const { calls, factory } = setup();
    await assert.rejects(recoverCreatorAccount({ ...environment, ...change }, factory), /Recovery refused/);
    assert.deepEqual(calls, []);
  }
});

test('lookup failure, identity mismatch, unconfirmed and banned accounts are not modified', async () => {
  for (const overrides of [
    { lookupError: { message: 'private backend detail' } },
    { user: { email: 'someone-else@example.test' } },
    { user: { id: '22222222-2222-4222-8222-222222222222' } },
    { user: { email_confirmed_at: null } },
    { user: { banned_until: '2999-01-01T00:00:00Z' } }
  ]) {
    const { calls, factory } = setup(overrides);
    await assert.rejects(recoverCreatorAccount(environment, factory), error => !error.message.includes('private backend detail'));
    assert.equal(calls.length, 1);
  }
});

test('update and verification failures are explicit and do not expose backend details', async () => {
  for (const [field, expected, count] of [
    ['updateError', /Password update failed/, 2],
    ['signInError', /Password was updated, but/, 3],
    ['signOutError', /sign-in succeeded, but cleanup/, 4]
  ]) {
    const { calls, factory } = setup({ [field]: { message: 'secret backend detail' } });
    await assert.rejects(recoverCreatorAccount(environment, factory), error => expected.test(error.message) && !error.message.includes('secret backend detail'));
    assert.equal(calls.length, count);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { initAccountDirectory } from '../src/modules/account-directory.js';
import { myDirectorySubscriptions, loadCreatorProfile, saveCreatorProfile, profileChanges, subscriptionLabel } from '../src/modules/creator-profile-api.js';

const profileId = '33333333-3333-4333-8333-333333333333';
const values = { display_name: 'Test Creator', headline: '', tagline: '', about: 'Profile text', starting_rate: '', role_type: 'switch', availability: 'available', avatar_image: '', banner_image: '', tags: ['RLV'], is_published: false };

test('creator profile updates allow content only, never ownership, approval or subscription fields', () => {
  assert.deepEqual(profileChanges(values), values);
  for (const field of ['is_approved', 'is_featured', 'slug', 'sl_username', 'user_id', 'avatar_uuid', 'expires_at']) {
    assert.throws(() => profileChanges({ ...values, [field]: 'forged' }), /Invalid profile fields/);
  }
  assert.throws(() => profileChanges({ ...values, avatar_image: 'javascript:alert(1)' }), /image URL/);
  assert.throws(() => profileChanges({ ...values, tags: Array(21).fill('tag') }), /20/);
  assert.throws(() => profileChanges({ ...values, display_name: ' ' }), /display name/);
});

test('profile reads and writes require an active owned subscription before querying the table', async () => {
  let tables = 0;
  for (const subscriptions of [[], [{ profile_id: profileId, is_active: false }], [{ profile_id: '44444444-4444-4444-8444-444444444444', is_active: true }]]) {
    const client = { rpc: async () => ({ data: subscriptions }), from: () => { tables++; } };
    await assert.rejects(loadCreatorProfile(client, profileId), /active subscription/);
    await assert.rejects(saveCreatorProfile(client, profileId, values), /active subscription/);
  }
  assert.equal(tables, 0);
});

test('successful profile saves are ID-scoped and a zero-row update is not reported as saved', async () => {
  let update;
  let scoped;
  let row = { id: profileId, ...values };
  const chain = { update: changes => { update = changes; return chain; }, select: () => chain, eq: (name, value) => { scoped = { name, value }; return chain; }, maybeSingle: async () => ({ data: row }) };
  const client = { rpc: async name => { assert.equal(name, 'my_directory_subscriptions'); return { data: [{ profile_id: profileId, is_active: true }] }; }, from: name => { assert.equal(name, 'directory_profiles'); return chain; } };
  assert.equal((await saveCreatorProfile(client, profileId, values)).id, profileId);
  assert.deepEqual(update, values);
  assert.deepEqual(scoped, { name: 'id', value: profileId });
  row = null;
  await assert.rejects(saveCreatorProfile(client, profileId, values), /not saved/);
});

test('subscription display distinguishes active, inactive and lifetime access without leaking backend errors', async () => {
  assert.match(subscriptionLabel({ plan_code: 'vip_lifetime', is_active: true, is_lifetime: true }), /VIP Lifetime - Active - Lifetime/);
  assert.match(subscriptionLabel({ plan_code: 'basic_monthly', is_active: false, expires_at: '2026-10-01T00:00:00Z' }), /Basic Monthly - Inactive/);
  await assert.rejects(myDirectorySubscriptions({ rpc: async () => ({ error: { message: 'private' } }) }), error => !error.message.includes('private'));
});

test('signing out discards a pending account subscription response and editing link', async () => {
  const { document } = parseHTML('<section data-account-directory><p data-subscription-status></p><div data-subscription-list></div></section>');
  const previous = globalThis.document;
  globalThis.document = document;
  let notify;
  let complete;
  try {
    const pending = new Promise(resolve => { complete = resolve; });
    const refresh = initAccountDirectory({ auth: { onAuthStateChange: callback => { notify = callback; } }, rpc: async () => pending });
    const request = refresh({ id: 'fake-user' });
    notify('SIGNED_OUT');
    complete({ data: [{ profile_id: profileId, plan_code: 'basic_monthly', is_active: true, expires_at: '2099-10-05' }] });
    await request;
    assert.equal(document.querySelector('[data-subscription-status]').textContent, '');
    assert.equal(document.querySelector('[data-subscription-list]').children.length, 0);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});
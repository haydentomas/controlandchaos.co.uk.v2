import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { initDirectoryAdmin } from '../src/modules/directory-admin.js';

function adminDom() {
  return parseHTML(`<main data-directory-admin>
    <p data-admin-status></p>
    <section data-admin-gate><a data-admin-signin></a></section>
    <section data-admin-console class="preview-hidden">
      <button type="button" data-admin-signout></button>
      <button data-admin-tab="listings"></button><button data-admin-tab="subscribers"></button>
      <section data-admin-listings-pane><input data-admin-listing-search><button data-admin-listing-refresh></button><div data-admin-listings></div></section>
      <section data-admin-subscribers-pane class="preview-hidden"><input data-admin-subscriber-search><select data-admin-subscriber-type><option value="all">All</option></select><button data-admin-subscriber-refresh></button><div data-admin-subscribers></div></section>
      <dialog data-admin-edit-dialog><form data-admin-edit-form><button type="button" data-admin-edit-cancel></button><button type="button" data-admin-edit-cancel></button></form></dialog>
    </section>
  </main>`);
}

const listing = { profile_data: { id: '33333333-3333-4333-8333-333333333333', display_name: 'Alek Zane', sl_username: 'alek.zane', slug: 'alek-zane', role_type: 'sub', avatar_image: '' }, moderation_state: 'published', directory_plan_code: 'basic_monthly', directory_expires_at: '2099-10-05T00:00:00Z', directory_is_lifetime: false, directory_is_suspended: false, directory_is_active: true, active_creator_subscribers: 1 };

async function withGlobals(callback) {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousLocation = globalThis.location;
  const dom = adminDom();
  globalThis.document = dom.document;
  globalThis.location = { origin: 'https://controlandchaos.example.test' };
  globalThis.window = { location: { href: '' }, confirm: () => true, prompt: () => 'Review requested', open: () => null };
  try { await callback(dom.document); }
  finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousLocation === undefined) delete globalThis.location; else globalThis.location = previousLocation;
  }
}

test('admin console remains gated for a signed-in non-superadmin', async () => {
  await withGlobals(async document => {
    const calls = [];
    const client = {
      auth: { getSession: async () => ({ data: { session: {} } }), getUser: async () => ({ data: { user: { email: 'other@example.test' } } }), onAuthStateChange: () => ({}) },
      rpc: async name => { calls.push(name); return { data: false, error: null }; }
    };
    await initDirectoryAdmin(client);
    assert.equal(document.querySelector('[data-admin-gate]').classList.contains('preview-hidden'), false);
    assert.equal(document.querySelector('[data-admin-console]').classList.contains('preview-hidden'), true);
    assert.deepEqual(calls, ['my_directory_admin_access']);
  });
});

test('superadmin can search listings and subscriber records through guarded RPCs', async () => {
  await withGlobals(async document => {
    const calls = [];
    const client = {
      auth: { getSession: async () => ({ data: { session: {} } }), getUser: async () => ({ data: { user: { email: 'control@example.test' } } }), onAuthStateChange: () => ({}) },
      rpc: async (name, args) => {
        calls.push({ name, args });
        if (name === 'my_directory_admin_access') return { data: true, error: null };
        if (name === 'admin_directory_listings') return { data: [listing], error: null };
        if (name === 'admin_directory_subscribers') return { data: [{ subscription_type: 'creator', subscriber_avatar_uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', subscriber_username: 'fan.resident', profile_id: listing.profile_data.id, profile_slug: 'alek-zane', profile_name: 'Alek Zane', plan_code: 'creator_monthly', amount_linden: 3200, expires_at: '2099-10-05T00:00:00Z', is_lifetime: false, is_suspended: false, is_active: true }], error: null };
        return { data: null, error: null };
      }
    };
    await initDirectoryAdmin(client);
    assert.equal(document.querySelector('[data-admin-gate]').classList.contains('preview-hidden'), true);
    assert.equal(document.querySelector('[data-admin-console]').classList.contains('preview-hidden'), false);
    assert.match(document.querySelector('[data-admin-listings]').textContent, /Alek Zane/);
    assert.match(document.querySelector('[data-admin-listings]').textContent, /1 active creator subscribers/);
    document.querySelector('[data-admin-tab="subscribers"]').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.match(document.querySelector('[data-admin-subscribers]').textContent, /fan\.resident/);
    assert.match(document.querySelector('[data-admin-subscribers]').textContent, /Creator pass/);
    assert.ok(calls.some(call => call.name === 'admin_directory_subscribers'));
    assert.equal(document.querySelectorAll('[data-admin-tab]').length, 2);
  });
});

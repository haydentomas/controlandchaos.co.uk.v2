import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { validateRateCategories, renderPublicRateCards } from '../src/modules/rate-cards.js';
import { initRateCardEditor } from '../src/modules/rate-card-editor.js';
import { validateBookingHours, bookingLocalTime, renderBookingHours, initBookingHoursEditor } from '../src/modules/booking-hours.js';
import { initAccountDirectory } from '../src/modules/account-directory.js';
import { myDirectorySubscriptions, loadCreatorProfile, saveCreatorProfile, profileChanges, subscriptionLabel } from '../src/modules/creator-profile-api.js';

const profileId = '33333333-3333-4333-8333-333333333333';
const values = { display_name: 'Test Creator', headline: '', tagline: '', about: 'Profile text', starting_rate: '', role_type: 'switch', availability: 'available', avatar_image: '', banner_image: '', tags: ['RLV'], is_published: false };
const rates = [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Consultations', description: 'Private appointments', items: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Introduction', price: 'L$1,000', unit: '30 minutes', description: 'A first appointment' }] }];
const hours = { timezone: 'America/Los_Angeles', days: ['sat', 'sun'], start_time: '20:00', end_time: '23:00', slot_minutes: 60, notes: 'Advance booking recommended.' };

test('booking hours validate timezones, days and intervals, including explicit overnight windows', () => {
  assert.deepEqual(validateBookingHours(hours), hours);
  assert.equal(validateBookingHours(null), null);
  assert.equal(validateBookingHours({ ...hours, end_time: '02:00' }).end_time, '02:00');
  assert.deepEqual(validateBookingHours({ ...hours, days: [] }).days, []);
  for (const invalid of [{ ...hours, timezone: 'GMT' }, { ...hours, days: ['sat', 'sat'] }, { ...hours, start_time: '25:00' }, { ...hours, start_time: '20:00', end_time: '20:00' }, { ...hours, end_time: '20:15' }, { ...hours, slot_minutes: 15 }, { ...hours, is_approved: true }]) {
    assert.throws(() => validateBookingHours(invalid));
  }
  assert.deepEqual(profileChanges({ ...values, booking_hours: hours }).booking_hours, hours);
});

test('booking timezone rules handle DST and public notes render as text rather than markup', () => {
  assert.equal(bookingLocalTime(hours, new Date('2026-01-05T12:00:00Z')), '04:00');
  assert.equal(bookingLocalTime(hours, new Date('2026-07-05T12:00:00Z')), '05:00');
  const { document } = parseHTML('<div id="hours"></div>');
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    renderBookingHours(document.getElementById('hours'), { ...hours, end_time: '02:00', notes: '<script>unsafe()</script>' });
    assert.match(document.getElementById('hours').textContent, /following day/);
    assert.equal(document.querySelectorAll('script').length, 0);
    renderBookingHours(document.getElementById('hours'), null);
    assert.equal(document.getElementById('hours').children.length, 0);
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});

test('rate cards preserve order and flexible prices while rejecting malformed or privileged nested fields', () => {
  assert.deepEqual(validateRateCategories(rates), rates);
  assert.deepEqual(profileChanges({ ...values, rate_categories: rates }).rate_categories, rates);
  assert.throws(() => validateRateCategories([{ ...rates[0], items: [{ ...rates[0].items[0], is_featured: true }] }]), /Invalid/);
  assert.throws(() => validateRateCategories([rates[0], rates[0]]), /duplicate/);
  assert.throws(() => validateRateCategories([{ ...rates[0], title: ' ' }]), /Check/);
  assert.throws(() => validateRateCategories([{ ...rates[0], items: Array(31).fill(rates[0].items[0]) }]), /30/);
});

test('public rate cards render untrusted content as text and omit empty categories', () => {
  const { document } = parseHTML('<div id="rates"></div>');
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    renderPublicRateCards(document.getElementById('rates'), [{ ...rates[0], title: '<img src=x onerror=alert(1)>', items: [{ ...rates[0].items[0], description: '<script>unsafe()</script>' }] }]);
    assert.equal(document.querySelectorAll('img,script').length, 0);
    assert.match(document.getElementById('rates').textContent, /<script>/);
    renderPublicRateCards(document.getElementById('rates'), [{ ...rates[0], items: [] }]);
    assert.equal(document.getElementById('rates').children.length, 0);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test('rate-card database schema enforces paid ownership, structure and public publication rules', async () => {
  const database = new PGlite();
  const owner = '11111111-1111-4111-8111-111111111111';
  const stranger = '22222222-2222-4222-8222-222222222222';
  try {
    await database.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated,service_role;`);
    for (const file of ['202610040001_directory_foundation.sql', '202610040002_avatar_verification.sql', '202610050003_directory_subscriptions.sql', '202610050007_directory_rate_cards.sql', '202610050008_directory_booking_hours.sql']) {
      await database.exec(await fs.readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    }
    await database.query('insert into auth.users(id) values ($1),($2)', [owner, stranger]);
    await database.query('insert into cc_private.verified_avatar_links(avatar_uuid,user_id,sl_username) values ($1,$2,$3)', [rates[0].id, owner, 'test.resident']);
    await database.exec("update cc_private.directory_plans set amount_linden=100,enabled=true where code='basic_monthly'");
    const profile = (await database.query('select public.register_directory_payment($1,$2,$3,$4) as id', [profileId, rates[0].id, 'basic_monthly', 100])).rows[0].id;
    const actAs = async (role, user = '') => {
      await database.exec('reset role');
      await database.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
      await database.exec(`set role ${role}`);
    };
    await actAs('authenticated', owner);
    assert.equal((await database.query('update public.directory_profiles set booking_hours=$1::jsonb,availability_note=$2 where id=$3 returning booking_hours', [JSON.stringify(hours), 'Available by appointment', profile])).rows.length, 1);
    for (const invalid of [{ ...hours, timezone: 'GMT' }, { ...hours, days: ['sat', 'sat'] }, { ...hours, end_time: '20:00' }, { ...hours, start_time: '25:00' }, { ...hours, is_approved: true }]) {
      await assert.rejects(database.query('update public.directory_profiles set booking_hours=$1::jsonb where id=$2', [JSON.stringify(invalid), profile]), error => error.code === '23514');
    }
    assert.equal((await database.query('update public.directory_profiles set rate_categories=$1::jsonb where id=$2 returning rate_categories', [JSON.stringify(rates), profile])).rows.length, 1);
    for (const invalid of [{}, [{ ...rates[0], extra: true }], [{ ...rates[0], items: [{ ...rates[0].items[0], price: 100 }] }], [rates[0], rates[0]]]) {
      await assert.rejects(database.query('update public.directory_profiles set rate_categories=$1::jsonb where id=$2', [JSON.stringify(invalid), profile]), error => error.code === '23514');
    }
    await actAs('anon');
    assert.equal((await database.query('select rate_categories from public.directory_profiles')).rows.length, 0);
    await actAs('authenticated', stranger);
    assert.equal((await database.query('update public.directory_profiles set booking_hours=null where id=$1 returning id', [profile])).rows.length, 0);
    assert.equal((await database.query('update public.directory_profiles set rate_categories=$1::jsonb where id=$2 returning id', ['[]', profile])).rows.length, 0);
    await actAs('authenticated', owner);
    await database.query('update public.directory_profiles set is_published=true where id=$1', [profile]);
    await actAs('anon');
    assert.deepEqual((await database.query('select rate_categories from public.directory_profiles')).rows[0].rate_categories, rates);
    assert.deepEqual((await database.query('select booking_hours from public.directory_profiles')).rows[0].booking_hours, hours);
    await actAs('service_role');
    await database.query("update cc_private.directory_subscriptions set expires_at=now()-interval '1 second' where avatar_uuid=$1", [rates[0].id]);
    await actAs('anon');
    assert.equal((await database.query('select rate_categories from public.directory_profiles')).rows.length, 0);
    await actAs('authenticated', owner);
    assert.equal((await database.query('update public.directory_profiles set booking_hours=null where id=$1 returning id', [profile])).rows.length, 0);
    assert.equal((await database.query('update public.directory_profiles set rate_categories=$1::jsonb where id=$2 returning id', ['[]', profile])).rows.length, 0);
  } finally { await database.close(); }
});

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

test('rate editor reorders and removes services without changing identifiers or losing edited values', () => {
  const { document } = parseHTML('<button id="add"></button><fieldset><div id="editor"></div></fieldset>');
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    const editor = initRateCardEditor(document.getElementById('editor'), document.getElementById('add'));
    const second = { ...rates[0].items[0], id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Follow-up' };
    editor.load([{ ...rates[0], items: [rates[0].items[0], second] }]);
    const name = document.getElementById(`rate-${rates[0].items[0].id}-name`);
    name.value = 'Updated appointment';
    name.dispatchEvent(new document.defaultView.Event('input'));
    document.querySelector('[aria-label="Move service down"]').click();
    assert.equal(editor.value()[0].items[1].name, 'Updated appointment');
    assert.equal(editor.value()[0].items[1].id, rates[0].items[0].id);
    document.querySelector('[aria-label="Remove service"]').click();
    assert.equal(editor.value()[0].items.length, 1);
    document.querySelector('[aria-label="Remove category"]').click();
    assert.deepEqual(editor.value(), []);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test('booking editor distinguishes unset schedules and no available days without losing overnight times', () => {
  const { document } = parseHTML('<div id="editor"><input type="checkbox" data-booking-enabled><fieldset data-booking-fields><select data-booking-timezone></select><input data-booking-start><input data-booking-end><select data-booking-interval><option value="60">60</option></select><textarea data-booking-notes></textarea><input type="checkbox" data-booking-day="sat"><input type="checkbox" data-booking-day="sun"></fieldset></div>');
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    for (const select of document.querySelectorAll('#editor select')) {
      let value = select.querySelector('option')?.value || '';
      Object.defineProperty(select, 'value', { get: () => value, set: next => { value = String(next); } });
    }
    const editor = initBookingHoursEditor(document.getElementById('editor'));
    editor.load(null);
    assert.equal(editor.value(), null);
    assert.equal(document.querySelector('[data-booking-fields]').disabled, true);
    editor.load({ ...hours, end_time: '02:00' });
    assert.deepEqual(editor.value(), { ...hours, end_time: '02:00' });
    editor.load({ ...hours, days: [] });
    assert.deepEqual(editor.value().days, []);
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});
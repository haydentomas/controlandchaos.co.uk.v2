import { GALLERY_SOURCE_MAX_BYTES, GALLERY_STORED_MAX_BYTES, validateGalleryUpload, optimizeGalleryUpload } from '../src/modules/gallery-image-upload.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { validateRateCategories, renderPublicRateCards } from '../src/modules/rate-cards.js';
import { initRateCardEditor } from '../src/modules/rate-card-editor.js';
import { validateBookingHours, bookingLocalTime, renderBookingHours, initBookingHoursEditor } from '../src/modules/booking-hours.js';
import { validateGalleryPhotos, galleryImageUrl, fetchGalleryPhotos, renderProfileGallery, renderGalleryPreview } from '../src/modules/profile-gallery.js';
import { initProfileGalleryEditor } from '../src/modules/profile-gallery-editor.js';
import { validateHardwareItems, validateWishlistItems, renderHardwareItems, renderWishlistItems, initProfileCollectionEditor, HARDWARE_FIELDS, WISHLIST_FIELDS, createHardwareItem, createWishlistItem } from '../src/modules/profile-collections.js';
import { initAccountDirectory } from '../src/modules/account-directory.js';
import { CREATOR_PROFILE_COLUMNS, myDirectorySubscriptions, loadCreatorProfile, saveCreatorProfile, profileChanges, subscriptionLabel } from '../src/modules/creator-profile-api.js';

const profileId = '33333333-3333-4333-8333-333333333333';
const values = { display_name: 'Test Creator', headline: '', tagline: '', about: 'Profile text', starting_rate: '', role_type: 'switch', availability: 'available', avatar_image: '', banner_image: '', tags: ['RLV'], is_published: false };
const rates = [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Consultations', description: 'Private appointments', items: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Introduction', price: 'L$1,000', unit: '30 minutes', description: 'A first appointment' }] }];
const hours = { timezone: 'America/Los_Angeles', days: ['sat', 'sun'], start_time: '20:00', end_time: '23:00', slot_minutes: 60, notes: 'Advance booking recommended.' };
const photos = [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', title: 'Portrait', category: 'Portraits', description: 'Profile portrait', image_url: 'https://images.example.test/portrait.jpg', is_published: true }, { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', title: 'Draft photo', category: '', description: '', image_url: 'https://images.example.test/private.jpg', is_published: false }];

test('gallery validation accepts metadata and safe image locations but rejects forged ownership and unsafe URLs', () => {
  assert.deepEqual(validateGalleryPhotos(photos), photos);
  for (const image_url of ['javascript:alert(1)', '//unsafe.test/image.jpg', 'http://unsafe.test/image.jpg', 'https://user:password@unsafe.test/image.jpg', '/\\unsafe.test/image.jpg']) assert.equal(galleryImageUrl(image_url), '');
  assert.throws(() => validateGalleryPhotos([{ ...photos[0], profile_id: profileId }]));
  assert.throws(() => validateGalleryPhotos([photos[0], photos[0]]));
  assert.throws(() => validateGalleryPhotos([{ ...photos[0], image_url: '', storage_path: `${profileId}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp` }]));
});

  test('gallery upload accepts common photo formats and optimizes them to bounded WebP', async () => {
    assert.equal(validateGalleryUpload({ type: 'image/jpeg', size: 1000 }), true);
    assert.equal(validateGalleryUpload({ type: 'image/png', size: 1000 }), true);
    assert.equal(validateGalleryUpload({ type: 'image/webp', size: 1000 }), true);
    assert.equal(validateGalleryUpload({ type: 'image/jpeg', size: GALLERY_SOURCE_MAX_BYTES }), true);
    assert.throws(() => validateGalleryUpload({ type: 'image/svg+xml', size: 1000 }), /JPEG, PNG, or WebP/);
    assert.throws(() => validateGalleryUpload({ type: 'image/jpeg', size: GALLERY_SOURCE_MAX_BYTES + 1 }), /no larger than 10 MB/);
    let closed = false;
    let canvas;
    const qualities = [];
    const bitmap = { width: 4000, height: 2000, close() { closed = true; } };
    const documentImpl = { createElement: () => {
      canvas = {
        getContext: () => ({ drawImage() {} }),
        toBlob(callback, type, quality) {
          qualities.push(quality);
          const size = qualities.length === 1 ? GALLERY_STORED_MAX_BYTES + 1 : 1000;
          callback(new Blob([new Uint8Array(size)], { type }));
        }
      };
      return canvas;
    } };
    const createImageBitmapImpl = async () => bitmap;
    const blob = await optimizeGalleryUpload({ type: 'image/jpeg', size: 1000 }, { createImageBitmapImpl, documentImpl });
    assert.equal(blob.type, 'image/webp');
    assert.ok(blob.size <= GALLERY_STORED_MAX_BYTES);
    assert.deepEqual(qualities, [0.84, 0.76]);
    assert.equal(closed, true);
    assert.deepEqual([canvas.width, canvas.height], [2048, 1024]);
  });

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
    assert.match(document.querySelector('.public-booking-hours-time').textContent, /next day/);
    assert.deepEqual([...document.querySelectorAll('.public-booking-hours-days li')].map(day => day.textContent), ['Saturday', 'Sunday']);
    assert.match(document.querySelector('.public-booking-hours-interval').textContent, /60 minutes/);
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
  const { document, window } = parseHTML('<div id="rates"></div>');
  const previous = globalThis.document;
  globalThis.document = document;
  let selectedServices = [];
  try {
    renderPublicRateCards(document.getElementById('rates'), [{ ...rates[0], title: '<img src=x onerror=alert(1)>', items: [{ ...rates[0].items[0], description: '<script>unsafe()</script>\n\n[Details](https://example.test)' }] }], { bookingEnabled: true, onSelectionChange: services => { selectedServices = services; } });
    assert.equal(document.querySelectorAll('img,script').length, 0);
    assert.match(document.getElementById('rates').textContent, /<script>/);
    const service = document.querySelector('.service-select-toggle');
    const copy = document.querySelector('.service-select-copy');
    const details = document.querySelector('.service-select-details');
    assert.ok(service);
    assert.ok(copy.contains(service));
    assert.ok(copy.contains(details));
    assert.equal(service.contains(details), false);
    assert.equal(service.getAttribute('aria-pressed'), 'false');
    document.querySelector('.service-select-details a').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(service.getAttribute('aria-pressed'), 'false');
    service.click();
    assert.equal(service.getAttribute('aria-pressed'), 'true');
    assert.equal(document.querySelector('.public-profile-rate-quote-total').textContent, 'L1,000');
    assert.equal(document.querySelector('.public-profile-rate-quote-count').textContent, '(1 selected)');
    assert.deepEqual(selectedServices, [{ id: rates[0].items[0].id, name: rates[0].items[0].name, category: '<img src=x onerror=alert(1)>', amount: 1000 }]);
    assert.equal(document.querySelector('.public-profile-rate-quote-action').getAttribute('href'), '#booking-enquiry-section');
    assert.equal(document.querySelector('.public-profile-rate-quote').hidden, false);
    service.click();
    assert.equal(service.getAttribute('aria-pressed'), 'false');
    assert.equal(document.querySelector('.public-profile-rate-quote').hidden, true);
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
    for (const file of ['202610040001_directory_foundation.sql', '202610040002_avatar_verification.sql', '202610050003_directory_subscriptions.sql', '202610050007_directory_rate_cards.sql', '202610050008_directory_booking_hours.sql', '202610050009_directory_gallery.sql']) {
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
    await database.query('select * from public.save_directory_profile_media($1,$2::jsonb,$3::jsonb)', [profile, JSON.stringify({ headline: 'Atomic media save' }), JSON.stringify(photos)]);
    const invalidPhotos = [{ ...photos[0], image_url: 'javascript:alert(1)' }];
    await assert.rejects(database.query('select * from public.save_directory_profile_media($1,$2::jsonb,$3::jsonb)', [profile, JSON.stringify({ headline: 'Must roll back' }), JSON.stringify(invalidPhotos)]));
    assert.equal((await database.query('select headline from public.directory_profiles where id=$1', [profile])).rows[0].headline, 'Atomic media save');
    assert.equal((await database.query('select id from public.directory_gallery_photos')).rows.length, 2);
    await assert.rejects(database.query('select * from public.save_directory_profile_media($1,$2::jsonb,$3::jsonb)', [profile, JSON.stringify({ is_approved: true }), JSON.stringify(photos)]), /invalid_profile_fields/);
    for (const invalid of [{}, [{ ...rates[0], extra: true }], [{ ...rates[0], items: [{ ...rates[0].items[0], price: 100 }] }], [rates[0], rates[0]]]) {
      await assert.rejects(database.query('update public.directory_profiles set rate_categories=$1::jsonb where id=$2', [JSON.stringify(invalid), profile]), error => error.code === '23514');
    }
    await actAs('anon');
    assert.equal((await database.query('select * from public.directory_gallery_photos')).rows.length, 0);
    await assert.rejects(database.query('select * from public.save_directory_profile_media($1,$2::jsonb,$3::jsonb)', [profile, '{}', '[]']), error => error.code === '42501');
    assert.equal((await database.query('select rate_categories from public.directory_profiles')).rows.length, 0);
    await actAs('authenticated', stranger);
    await assert.rejects(database.query('select * from public.save_directory_profile_media($1,$2::jsonb,$3::jsonb)', [profile, '{}', '[]']), error => error.code === '42501');
    assert.equal((await database.query('update public.directory_profiles set booking_hours=null where id=$1 returning id', [profile])).rows.length, 0);
    assert.equal((await database.query('update public.directory_profiles set rate_categories=$1::jsonb where id=$2 returning id', ['[]', profile])).rows.length, 0);
    await actAs('authenticated', owner);
    await database.query('update public.directory_profiles set is_published=true where id=$1', [profile]);
    await actAs('anon');
    assert.deepEqual((await database.query('select rate_categories from public.directory_profiles')).rows[0].rate_categories, rates);
    assert.deepEqual((await database.query('select id,image_url from public.directory_gallery_photos')).rows, [{ id: photos[0].id, image_url: photos[0].image_url }]);
    assert.deepEqual((await database.query('select booking_hours from public.directory_profiles')).rows[0].booking_hours, hours);
    await actAs('service_role');
    await database.query("update cc_private.directory_subscriptions set expires_at=now()-interval '1 second' where avatar_uuid=$1", [rates[0].id]);
    await actAs('anon');
    assert.equal((await database.query('select rate_categories from public.directory_profiles')).rows.length, 0);
    await actAs('authenticated', owner);
    assert.equal((await database.query('update public.directory_profiles set booking_hours=null where id=$1 returning id', [profile])).rows.length, 0);
    await assert.rejects(database.query('select * from public.save_directory_profile_media($1,$2::jsonb,$3::jsonb)', [profile, '{}', '[]']), error => error.code === '42501');
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
  assert.equal(profileChanges({ ...values, booking_email: '  bookings@example.test ' }).booking_email, 'bookings@example.test');
  for (const booking_email of ['not-an-email', 'x'.repeat(255) + '@example.test', null, 123]) assert.throws(() => profileChanges({ ...values, booking_email }), /booking contact email/);
  const toys = [{ name: 'Lovense Gush', desc: 'Remote control', icon: '\u{1F4A0}', badge_text: 'Ready' }];
  const wishlist = [{ title: 'Throne Wishlist', url: 'https://throne.com/example', note: 'Gifts' }];
  assert.deepEqual(profileChanges({ ...values, hardware_title: ' My Toys ', hardware_compat: toys, wishlist_title: ' Wishlist ', wishlist }).hardware_compat, toys);
  assert.throws(() => profileChanges({ ...values, hardware_compat: [{ name: 'Gush', extra: 'not allowed' }] }), /Invalid/);
  assert.throws(() => profileChanges({ ...values, wishlist: [{ ...wishlist[0], url: 'javascript:alert(1)' }] }), /safe HTTPS/);
});

test('profile protocol validates exact text limits, trims values and preserves omitted fields', () => {
  for (const field of ['boundaries', 'booking_instructions']) {
    assert.equal(profileChanges(values)[field], undefined);
    assert.equal(profileChanges({ ...values, [field]: '   ' })[field], '');
    assert.equal(profileChanges({ ...values, [field]: '  Instructions\nSecond line  ' })[field], 'Instructions\nSecond line');
    assert.equal(profileChanges({ ...values, [field]: 'x'.repeat(4000) })[field].length, 4000);
    assert.throws(() => profileChanges({ ...values, [field]: 'x'.repeat(4001) }), /4000/);
    for (const invalid of [null, false, 123, [], {}]) assert.throws(() => profileChanges({ ...values, [field]: invalid }), /4000/);
  }
});

test('profile protocol migration preserves paid ownership, atomic gallery saves and public visibility', async () => {
  const database = new PGlite();
  const owner = '11111111-1111-4111-8111-111111111111';
  const stranger = '22222222-2222-4222-8222-222222222222';
  try {
    await database.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated,service_role;`);
    for (const file of ['202610040001_directory_foundation.sql', '202610040002_avatar_verification.sql', '202610050003_directory_subscriptions.sql', '202610050007_directory_rate_cards.sql', '202610050008_directory_booking_hours.sql', '202610050009_directory_gallery.sql']) {
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
    await database.query('select * from public.save_directory_profile_media($1,$2::jsonb,$3::jsonb)', [profile, JSON.stringify({ about: 'Existing biography', rate_categories: rates, booking_hours: hours }), JSON.stringify(photos)]);
    await database.exec('reset role');
    await database.exec(await fs.readFile(new URL('../supabase/migrations/202610050010_directory_profile_protocol.sql', import.meta.url), 'utf8'));
    const verification = await database.query(await fs.readFile(new URL('../supabase/verify-directory-profile-protocol.sql', import.meta.url), 'utf8').then(sql => sql.split(';')[0]));
    assert.deepEqual(verification.rows[0], {
      anon_can_edit_boundaries: false, account_can_edit_boundaries: true, account_can_edit_instructions: true,
      anon_can_save_media: false, account_can_save_media: true
    });
    assert.deepEqual((await database.query('select boundaries,booking_instructions,about from public.directory_profiles where id=$1', [profile])).rows[0], { boundaries: '', booking_instructions: '', about: 'Existing biography' });
    assert.deepEqual((await database.query('select has_column_privilege($1,$2,$3,$4) as allowed', ['authenticated', 'public.directory_profiles', 'boundaries', 'UPDATE'])).rows[0], { allowed: true });
    assert.equal((await database.query("select has_function_privilege('anon','public.save_directory_profile_media(uuid,jsonb,jsonb)','EXECUTE') as allowed")).rows[0].allowed, false);
    await actAs('authenticated', owner);
    const protocol = { boundaries: '**Respect stated boundaries.**\n\n- Use agreed limits.\n- Confirm first.', booking_instructions: 'Contact me in-world.\n\n1. Send a message.\n2. Confirm a time before booking.' };
    const save = changes => database.query('select * from public.save_directory_profile_media($1,$2::jsonb,$3::jsonb)', [profile, JSON.stringify(changes), JSON.stringify(photos)]);
    await save(protocol);
    await save({ boundaries: '', booking_instructions: '' });
    assert.deepEqual((await database.query('select boundaries,booking_instructions from public.directory_profiles where id=$1', [profile])).rows[0], { boundaries: '', booking_instructions: '' });
    await save(protocol);
    await save({ headline: 'Older client update' });
    let row = (await database.query('select * from public.directory_profiles where id=$1', [profile])).rows[0];
    assert.equal(row.boundaries, protocol.boundaries);
    assert.equal(row.booking_instructions, protocol.booking_instructions);
    assert.deepEqual(row.rate_categories, rates);
    assert.deepEqual(row.booking_hours, hours);
    assert.equal(row.about, 'Existing biography');
    for (const field of ['boundaries', 'booking_instructions']) {
      await save({ [field]: 'x'.repeat(4000) });
      await assert.rejects(save({ [field]: 'x'.repeat(4001) }), error => error.code === '23514');
      for (const invalid of [null, 123, false, {}, []]) await assert.rejects(save({ [field]: invalid }), /invalid_profile_fields/);
      await assert.rejects(database.query(`update public.directory_profiles set ${field}=null where id=$1`, [profile]), error => error.code === '23502');
      await assert.rejects(database.query(`update public.directory_profiles set ${field}=$1 where id=$2`, ['x'.repeat(4001), profile]), error => error.code === '23514');
    }
    await save(protocol);
    await assert.rejects(database.query('select * from public.save_directory_profile_media($1,$2::jsonb,$3::jsonb)', [profile, JSON.stringify({ boundaries: 'Must roll back' }), JSON.stringify([{ ...photos[0], image_url: 'javascript:alert(1)' }])]));
    row = (await database.query('select * from public.directory_profiles where id=$1', [profile])).rows[0];
    assert.equal(row.boundaries, protocol.boundaries);
    assert.equal((await database.query('select id from public.directory_gallery_photos')).rows.length, 2);
    await assert.rejects(save({ is_approved: true }), /invalid_profile_fields/);
    await actAs('anon');
    assert.equal((await database.query('select boundaries from public.directory_profiles')).rows.length, 0);
    await assert.rejects(save(protocol), error => error.code === '42501');
    await actAs('authenticated', stranger);
    assert.equal((await database.query('update public.directory_profiles set boundaries=$1 where id=$2 returning id', ['Changed', profile])).rows.length, 0);
    await assert.rejects(save(protocol), error => error.code === '42501');
    await actAs('authenticated', owner);
    await save({ ...protocol, is_published: true });
    await actAs('anon');
    assert.deepEqual((await database.query('select boundaries,booking_instructions from public.directory_profiles')).rows[0], protocol);
    await actAs('service_role');
    await database.query("update cc_private.directory_subscriptions set expires_at=now()-interval '1 second' where avatar_uuid=$1", [rates[0].id]);
    await actAs('anon');
    assert.equal((await database.query('select boundaries from public.directory_profiles')).rows.length, 0);
    await actAs('authenticated', owner);
    await assert.rejects(save(protocol), error => error.code === '42501');
    assert.equal((await database.query('update public.directory_profiles set booking_instructions=$1 where id=$2 returning id', ['Changed', profile])).rows.length, 0);
  } finally { await database.close(); }
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

test('owner API selects protocol fields and saves them with existing gallery, rates and hours', async () => {
  let selected;
  let saved;
  let failed = false;
  const updated = { id: profileId, ...values, boundaries: 'Respect limits.', booking_instructions: 'Contact me.', rate_categories: rates, booking_hours: hours, booking_email: 'bookings@example.test' };
  const client = {
    from: name => {
      assert.equal(name, 'directory_profiles');
      const chain = { select: columns => { selected = { name, columns }; return chain; }, eq: () => chain, maybeSingle: async () => ({ data: updated }) };
      return chain;
    },
    rpc: (name, args) => {
      if (name === 'my_directory_subscriptions') return Promise.resolve({ data: [{ profile_id: profileId, is_active: true }] });
      if (name === 'my_directory_booking_contact') return Promise.resolve({ data: updated.booking_email, error: null });
      assert.equal(name, 'save_directory_profile_booking');
      saved = args;
      return { maybeSingle: async () => failed ? { error: { message: 'private' } } : { data: updated } };
    }
  };
  assert.equal((await loadCreatorProfile(client, profileId)).boundaries, updated.boundaries);
  assert.equal((await loadCreatorProfile(client, profileId)).booking_email, updated.booking_email);
  assert.deepEqual(selected, { name: 'directory_profiles', columns: CREATOR_PROFILE_COLUMNS });
  const input = { ...values, boundaries: ' Respect limits. ', booking_instructions: ' Contact me. ', booking_email: ' bookings@example.test ', rate_categories: rates, booking_hours: hours };
  assert.deepEqual(await saveCreatorProfile(client, profileId, input, photos), updated);
  assert.equal(saved.target_profile, profileId);
  assert.equal(saved.profile_changes.boundaries, updated.boundaries);
  assert.equal(saved.profile_changes.booking_instructions, updated.booking_instructions);
  assert.deepEqual(saved.profile_changes.rate_categories, rates);
  assert.deepEqual(saved.profile_changes.booking_hours, hours);
  assert.equal(saved.profile_changes.booking_email, undefined);
  assert.equal(saved.contact_email, updated.booking_email);
  assert.deepEqual(saved.photos, photos);
  failed = true;
  await assert.rejects(saveCreatorProfile(client, profileId, input, photos), /not saved/);
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

test('gallery editor reorders and removes photos while public rendering excludes unpublished URLs', () => {
  const { document } = parseHTML('<section id="creator-gallery"><button id="add"></button><p data-gallery-count></p><fieldset><div id="editor"></div></fieldset></section><div id="filters"></div><div id="grid"></div>');
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    const editor = initProfileGalleryEditor(document.getElementById('editor'), document.getElementById('add'));
    editor.load(photos);
    assert.equal(document.querySelector('[data-gallery-count]').textContent, '2 / 20 photos');
    const sidebarChoice = document.querySelectorAll('[data-gallery-editor-photo] .profile-feature-switch input[type="checkbox"]')[1];
    assert.equal(sidebarChoice.checked, true);
    sidebarChoice.checked = false;
    sidebarChoice.dispatchEvent(new document.defaultView.Event('change'));
    assert.equal(editor.value()[0].show_in_sidebar, false);
    document.querySelector('[aria-label="Move photo down"]').click();
    assert.equal(editor.value()[1].id, photos[0].id);
    assert.equal(editor.value()[1].show_in_sidebar, false);
    document.querySelector('[aria-label="Remove photo"]').click();
    assert.equal(editor.value().length, 1);
    assert.equal(document.querySelector('[data-gallery-count]').textContent, '1 / 20 photos');
    renderProfileGallery(document.getElementById('grid'), document.getElementById('filters'), [{ ...photos[0], title: '<script>unsafe()</script>' }, photos[1]]);
    assert.equal(document.querySelectorAll('[data-photo]').length, 1);
    assert.equal(document.querySelectorAll('script').length, 0);
    assert.ok(!document.getElementById('grid').innerHTML.includes(photos[1].image_url));
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});

test('gallery editor stages optimized WebP uploads and rolls back failed profile saves', async () => {
  const { document } = parseHTML('<button id="add"></button><fieldset><div id="editor"></div></fieldset>');
  const previousDocument = globalThis.document;
  const previousCreateObjectUrl = URL.createObjectURL;
  const previousRevokeObjectUrl = URL.revokeObjectURL;
  globalThis.document = document;
  let objectNumber = 0;
  URL.createObjectURL = () => `blob:test-${++objectNumber}`;
  URL.revokeObjectURL = () => {};
  const uploaded = [];
  const removed = [];
  const optimized = new Blob(['webp'], { type: 'image/webp' });
  const storage = { from(bucket) {
    assert.equal(bucket, 'directory-gallery');
    return {
      upload: async (path, body, options) => { uploaded.push({ path, body, options }); return { error: null }; },
      remove: async paths => { removed.push(...paths); return { error: null }; }
    };
  } };
  try {
    const editor = initProfileGalleryEditor(document.getElementById('editor'), document.getElementById('add'), { optimizeImage: async file => { assert.equal(file.type, 'image/jpeg'); return optimized; } });
    const original = { ...photos[0], storage_path: `${profileId}/${photos[0].id}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp`, image_url: '' };
    editor.load([original]);
    const input = document.querySelector('input[type="file"]');
    assert.equal(document.querySelector('[data-gallery-editor-photo]').children[1].querySelector('input[type="file"]'), input);
    const file = new Blob(['jpeg'], { type: 'image/jpeg' });
    Object.defineProperty(file, 'name', { value: 'portrait.jpg' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new document.defaultView.Event('change'));
    const batch = await editor.uploadPending(profileId, storage);
    assert.equal(uploaded.length, 1);
    assert.match(uploaded[0].path, new RegExp(`^${profileId}/${photos[0].id}/[a-f0-9-]{36}\\.webp$`));
    assert.equal(uploaded[0].body, optimized);
    assert.equal(uploaded[0].options.contentType, 'image/webp');
    assert.equal(editor.value()[0].storage_path, uploaded[0].path);
    assert.equal(editor.value()[0].image_url, '');
    await editor.rollbackUploads(storage, batch);
    assert.deepEqual(removed, [uploaded[0].path]);
    assert.equal(editor.value()[0].storage_path, original.storage_path);
    assert.equal(editor.value()[0].image_url, '');
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    URL.createObjectURL = previousCreateObjectUrl;
    URL.revokeObjectURL = previousRevokeObjectUrl;
  }
});

test('profile and gallery save through one atomic RPC and failed responses never report success', async () => {
  let request;
  let failed = false;
  const client = { rpc: (name, args) => {
    if (name === 'my_directory_subscriptions') return Promise.resolve({ data: [{ profile_id: profileId, is_active: true }] });
    request = { name, args };
    return { maybeSingle: async () => failed ? { error: { message: 'private error' } } : { data: { id: profileId, ...values } } };
  } };
  assert.equal((await saveCreatorProfile(client, profileId, values, photos)).id, profileId);
  assert.deepEqual(request, { name: 'save_directory_profile_booking', args: { target_profile: profileId, profile_changes: values, photos, contact_email: '' } });
  failed = true;
  await assert.rejects(saveCreatorProfile(client, profileId, values, photos), error => /not saved/.test(error.message) && !error.message.includes('private error'));
});

test('booking recipient RPC is private and requires an active published booking profile', async () => {
  const database = new PGlite();
  const owner = '11111111-1111-4111-8111-111111111111';
  const stranger = '22222222-2222-4222-8222-222222222222';
  try {
    await database.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
      create schema storage; create table storage.buckets(id text primary key,name text not null,public boolean not null,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(bucket_id text not null,name text not null,primary key(bucket_id,name)); alter table storage.objects enable row level security;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth,storage to anon,authenticated,service_role;
      grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;`);
    for (const file of ['202610040001_directory_foundation.sql', '202610040002_avatar_verification.sql', '202610050003_directory_subscriptions.sql', '202610050007_directory_rate_cards.sql', '202610050008_directory_booking_hours.sql', '202610050009_directory_gallery.sql', '202610050010_directory_profile_protocol.sql', '202610060011_directory_booking_recipient.sql', '202610060012_directory_gallery_storage.sql', '202610060013_directory_profile_booking_fields.sql']) {
      await database.exec(await fs.readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    }
    assert.deepEqual((await database.query('select public,file_size_limit,allowed_mime_types from storage.buckets where id=$1', ['directory-gallery'])).rows[0], { public: false, file_size_limit: 2097152, allowed_mime_types: ['image/webp'] });
    await database.query('insert into auth.users(id,email,email_confirmed_at) values ($1,$2,now()),($3,$4,now())', [owner, 'creator@example.test', stranger, 'stranger@example.test']);
    await database.query('insert into cc_private.verified_avatar_links(avatar_uuid,user_id,sl_username) values ($1,$2,$3)', [rates[0].id, owner, 'test.resident']);
    await database.exec("update cc_private.directory_plans set amount_linden=100,enabled=true where code='basic_monthly'");
    const profile = (await database.query('select public.register_directory_payment($1,$2,$3,$4) as id', [profileId, rates[0].id, 'basic_monthly', 100])).rows[0].id;
    await database.query('select set_config(\'request.jwt.claim.sub\',$1,false)', [owner]);
    await database.exec('set role authenticated');
    await database.query('update public.directory_profiles set is_published=true,rate_categories=$1::jsonb,booking_hours=$2::jsonb where id=$3', [JSON.stringify(rates), JSON.stringify(hours), profile]);
    const storagePhotos = [
      { ...photos[0], image_url: '', storage_path: `${profile}/${photos[0].id}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp`, show_in_sidebar: false },
      { ...photos[1], image_url: '', storage_path: `${profile}/${photos[1].id}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp`, show_in_sidebar: true }
    ];
    const canUpload = path => database.query('select cc_private.can_upload_directory_gallery_object($1) as allowed', [path]);
    assert.equal((await canUpload(storagePhotos[0].storage_path)).rows[0].allowed, true);
    await database.query('insert into storage.objects(bucket_id,name) values ($1,$2)', ['directory-gallery', storagePhotos[0].storage_path]);
    assert.equal((await canUpload(storagePhotos[1].storage_path)).rows[0].allowed, true);
    await database.query('insert into storage.objects(bucket_id,name) values ($1,$2)', ['directory-gallery', storagePhotos[1].storage_path]);
    const twentyFirst = `${profile}/ffffffff-ffff-4fff-8fff-ffffffffffff/cccccccc-cccc-4ccc-8ccc-cccccccccccc.webp`;
    for (let index = 0; index < 18; index++) {
      await database.query('insert into storage.objects(bucket_id,name) values ($1,$2)', ['directory-gallery', `${profile}/${String(index).padStart(8, '0')}-ffff-4fff-8fff-ffffffffffff/dddddddd-dddd-4ddd-8ddd-dddddddddddd.webp`]);
    }
    assert.equal((await canUpload(twentyFirst)).rows[0].allowed, false);
    const toys = [{ name: 'Lovense Gush', desc: 'Remote control', icon: '\u{1F4A0}', badge_text: 'Ready' }];
    const wishlist = [{ title: 'Throne Wishlist', url: 'https://throne.com/example', note: 'Gifts' }];
    const collectionChanges = { boundaries: 'Respect limits.', booking_instructions: 'Contact me.', hardware_title: 'My Toys', hardware_compat: toys, wishlist_title: 'Wishlist & Tributes', wishlist };
    const saved = (await database.query('select * from public.save_directory_profile_booking($1,$2::jsonb,$3::jsonb,$4)', [profile, JSON.stringify(collectionChanges), JSON.stringify(storagePhotos), 'bookings@example.test'])).rows[0];
    assert.equal(saved.boundaries, 'Respect limits.');
    assert.equal(saved.booking_instructions, 'Contact me.');
    assert.equal(saved.hardware_title, 'My Toys');
    assert.deepEqual(saved.hardware_compat, toys);
    assert.equal(saved.wishlist_title, 'Wishlist & Tributes');
    assert.deepEqual(saved.wishlist, wishlist);
    const profileCollections = (await database.query('select boundaries,booking_instructions,hardware_title,hardware_compat,wishlist_title,wishlist from public.directory_profiles where id=$1', [profile])).rows[0];
    assert.deepEqual(profileCollections, { boundaries: 'Respect limits.', booking_instructions: 'Contact me.', hardware_title: 'My Toys', hardware_compat: toys, wishlist_title: 'Wishlist & Tributes', wishlist });
    assert.deepEqual((await database.query('select show_in_sidebar,storage_path,image_url from public.directory_gallery_photos where profile_id=$1 order by sort_order', [profile])).rows, storagePhotos.map(photo => ({ show_in_sidebar: photo.show_in_sidebar, storage_path: photo.storage_path, image_url: '' })));
    assert.equal((await canUpload(`${profile}/${photos[0].id}/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.webp`)).rows[0].allowed, true);
    assert.equal((await canUpload(`${profile}/ffffffff-ffff-4fff-8fff-ffffffffffff/cccccccc-cccc-4ccc-8ccc-cccccccccccc.webp`)).rows[0].allowed, false);
    assert.equal((await database.query('select public.my_directory_booking_contact($1)', [profile])).rows[0].my_directory_booking_contact, 'bookings@example.test');
    await database.exec('reset role; set role service_role');
    for (const invalid of [
      { column: 'hardware_compat', value: [{ name: 'Gush', extra: true }] },
      { column: 'wishlist', value: [{ title: 'Unsafe', url: 'javascript:alert(1)' }] }
    ]) {
      await assert.rejects(database.query(`update public.directory_profiles set ${invalid.column}=$1::jsonb where id=$2`, [JSON.stringify(invalid.value), profile]), error => error.code === '23514');
    }
    const recipient = async () => (await database.query('select * from public.directory_booking_recipient($1)', [profile])).rows;
    assert.deepEqual(await recipient(), [{ recipient_email: 'bookings@example.test', display_name: 'test.resident', sl_username: 'test.resident', rate_categories: rates, booking_hours: hours }]);
    await database.exec('reset role; set role anon');
    assert.deepEqual((await database.query('select name from storage.objects where bucket_id=$1 order by name', ['directory-gallery'])).rows, [{ name: storagePhotos[0].storage_path }]);
    const publicCollections = (await database.query('select hardware_title,hardware_compat,wishlist_title,wishlist from public.directory_profiles where id=$1', [profile])).rows[0];
    assert.deepEqual(publicCollections, { hardware_title: 'My Toys', hardware_compat: toys, wishlist_title: 'Wishlist & Tributes', wishlist });
    assert.equal(Object.hasOwn(publicCollections, 'contact_email'), false);
    await assert.rejects(database.query('select contact_email from cc_private.directory_booking_contacts'), error => error.code === '42501');
    assert.deepEqual((await database.query('select name from storage.objects where bucket_id=$1 order by name', ['directory-gallery'])).rows, [{ name: storagePhotos[0].storage_path }]);
    await database.exec('reset role; set role authenticated');
    await database.query("select set_config('request.jwt.claim.sub',$1,false)", [stranger]);
    assert.equal((await database.query('select contact_email from cc_private.directory_booking_contacts')).rows.length, 0);
    assert.equal((await database.query('select public.my_directory_booking_contact($1)', [profile])).rows[0].my_directory_booking_contact, null);
    await assert.rejects(database.query('insert into storage.objects(bucket_id,name) values ($1,$2)', ['directory-gallery', `${profile}/ffffffff-ffff-4fff-8fff-ffffffffffff/cccccccc-cccc-4ccc-8ccc-cccccccccccc.webp`]), error => error.code === '42501');
    await database.exec('reset role; set role service_role');
    await database.query('delete from cc_private.directory_booking_contacts where profile_id=$1', [profile]);
    assert.equal((await recipient())[0].recipient_email, 'creator@example.test');
    await database.exec('reset role; set role anon');
    await assert.rejects(recipient(), error => error.code === '42501');
    await database.exec('reset role; set role service_role');
    await database.query('update public.directory_profiles set booking_hours=null where id=$1', [profile]);
    assert.deepEqual(await recipient(), []);
    await database.query('update public.directory_profiles set booking_hours=$1::jsonb,is_published=false where id=$2', [JSON.stringify(hours), profile]);
    assert.deepEqual(await recipient(), []);
    await database.query('update public.directory_profiles set is_published=true where id=$1', [profile]);
    await database.query("update cc_private.directory_subscriptions set expires_at=now()-interval '1 second' where avatar_uuid=$1", [rates[0].id]);
    assert.deepEqual(await recipient(), []);
    await database.exec('reset role; set role anon');
    assert.equal((await database.query('select name from storage.objects where bucket_id=$1', ['directory-gallery'])).rows.length, 0);
  } finally { await database.close(); }
});

test('sidebar gallery preview respects owner choices without changing full-gallery publication', () => {
  const { document } = parseHTML('<div id="filters"></div><div id="gallery"></div><div id="preview"></div>');
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    const choices = [
      { ...photos[0], show_in_sidebar: true },
      { ...photos[0], id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', title: 'Not in sidebar', show_in_sidebar: false },
      { ...photos[1], id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddf', title: 'Unpublished', is_published: false, show_in_sidebar: true }
    ];
    renderProfileGallery(document.getElementById('gallery'), document.getElementById('filters'), choices);
    renderGalleryPreview(document.getElementById('preview'), choices);
    assert.equal(document.querySelectorAll('#gallery [data-photo]').length, 2);
    assert.equal(document.querySelectorAll('#preview [data-photo]').length, 1);
    assert.equal(document.querySelector('#preview [data-photo]').dataset.photoTitle, photos[0].title);
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});

test('toy and wishlist repeaters validate fields, safe links and reorderable editor values', () => {
  const hardware = [{ name: 'Lovense Gush', desc: 'Remote control', icon: '\u{1F4A0}', badge_text: 'Ready' }];
  const wishlist = [{ title: 'Throne Wishlist', url: 'https://throne.com/example', note: 'Gifts and furnishings' }];
  assert.deepEqual(validateHardwareItems(hardware), hardware);
  assert.deepEqual(validateWishlistItems(wishlist), wishlist);
  for (const url of ['javascript:alert(1)', 'http://example.test', '//example.test', 'https://user:pass@example.test']) assert.throws(() => validateWishlistItems([{ ...wishlist[0], url }]), /safe HTTPS/);
  assert.throws(() => validateHardwareItems([{ name: ' ' }]), /Check repeater/);

  const { document } = parseHTML('<button id="add-toy"></button><button id="add-wishlist"></button><fieldset><div id="toys"></div><div id="wishlist"></div></fieldset><div id="public-toys"></div><div id="public-wishlist"></div>');
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    const toys = initProfileCollectionEditor(document.getElementById('toys'), document.getElementById('add-toy'), { kind: 'toys', fields: HARDWARE_FIELDS, validate: validateHardwareItems, createItem: createHardwareItem, limit: 30 });
    const gifts = initProfileCollectionEditor(document.getElementById('wishlist'), document.getElementById('add-wishlist'), { kind: 'wishlist', fields: WISHLIST_FIELDS, validate: validateWishlistItems, createItem: createWishlistItem, limit: 20 });
    toys.load([{ ...hardware[0] }, { name: 'RLV', desc: '', icon: '\u{1F512}', badge_text: 'Ready' }]);
    document.querySelector('[aria-label="Move item down"]').click();
    assert.deepEqual(toys.value().map(item => item.name), ['RLV', 'Lovense Gush']);
    document.querySelector('[aria-label="Remove item"]').click();
    assert.deepEqual(toys.value().map(item => item.name), ['Lovense Gush']);
    gifts.load(wishlist);
    renderHardwareItems(document.getElementById('public-toys'), [{ ...hardware[0], name: '<script>unsafe()</script>' }]);
    renderWishlistItems(document.getElementById('public-wishlist'), wishlist);
    assert.equal(document.querySelector('#public-toys script'), null);
    assert.match(document.getElementById('public-toys').textContent, /<script>unsafe\(\)<\/script>/);
    assert.equal(document.querySelector('#public-wishlist a').getAttribute('href'), wishlist[0].url);
    assert.equal(document.querySelector('#public-wishlist a').getAttribute('rel'), 'noopener noreferrer nofollow');
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});

test('gallery fetch falls back to legacy columns until sidebar migration is applied', async () => {
  const selected = [];
  const client = { from: table => {
    assert.equal(table, 'directory_gallery_photos');
    const chain = {
      select(columns) { selected.push(columns); return chain; },
      eq() { return chain; },
      order() { return chain; },
      then(resolve) {
        const columns = selected.at(-1);
        if (columns.includes('storage_path')) return resolve({ data: null, error: { message: 'column storage_path is missing from schema cache' } });
        if (columns.includes('show_in_sidebar')) return resolve({ data: null, error: { message: 'column show_in_sidebar is missing from schema cache' } });
        return resolve({ data: [{ ...photos[0], sort_order: 0 }], error: null });
      }
    };
    return chain;
  } };
  const result = await fetchGalleryPhotos(client, profileId);
  assert.equal(selected.length, 3);
  assert.equal(selected[2].includes('show_in_sidebar'), false);
  assert.equal(result[0].id, photos[0].id);
  assert.equal(result[0].show_in_sidebar, undefined);
});

test('storage-backed gallery images use short-lived signed URLs', async () => {
  const calls = [];
  const storedPhoto = { ...photos[0], image_url: '', storage_path: `${profileId}/${photos[0].id}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp`, show_in_sidebar: true, sort_order: 0 };
  const client = {
    from: () => {
      const query = { select: () => query, eq: () => query, order: () => query, then: resolve => Promise.resolve({ data: [storedPhoto], error: null }).then(resolve) };
      return query;
    },
    storage: { from: bucket => ({ createSignedUrl: async (path, expires) => { calls.push({ bucket, path, expires }); return { data: { signedUrl: 'https://signed.example/photo.webp' }, error: null }; } }) }
  };
  const [photo] = await fetchGalleryPhotos(client, profileId, { publishedOnly: true });
  assert.equal(photo.image_url, 'https://signed.example/photo.webp');
  assert.deepEqual(calls, [{ bucket: 'directory-gallery', path: storedPhoto.storage_path, expires: 3600 }]);
});
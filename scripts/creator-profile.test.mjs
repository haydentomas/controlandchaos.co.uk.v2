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
import { initCreatorBlogEditor } from '../src/modules/creator-blog.js';
import { creatorPassBenefits, renderCreatorBlogFeed } from '../src/modules/creator-blog-feed.js';
import { validateHardwareItems, validateWishlistItems, renderHardwareItems, renderWishlistItems, initProfileCollectionEditor, HARDWARE_FIELDS, WISHLIST_FIELDS, createHardwareItem, createWishlistItem } from '../src/modules/profile-collections.js';
import { initAccountCreatorSubscriptions, initAccountDirectory } from '../src/modules/account-directory.js';
import { CREATOR_PROFILE_COLUMNS, myCreatorBlogSubscriptions, myDirectorySubscriptions, loadCreatorProfile, saveCreatorProfile, profileChanges, subscriptionLabel } from '../src/modules/creator-profile-api.js';
import { renderPage } from './render-templates.mjs';

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
  await assert.rejects(myCreatorBlogSubscriptions({ rpc: async () => ({ error: { message: 'private' } }) }), error => !error.message.includes('private'));
});

test('creator subscription account list shows status and links to the creator profile', async () => {
  const { document } = parseHTML('<section data-account-creator-subscriptions><p data-creator-subscription-status></p><div data-creator-subscription-list></div></section>');
  const expiredProfileId = '44444444-4444-4444-8444-444444444444';
  const previousDocument = globalThis.document;
  const previousLocation = globalThis.location;
  globalThis.document = document;
  globalThis.location = { origin: 'https://controlandchaos.example.test' };
  let notify;
  try {
    const refresh = initAccountCreatorSubscriptions({
      auth: { onAuthStateChange: callback => { notify = callback; } },
      rpc: async name => ({ data: name === 'my_creator_blog_subscriptions' ? [
        { creator_profile_id: profileId, creator_name: 'Alek Zane', creator_slug: 'alek-zane', expires_at: '2099-10-05T00:00:00Z', is_active: true },
        { creator_profile_id: expiredProfileId, creator_name: 'Past Creator', creator_slug: 'past-creator', expires_at: '2020-01-01T00:00:00Z', is_active: false }
      ] : null, error: null }),
      from: table => ({
        select: columns => ({
          in: async (column, ids) => ({ data: table === 'directory_profiles' && columns === 'id,avatar_image' && column === 'id'
            ? ids.map(id => ({ id, avatar_image: id === profileId ? 'https://images.example.test/alek.jpg' : '' })) : [], error: null })
        })
      })
    });
    await refresh({ id: 'test-user' });
    const rows = [...document.querySelectorAll('.account-creator-subscription-card')];
    assert.equal(rows.length, 2, document.querySelector('[data-creator-subscription-status]').textContent);
    assert.match(rows[0].textContent, /Alek Zane[\s\S]*Active[\s\S]*expires/);
    assert.match(rows[1].textContent, /Past Creator[\s\S]*Inactive[\s\S]*expires/);
    assert.equal(rows[0].querySelector('img').getAttribute('src'), 'https://images.example.test/alek.jpg');
    assert.equal(rows[0].querySelector('a').getAttribute('href'), '/directory-profile?slug=alek-zane');
    assert.equal(rows[0].querySelector('a').textContent, 'Open profile & blog');
    notify('SIGNED_OUT');
    assert.equal(document.querySelector('[data-creator-subscription-status]').textContent, '');
    assert.equal(document.querySelectorAll('.account-creator-subscription-card').length, 0);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
  }
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
    const otherCategory = { ...rates[0], id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', title: 'Other services', items: [] };
    editor.load([{ ...rates[0], items: [rates[0].items[0], second] }, otherCategory]);
    const rowFor = id => document.querySelector(`[data-rate-item="${id}"]`);
    const categoryFor = id => document.querySelector(`[data-rate-category="${id}"]`);
    assert.equal(categoryFor(rates[0].id).querySelector('[data-rate-category-toggle]').getAttribute('aria-expanded'), 'false');
    assert.equal(categoryFor(rates[0].id).querySelector('.rate-category-summary-title').textContent, rates[0].title);
    assert.equal(categoryFor(rates[0].id).querySelector('.rate-category-summary-meta').textContent, '2 services');
    assert.equal(categoryFor(rates[0].id).querySelector('.rate-category-details').hidden, true);
    categoryFor(rates[0].id).querySelector('[data-rate-category-toggle]').click();
    assert.equal(categoryFor(rates[0].id).querySelector('.rate-category-details').hidden, false);
    assert.equal(categoryFor(rates[0].id).querySelectorAll('[data-rich-text-source]').length, 1);
    categoryFor(otherCategory.id).querySelector('[data-rate-category-toggle]').click();
    assert.equal(document.querySelectorAll('[data-rate-category-toggle][aria-expanded="true"]').length, 1);
    categoryFor(rates[0].id).querySelector('[data-rate-category-toggle]').click();
    assert.equal(rowFor(rates[0].items[0].id).querySelector('[data-rate-service-toggle]').getAttribute('aria-expanded'), 'false');
    assert.equal(rowFor(rates[0].items[0].id).querySelector('.rate-service-summary-name').textContent, rates[0].items[0].name);
    assert.match(rowFor(rates[0].items[0].id).querySelector('.rate-service-summary-meta').textContent, /\|/);
    assert.equal(document.querySelectorAll('.rate-service-details [data-rich-text-source]').length, 0);
    rowFor(rates[0].items[0].id).querySelector('[data-rate-service-toggle]').click();
    assert.equal(rowFor(rates[0].items[0].id).querySelector('.rate-service-details').hidden, false);
    assert.equal(rowFor(rates[0].items[0].id).querySelectorAll('[data-rich-text-source]').length, 1);
    rowFor(second.id).querySelector('[data-rate-service-toggle]').click();
    assert.equal(document.querySelectorAll('[data-rate-service-toggle][aria-expanded="true"]').length, 1);
    assert.equal(document.querySelectorAll('.rate-service-details [data-rich-text-source]').length, 1);
    rowFor(rates[0].items[0].id).querySelector('[data-rate-service-toggle]').click();
    const name = document.getElementById(`rate-${rates[0].items[0].id}-name`);
    name.value = 'Updated appointment';
    name.dispatchEvent(new document.defaultView.Event('input'));
    document.querySelector('[aria-label="Move service down"]').click();
    assert.equal(editor.value()[0].items[1].name, 'Updated appointment');
    assert.equal(editor.value()[0].items[1].id, rates[0].items[0].id);
    document.querySelector('[aria-label="Remove service"]').click();
    assert.equal(editor.value()[0].items.length, 1);
    document.querySelector('[aria-label="Remove category"]').click();
    document.querySelector('[aria-label="Remove category"]').click();
    assert.deepEqual(editor.value(), []);
    document.getElementById('add').click();
    assert.equal(document.querySelectorAll('[data-rate-category-toggle][aria-expanded="true"]').length, 1);
    document.querySelector('[aria-label="Remove category"]').click();
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test('creator blog editor loads the creator price and saves one unified post list', async () => {
  const { document } = parseHTML('<fieldset><input id="price"><input id="benefits"><button id="add"></button><div id="posts"></div></fieldset>');
  const previous = globalThis.document;
  globalThis.document = document;
  const initialPost = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', legacy_id: 'blog-1', post_type: 'post', access_level: 'public', title: 'Public journal', tag: 'Update', teaser: '', body_markdown: 'An update.', media_type: 'text', media_path: '', media_url: '', is_published: true, sort_order: 0, created_at: '2026-10-01T00:00:00Z', published_at: '2026-10-01T00:00:00Z' };
  let saveRequest;
  const client = { rpc: async (name, args) => {
    if (name === 'creator_blog_editor_posts_v2') return { data: [initialPost], error: null };
    saveRequest = { name, args };
    return { data: null, error: null };
  } };
  try {
    for (const select of document.querySelectorAll('select')) {
      let value = select.querySelector('option')?.value || '';
      Object.defineProperty(select, 'value', { configurable: true, get: () => value, set: next => { value = String(next); } });
    }
    const editor = initCreatorBlogEditor(document.getElementById('posts'), document.getElementById('add'), document.getElementById('price'), document.getElementById('benefits'));
    await editor.load(client, { id: profileId, creator_blog_monthly_linden: 1500, creator_blog_benefits: 'Private lookbooks\nVoice notes' });
    assert.equal(document.getElementById('price').value, '1500');
    assert.equal(document.getElementById('benefits').value, 'Private lookbooks\nVoice notes');
    assert.equal(document.querySelector('[data-blog-editor-post]').querySelector('[aria-expanded]').getAttribute('aria-expanded'), 'false');
    document.getElementById('add').click();
    const newRow = [...document.querySelectorAll('[data-blog-editor-post]')].find(row => row.dataset.blogEditorPost !== initialPost.id);
    const newTitle = newRow.querySelector('input[id$="-title"]');
    newTitle.value = 'Subscriber lookbook';
    newTitle.dispatchEvent(new document.defaultView.Event('input'));
    newRow.querySelector('select[id$="-access_level"] option[value="subscribers"]').selected = true;
    newRow.querySelector('select[id$="-access_level"]').dispatchEvent(new document.defaultView.Event('change'));
    newRow.querySelector('textarea[id$="-teaser"]').value = 'A preview for fans.';
    newRow.querySelector('textarea[id$="-teaser"]').dispatchEvent(new document.defaultView.Event('input'));
    await editor.save();
    assert.equal(saveRequest.name, 'creator_blog_save_all_v2');
    assert.equal(saveRequest.args.target_profile, profileId);
    assert.equal(saveRequest.args.monthly_price, 1500);
    assert.equal(saveRequest.args.benefits, 'Private lookbooks\nVoice notes');
    assert.equal(saveRequest.args.posts.length, 2);
    const lockedPost = saveRequest.args.posts.find(post => post.title === 'Subscriber lookbook');
    assert.equal(lockedPost.access_level, 'subscribers');
    assert.equal(lockedPost.teaser, 'A preview for fans.');
    assert.equal(Object.hasOwn(saveRequest.args.posts[0], 'created_at'), false);
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});

test('creator pass dialog copies the creator UUID, uses the terminal SLURL, and never renders locked media', async () => {
  const { document } = parseHTML(await renderPage('directory-profile.html'));
  const passStyles = await fs.readFile(new URL('../src/templates.css', import.meta.url), 'utf8');
  assert.match(passStyles, /\.creator-pass-dialog \{ position: fixed; inset: 0;[^}]*height: fit-content;[^}]*margin: auto;/);
  const previousDocument = globalThis.document;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let copiedValue = '';
  const feed = document.querySelector('[data-public-blog-feed]');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async value => { copiedValue = value; } } } });
  const dialog = document.querySelector('[data-creator-pass-dialog]');
  dialog.showModal = () => dialog.setAttribute('open', '');
  dialog.close = () => dialog.removeAttribute('open');
  const privateBody = 'PRIVATE_SUBSCRIBER_BODY_NOT_FOR_PUBLIC';
  const privatePath = 'profile/private-subscriber-image.webp';
  try {
    assert.deepEqual(creatorPassBenefits('  Private lookbooks  \n\n Voice notes\r\n '), ['Private lookbooks', 'Voice notes']);
    await renderCreatorBlogFeed(
      document.querySelector('[data-public-blog-feed]'),
      document.querySelector('[data-public-blog-status]'),
      {},
      { display_name: 'Alek Zane' },
      { creator_avatar_uuid: '11111111-2222-4333-8444-555555555555', monthly_price_linden: 1500, benefits: 'Private lookbooks\nVoice notes', terminal_slurl: 'secondlife://LosPengos/97/181/3000', viewer_is_subscribed: false },
      [{ post_type: 'post', access_level: 'subscribers', is_locked: true, title: 'Private post', teaser: 'Public teaser', body_markdown: privateBody, media_path: privatePath, published_at: '2026-10-07T00:00:00Z' }]
    );
    assert.deepEqual([...dialog.querySelectorAll('[data-creator-pass-benefits] li')].map(item => item.textContent), ['Private lookbooks', 'Voice notes']);
    assert.equal(dialog.querySelector('[data-creator-pass-price]').textContent, 'L$1,500 / 30 days');
    assert.equal(dialog.querySelector('[data-creator-pass-uuid]').textContent, '11111111-2222-4333-8444-555555555555');
    assert.equal(dialog.querySelector('[data-creator-pass-teleport]').getAttribute('href'), 'secondlife://LosPengos/97/181/3000');
    assert.equal(dialog.querySelector('[data-creator-pass-teleport]').hidden, false);
    assert.equal(dialog.textContent.includes('Direct Enquiry'), false);
    assert.equal(dialog.textContent.includes('Already subscribed'), false);
    assert.equal(feed.textContent.includes(privateBody), false);
    assert.equal(feed.textContent.includes(privatePath), false);
    assert.equal(feed.querySelector('img,video,audio'), null);
    document.querySelector('[data-creator-pass-copy]').click();
    await Promise.resolve();
    assert.equal(copiedValue, '11111111-2222-4333-8444-555555555555');
    document.querySelector('.creator-blog-gate button').click();
    assert.equal(dialog.hasAttribute('open'), true);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else Object.defineProperty(globalThis, 'document', { configurable: true, value: previousDocument });
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else delete globalThis.navigator;
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

test('blog editor gates multi-attachment saves when only migration 14 is installed', async () => {
  const { document } = parseHTML('<fieldset><input id="price"><input id="benefits"><button id="add"></button><div id="posts"></div></fieldset>');
  const previous = globalThis.document;
  globalThis.document = document;
  const calls = [];
  const post = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Existing post', post_type: 'post', access_level: 'public', body_markdown: '', media_type: 'image', media_url: 'https://example.test/photo.webp', media_path: '', is_published: false };
  const client = { rpc: async (name, args) => {
    calls.push({ name, args });
    if (name === 'creator_blog_editor_posts_v2') return { error: { code: 'PGRST202' } };
    if (name === 'creator_blog_editor_posts') return { data: [post], error: null };
    return { error: null };
  } };
  try {
    const editor = initCreatorBlogEditor(document.getElementById('posts'), document.getElementById('add'), document.getElementById('price'), document.getElementById('benefits'));
    await editor.load(client, { id: profileId, creator_blog_monthly_linden: 1500 });
    assert.match(document.querySelector('.creator-blog-attachments').textContent, /Apply migration 15/);
    await editor.save();
    assert.equal(calls.at(-1).name, 'creator_blog_save_all');
    assert.equal(calls.at(-1).args.posts[0].media_url, post.media_url);
    assert.equal(Object.hasOwn(calls.at(-1).args.posts[0], 'attachments'), false);
    await assert.rejects(editor.load({ rpc: async () => ({ error: { code: '42501' } }) }, { id: profileId }), /could not be loaded/);
  } finally {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
  }
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
  const { document } = parseHTML('<button id="add"></button><fieldset disabled><div id="editor"></div></fieldset>');
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
    editor.load([original, photos[1]]);
    const rows = document.querySelectorAll('[data-gallery-editor-photo]');
    const rowFor = id => document.querySelector(`[data-gallery-editor-photo="${id}"]`);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].querySelector('[data-gallery-photo-toggle]').getAttribute('aria-expanded'), 'false');
    assert.equal(rows[0].querySelector('.gallery-photo-summary-title').textContent, 'Portrait');
    assert.match(rows[0].querySelector('.gallery-photo-summary-meta').textContent, /Published/);
    assert.equal(rows[0].querySelector('.gallery-photo-thumbnail-placeholder').hidden, false);
    assert.equal(rows[1].querySelector('[data-gallery-photo-toggle]').getAttribute('aria-expanded'), 'false');
    assert.match(rows[1].querySelector('.gallery-photo-summary-meta').textContent, /Draft/);
    assert.equal(rows[1].querySelector('.gallery-photo-thumbnail').hidden, false);
    assert.equal(rows[1].querySelector('.gallery-photo-thumbnail-placeholder').hidden, true);
    assert.equal(rows[1].querySelector('.gallery-photo-preview-button').hidden, false);
    assert.equal(document.querySelectorAll('[data-rich-text-source]').length, 0);
    rowFor(photos[0].id).querySelector('[data-gallery-photo-toggle]').click();
    assert.equal(rowFor(photos[0].id).querySelector('[data-gallery-photo-toggle]').getAttribute('aria-expanded'), 'true');
    assert.equal(rowFor(photos[0].id).querySelector('.gallery-photo-details').hidden, false);
    assert.equal(document.querySelectorAll('[data-rich-text-source]').length, 1);
    rowFor(photos[1].id).querySelector('[data-gallery-photo-toggle]').click();
    assert.equal(document.querySelectorAll('[data-gallery-photo-toggle][aria-expanded="true"]').length, 1);
    assert.equal(document.querySelectorAll('[data-rich-text-source]').length, 1);
    rowFor(photos[0].id).querySelector('[data-gallery-photo-toggle]').click();
    const input = document.querySelector('input[type="file"]');
    assert.equal(document.querySelector('[data-gallery-editor-photo]').children[1].querySelector('input[type="file"]'), input);
    const mediaRow = rowFor(photos[0].id).querySelector('.gallery-photo-media-row');
    assert.equal(mediaRow.children[0].classList.contains('gallery-photo-preview-button'), true);
    assert.equal(mediaRow.children[1].querySelector('input[type="file"]'), input);
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
    for (const file of ['202610040001_directory_foundation.sql', '202610040002_avatar_verification.sql', '202610050003_directory_subscriptions.sql', '202610050007_directory_rate_cards.sql', '202610050008_directory_booking_hours.sql', '202610050009_directory_gallery.sql', '202610050010_directory_profile_protocol.sql', '202610060011_directory_booking_recipient.sql', '202610060012_directory_gallery_storage.sql', '202610060013_directory_profile_booking_fields.sql', '202610060014_creator_blog_subscriptions.sql', '202610070016_creator_blog_subscription_list.sql']) {
      await database.exec(await fs.readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    }
    assert.deepEqual((await database.query('select public,file_size_limit,allowed_mime_types from storage.buckets where id=$1', ['directory-gallery'])).rows[0], { public: false, file_size_limit: 2097152, allowed_mime_types: ['image/webp'] });
    await database.query('insert into auth.users(id,email,email_confirmed_at) values ($1,$2,now()),($3,$4,now())', [owner, 'creator@example.test', stranger, 'stranger@example.test']);
    await database.query('insert into cc_private.verified_avatar_links(avatar_uuid,user_id,sl_username) values ($1,$2,$3)', [rates[0].id, owner, 'test.resident']);
    const adminAvatar = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    await database.query('insert into cc_private.verified_avatar_links(avatar_uuid,user_id,sl_username) values ($1,$2,$3)', [adminAvatar, owner, 'controlandchaos']);
    const fanAvatar = '33333333-3333-4333-8333-333333333333';
    await database.query('insert into cc_private.verified_avatar_links(avatar_uuid,user_id,sl_username) values ($1,$2,$3)', [fanAvatar, stranger, 'fan.resident']);
    await database.exec(await fs.readFile(new URL('../supabase/migrations/202610070017_directory_superadmin.sql', import.meta.url), 'utf8'));
    await database.query("select set_config('request.jwt.claim.sub',$1,false)", [stranger]);
    await database.exec('set role authenticated');
    assert.equal((await database.query('select public.my_directory_admin_access() as allowed')).rows[0].allowed, false);
    await assert.rejects(database.query('select * from public.admin_directory_listings()'), error => error.code === '42501');
    await database.exec('reset role; set role anon');
    await assert.rejects(database.query('select public.my_directory_admin_access()'), error => error.code === '42501');
    await database.exec('reset role');
    await database.exec("update cc_private.directory_plans set amount_linden=100,enabled=true where code='basic_monthly'");
    const profile = (await database.query('select public.register_directory_payment($1,$2,$3,$4) as id', [profileId, rates[0].id, 'basic_monthly', 100])).rows[0].id;
    await database.query('select set_config(\'request.jwt.claim.sub\',$1,false)', [owner]);
    await database.exec('set role authenticated');
    await database.query('update public.directory_profiles set is_published=true,rate_categories=$1::jsonb,booking_hours=$2::jsonb where id=$3', [JSON.stringify(rates), JSON.stringify(hours), profile]);
    assert.equal((await database.query('select public.my_directory_admin_access() as allowed')).rows[0].allowed, true);
    const listings = (await database.query('select * from public.admin_directory_listings()')).rows;
    const listing = listings.find(row => row.profile_data.id === profile);
    assert.equal(listing.profile_data.id, profile);
    assert.equal(listing.moderation_state, 'published');
    const edited = (await database.query('select public.admin_update_directory_profile($1,$2::jsonb) as profile', [profile, JSON.stringify({ headline: 'Admin reviewed headline' })])).rows[0].profile;
    assert.equal(edited.headline, 'Admin reviewed headline');
    await database.query('select public.admin_set_listing_state($1,$2,$3)', [profile, 'suspend', 'Review requested']);
    assert.deepEqual((await database.query('select is_approved,is_published from public.directory_profiles where id=$1', [profile])).rows[0], { is_approved: true, is_published: false });
    assert.equal((await database.query('select moderation_state from public.admin_directory_listings() where profile_data->>\'id\'=$1', [profile])).rows[0].moderation_state, 'suspended');
    await database.query('select public.admin_set_listing_state($1,$2,$3)', [profile, 'restore', '']);
    await database.query('select public.admin_set_listing_state($1,$2,$3)', [profile, 'archive', 'Archive test']);
    assert.deepEqual((await database.query('select is_approved,is_published from public.directory_profiles where id=$1', [profile])).rows[0], { is_approved: false, is_published: false });
    await database.query('select public.admin_set_listing_state($1,$2,$3)', [profile, 'restore', '']);
    assert.deepEqual((await database.query('select is_approved,is_published from public.directory_profiles where id=$1', [profile])).rows[0], { is_approved: true, is_published: true });
    const directorySubscriber = (await database.query('select * from public.admin_directory_subscribers($1,$2)', ['test.resident', 'directory'])).rows[0];
    assert.equal(directorySubscriber.subscriber_avatar_uuid, rates[0].id);
    assert.equal(directorySubscriber.is_active, true);
    await database.query('select public.admin_set_subscription_state($1,$2,$3,$4,$5)', ['directory', rates[0].id, profile, 'suspend', null]);
    assert.equal((await database.query('select is_active from public.admin_directory_subscribers($1,$2)', ['test.resident', 'directory'])).rows[0].is_active, false);
    await database.query('select public.admin_set_subscription_state($1,$2,$3,$4,$5)', ['directory', rates[0].id, profile, 'restore', null]);
    const oldDirectoryExpiry = directorySubscriber.expires_at;
    const extendedDirectoryExpiry = (await database.query('select public.admin_set_subscription_state($1,$2,$3,$4,$5) as expires', ['directory', rates[0].id, profile, 'extend', 10])).rows[0].expires;
    assert.equal(extendedDirectoryExpiry.getTime() - oldDirectoryExpiry.getTime(), 10 * 86400000);
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
    const publicPost = { post_type: 'live_update', access_level: 'public', title: 'Public update', tag: 'Live', teaser: 'A public update', body_markdown: 'Visible to everyone.', media_type: 'text', is_published: true };
    const privatePostId = '55555555-5555-4555-8555-555555555555';
    const privateMediaPath = `${profile}/${privatePostId}/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.webp`;
    const privatePost = { id: privatePostId, post_type: 'post', access_level: 'subscribers', title: 'Private lookbook', tag: 'Lookbook', teaser: 'A preview only.', body_markdown: 'Full subscribers-only details.', media_type: 'image', media_path: privateMediaPath, is_published: true };
    await database.query('insert into storage.objects(bucket_id,name) values ($1,$2)', ['creator-blog-media', privateMediaPath]);
    await database.exec('reset role; set role service_role');
    const legacyProfile = {
      avatar_uuid: rates[0].id,
      published: true,
      fan_tier_price: 'L$1,500 / month',
      fan_tier_desc: 'Legacy subscriber benefits.',
      posts: [{ id: 'post-1', title: 'Private legacy post', content: 'Preserve subscriber text.', media_url: 'https://legacy.example.test/private.jpg', is_locked: true, type: 'image' }],
      blog_posts: [{ id: 'blog-1', title: 'Public legacy article', content: 'Preserve public text.', media_url: 'https://legacy.example.test/public.jpg' }]
    };
    const importLegacy = () => database.query('select * from public.creator_blog_import_legacy($1,$2::jsonb)', [rates[0].id, JSON.stringify(legacyProfile)]);
    const imported = (await importLegacy()).rows[0];
    assert.deepEqual(imported, { creator_profile_id: profile, imported_posts: 2, locked_media_reupload: 1, monthly_price_linden: 1500 });
    assert.equal((await importLegacy()).rows[0].imported_posts, 2);
    assert.equal((await database.query('select count(*)::integer as count from public.creator_blog_posts where profile_id=$1 and legacy_id<>\'\'', [profile])).rows[0].count, 2);
    const importedLocked = (await database.query(`select post.access_level,content.body_markdown,content.media_url
      from public.creator_blog_posts as post join cc_private.creator_blog_post_content as content on content.post_id=post.id
      where post.profile_id=$1 and post.legacy_id='feed:post-1'`, [profile])).rows[0];
    assert.deepEqual(importedLocked, { access_level: 'subscribers', body_markdown: 'Preserve subscriber text.', media_url: '' });
    const importedPublic = (await database.query(`select post.access_level,content.body_markdown,content.media_url
      from public.creator_blog_posts as post join cc_private.creator_blog_post_content as content on content.post_id=post.id
      where post.profile_id=$1 and post.legacy_id='blog:blog-1'`, [profile])).rows[0];
    assert.deepEqual(importedPublic, { access_level: 'public', body_markdown: 'Preserve public text.', media_url: 'https://legacy.example.test/public.jpg' });
    await database.query('select public.creator_blog_set_terminal($1)', ['secondlife://finance-land/128/128/20']);
    await database.exec('reset role');
    await database.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await database.exec('set role authenticated');
    await database.query('select public.creator_blog_save_all($1,$2,$3,$4::jsonb)', [profile, 1500, 'All subscriber posts and monthly updates.', JSON.stringify([publicPost, privatePost])]);
    const [ownerOffer] = (await database.query('select * from public.creator_blog_public_offer($1)', [profile])).rows;
    assert.equal(ownerOffer.monthly_price_linden, 1500);
    assert.equal(ownerOffer.benefits, 'All subscriber posts and monthly updates.');
    assert.equal(ownerOffer.terminal_slurl, 'secondlife://finance-land/128/128/20');
    assert.deepEqual((await database.query('select title,body_markdown from public.creator_blog_editor_posts($1) order by title', [profile])).rows, [
      { title: 'Private lookbook', body_markdown: 'Full subscribers-only details.' },
      { title: 'Public update', body_markdown: 'Visible to everyone.' }
    ]);
    await database.exec("reset role; select set_config('request.jwt.claim.sub','',false); set role anon");
    const anonymousFeed = (await database.query('select * from public.creator_blog_feed($1)', [profile])).rows;
    assert.equal(anonymousFeed.length, 2);
    assert.equal(anonymousFeed.find(post => post.title === 'Private lookbook').is_locked, true);
    assert.equal(anonymousFeed.find(post => post.title === 'Private lookbook').body_markdown, null);
    assert.equal(anonymousFeed.find(post => post.title === 'Private lookbook').media_path, null);
    assert.equal(anonymousFeed.find(post => post.title === 'Private lookbook').teaser, 'A preview only.');
    assert.equal(anonymousFeed.find(post => post.title === 'Public update').body_markdown, 'Visible to everyone.');
    assert.equal((await database.query('select name from storage.objects where bucket_id=$1', ['creator-blog-media'])).rows.length, 0);
    await database.exec('reset role; set role service_role');
    const terminalOffer = (await database.query('select * from public.creator_blog_offer_for_terminal($1)', [rates[0].id])).rows[0];
    assert.equal(terminalOffer.profile_id, profile);
    assert.equal(terminalOffer.monthly_price_linden, 1500);
    const publicOffer = (await database.query('select * from public.creator_blog_public_offer($1)', [profile])).rows[0];
    assert.equal(publicOffer.terminal_slurl, 'secondlife://finance-land/128/128/20');
    await assert.rejects(database.query('select * from public.creator_blog_prepare_payment($1,$2,$3,$4)', ['66666666-6666-4666-8666-666666666666', '44444444-4444-4444-8444-444444444444', rates[0].id, 1500]), /fan_avatar_not_verified/);
    await assert.rejects(database.query('select * from public.creator_blog_prepare_payment($1,$2,$3,$4)', ['66666666-6666-4666-8666-666666666666', fanAvatar, rates[0].id, 1499]), /invalid_creator_payment_amount/);
    await database.query('select * from public.creator_blog_prepare_payment($1,$2,$3,$4)', ['66666666-6666-4666-8666-666666666666', fanAvatar, rates[0].id, 1500]);
    assert.equal((await database.query('select public.creator_blog_start_payout($1,$2,$3,$4) as started', ['66666666-6666-4666-8666-666666666666', fanAvatar, rates[0].id, 1500])).rows[0].started, true);
    assert.equal((await database.query('select public.creator_blog_start_payout($1,$2,$3,$4) as started', ['66666666-6666-4666-8666-666666666666', fanAvatar, rates[0].id, 1500])).rows[0].started, false);
    const firstExpiry = (await database.query('select public.creator_blog_confirm_payment($1,$2,$3,$4) as expires', ['66666666-6666-4666-8666-666666666666', fanAvatar, rates[0].id, 1500])).rows[0].expires;
    assert.equal((await database.query('select public.creator_blog_confirm_payment($1,$2,$3,$4) as expires', ['66666666-6666-4666-8666-666666666666', fanAvatar, rates[0].id, 1500])).rows[0].expires.getTime(), firstExpiry.getTime());
    await database.exec('reset role');
    await database.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await database.exec('set role authenticated');
    const creatorSubscriber = (await database.query('select * from public.admin_directory_subscribers($1,$2)', ['fan.resident', 'creator'])).rows[0];
    assert.equal(creatorSubscriber.subscriber_avatar_uuid, fanAvatar);
    assert.equal(creatorSubscriber.profile_id, profile);
    assert.equal(creatorSubscriber.is_active, true);
    await database.exec('reset role');
    await database.query("select set_config('request.jwt.claim.sub',$1,false)", [stranger]);
    await database.exec('set role authenticated');
    const creatorSubscriptions = (await database.query('select * from public.my_creator_blog_subscriptions()')).rows;
    assert.equal(creatorSubscriptions.length, 1);
    assert.deepEqual(creatorSubscriptions[0], {
      creator_profile_id: profile,
      creator_avatar_uuid: rates[0].id,
      creator_slug: (await database.query('select slug from public.directory_profiles where id=$1', [profile])).rows[0].slug,
      creator_name: (await database.query('select display_name from public.directory_profiles where id=$1', [profile])).rows[0].display_name,
      expires_at: firstExpiry,
      is_active: true
    });
    await database.exec('reset role');
    await database.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await database.exec('set role authenticated');
    assert.equal((await database.query('select * from public.my_creator_blog_subscriptions()')).rows.length, 0);
    await database.exec('reset role; set role anon');
    await assert.rejects(database.query('select * from public.my_creator_blog_subscriptions()'), error => error.code === '42501');
    await database.exec('reset role; set role service_role');
    await database.query("update cc_private.creator_content_subscriptions set expires_at=now()-interval '1 second' where fan_avatar_uuid=$1 and creator_profile_id=$2", [fanAvatar, profile]);
    await database.exec('reset role');
    await database.query("select set_config('request.jwt.claim.sub',$1,false)", [stranger]);
    await database.exec('set role authenticated');
    assert.equal((await database.query('select is_active from public.my_creator_blog_subscriptions()')).rows[0].is_active, false);
    await database.exec('reset role; set role service_role');
    await database.query('update cc_private.creator_content_subscriptions set expires_at=$1 where fan_avatar_uuid=$2 and creator_profile_id=$3', [firstExpiry, fanAvatar, profile]);
    await database.query('select * from public.creator_blog_prepare_payment($1,$2,$3,$4)', ['77777777-7777-4777-8777-777777777777', fanAvatar, rates[0].id, 1500]);
    await database.query('select public.creator_blog_start_payout($1,$2,$3,$4)', ['77777777-7777-4777-8777-777777777777', fanAvatar, rates[0].id, 1500]);
    assert.equal((await database.query('select public.creator_blog_cancel_payment($1,$2,$3,$4) as cancelled', ['77777777-7777-4777-8777-777777777777', fanAvatar, rates[0].id, 1500])).rows[0].cancelled, true);
    assert.equal((await database.query('select public.creator_blog_confirm_refund($1,$2,$3,$4) as refunded', ['77777777-7777-4777-8777-777777777777', fanAvatar, rates[0].id, 1500])).rows[0].refunded, true);
    await database.exec('reset role');
    await database.query("select set_config('request.jwt.claim.sub',$1,false)", [stranger]);
    await database.exec('set role authenticated');
    const subscribedFeed = (await database.query('select * from public.creator_blog_feed($1)', [profile])).rows;
    assert.equal(subscribedFeed.find(post => post.title === 'Private lookbook').is_locked, false);
    assert.equal(subscribedFeed.find(post => post.title === 'Private lookbook').body_markdown, 'Full subscribers-only details.');
    assert.equal((await database.query('select name from storage.objects where bucket_id=$1', ['creator-blog-media'])).rows.length, 1);
    await database.exec('reset role');
    await database.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await database.exec('set role authenticated');
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

  const { document } = parseHTML('<fieldset><section data-collection-section="toys"><div><button id="add-toy"></button><button data-collection-section-toggle aria-expanded="false"><span>My Toys</span><span data-collection-section-count></span><span data-collection-section-action>Show</span></button></div><div data-collection-section-details><div id="toys"></div></div></section><section data-collection-section="wishlist"><div><button id="add-wishlist"></button><button data-collection-section-toggle aria-expanded="false"><span>Wishlist &amp; Tributes</span><span data-collection-section-count></span><span data-collection-section-action>Show</span></button></div><div data-collection-section-details><div id="wishlist"></div></div></section></fieldset><div id="public-toys"></div><div id="public-wishlist"></div>');
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    const toys = initProfileCollectionEditor(document.getElementById('toys'), document.getElementById('add-toy'), { kind: 'toys', fields: HARDWARE_FIELDS, validate: validateHardwareItems, createItem: createHardwareItem, limit: 30 });
    const gifts = initProfileCollectionEditor(document.getElementById('wishlist'), document.getElementById('add-wishlist'), { kind: 'wishlist', fields: WISHLIST_FIELDS, validate: validateWishlistItems, createItem: createWishlistItem, limit: 20 });
    toys.load([{ ...hardware[0] }, { name: 'RLV', desc: '', icon: '\u{1F512}', badge_text: 'Ready' }]);
    assert.equal(document.querySelector('[data-collection-section="toys"] [data-collection-section-details]').hidden, true);
    assert.equal(document.querySelector('[data-collection-section="toys"] [data-collection-section-count]').textContent, '2 items');
    document.querySelector('[data-collection-section="toys"] [data-collection-section-toggle]').click();
    assert.equal(document.querySelector('[data-collection-section="toys"] [data-collection-section-details]').hidden, false);
    const toyRow = index => document.querySelector(`[data-collection-item="toys-${index}"]`);
    assert.equal(toyRow(0).querySelector('[data-collection-toggle]').getAttribute('aria-expanded'), 'false');
    assert.equal(toyRow(0).querySelector('.profile-collection-summary-title').textContent, 'Lovense Gush');
    assert.equal(toyRow(0).querySelector('.profile-collection-details').hidden, true);
    toyRow(0).querySelector('[data-collection-toggle]').click();
    assert.equal(toyRow(0).querySelector('.profile-collection-details').hidden, false);
    toyRow(1).querySelector('[data-collection-toggle]').click();
    assert.equal(document.querySelectorAll('#toys [data-collection-toggle][aria-expanded="true"]').length, 1);
    document.querySelector('[aria-label="Move item down"]').click();
    assert.deepEqual(toys.value().map(item => item.name), ['RLV', 'Lovense Gush']);
    document.querySelector('[aria-label="Remove item"]').click();
    assert.deepEqual(toys.value().map(item => item.name), ['Lovense Gush']);
    gifts.load(wishlist);
    assert.equal(document.querySelector('[data-collection-section="wishlist"] [data-collection-section-details]').hidden, true);
    assert.equal(document.querySelector('[data-collection-section="wishlist"] [data-collection-section-count]').textContent, '1 link');
    assert.equal(document.querySelector('#wishlist [data-collection-toggle]').getAttribute('aria-expanded'), 'false');
    assert.equal(document.querySelector('#wishlist .profile-collection-summary-title').textContent, wishlist[0].title);
    document.getElementById('add-wishlist').click();
    assert.equal(document.querySelector('[data-collection-section="wishlist"] [data-collection-section-details]').hidden, false);
    assert.equal(document.querySelectorAll('#wishlist [data-collection-toggle][aria-expanded="true"]').length, 1);
    assert.equal(document.querySelector('#wishlist [aria-expanded="true"]').id, `wishlist-1-toggle`);
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
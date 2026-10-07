import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { createPublicDirectoryClient, directoryConfig, fetchDirectory, fetchPublicProfile, publicImageUrl, PUBLIC_PROFILE_COLUMNS } from '../src/modules/directory-api.js';
import { directoryCard } from '../src/modules/directory.js';
import { initDirectoryProfile } from '../src/modules/directory-profile.js';
import { renderCreatorBlogFeed } from '../src/modules/creator-blog-feed.js';

const config = directoryConfig({ VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_only' });

test('public directory configuration rejects missing values, insecure URLs and privileged keys', () => {
  assert.throws(() => directoryConfig({}), /not configured/);
  assert.throws(() => directoryConfig({ VITE_SUPABASE_URL: 'http://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: config.publishableKey }));
  assert.throws(() => directoryConfig({ VITE_SUPABASE_URL: config.url, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_test_only' }));
});

test('directory query selects only public fields and combines filters with bounded pagination', async () => {
  let request;
  const client = createPublicDirectoryClient(config, async url => {
    request = new URL(url);
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json', 'content-range': '*/0' } });
  });
  assert.deepEqual(await fetchDirectory(client, { page: 1, role: 'sub', tag: 'RLV', search: 'name,with"quote' }), { profiles: [], total: 0 });
  assert.equal(request.searchParams.get('select'), PUBLIC_PROFILE_COLUMNS);
  assert.equal(request.searchParams.get('is_approved'), 'eq.true');
  assert.equal(request.searchParams.get('is_published'), 'eq.true');
  assert.equal(request.searchParams.get('role_type'), 'eq.sub');
  assert.equal(request.searchParams.get('tags'), 'cs.{RLV}');
  assert.equal(request.searchParams.get('offset'), '12');
  assert.equal(request.searchParams.get('limit'), '12');
  assert.match(request.searchParams.get('or'), /name,with\\"quote/);
  await assert.rejects(fetchDirectory(client, { page: -1 }), /Invalid directory filters/);
  await assert.rejects(fetchDirectory(client, { role: 'admin' }), /Invalid directory filters/);
  await assert.rejects(fetchDirectory(client, { tag: 'injected' }), /Invalid directory filters/);
});

test('failed directory requests do not return fixture data or expose backend details', async () => {
  const client = createPublicDirectoryClient(config, async () => new Response(JSON.stringify({ message: 'internal backend details', code: '42501' }), { status: 403, headers: { 'content-type': 'application/json' } }));
  await assert.rejects(fetchDirectory(client), error => error.message === 'Directory request failed.');
});

test('public profile lookup rejects invalid slugs and cannot read unapproved records', async () => {
  let calls = 0;
  let request;
  const client = createPublicDirectoryClient(config, async url => {
    calls++;
    request = new URL(url);
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  });
  assert.equal(await fetchPublicProfile(client, '../private'), null);
  assert.equal(calls, 0);
  assert.equal(await fetchPublicProfile(client, 'sample-profile'), null);
  assert.equal(request.searchParams.get('is_approved'), 'eq.true');
  assert.equal(request.searchParams.get('is_published'), 'eq.true');
  assert.equal(request.searchParams.get('slug'), 'eq.sample-profile');
  assert.match(request.searchParams.get('select'), /boundaries,booking_instructions,hardware_title,hardware_compat,wishlist_title,wishlist/);
});

test('public profile falls back to legacy columns until migration 11 is applied', async () => {
  const requests = [];
  const row = { id: '33333333-3333-4333-8333-333333333333', slug: 'sample-profile', display_name: 'Existing Creator', is_approved: true, is_published: true };
  const client = createPublicDirectoryClient(config, async url => {
    const request = new URL(url);
    requests.push(request);
    if (request.searchParams.get('select').includes('hardware_title')) {
      return new Response(JSON.stringify({ message: "Could not find the 'hardware_title' column in the schema cache" }), { status: 400, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify([row]), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const result = await fetchPublicProfile(client, 'sample-profile');
  assert.equal(requests.length, 2);
  assert.doesNotMatch(requests[1].searchParams.get('select'), /hardware_title|wishlist_title/);
  assert.equal(result.display_name, 'Existing Creator');
  assert.deepEqual(result.hardware_compat, []);
  assert.deepEqual(result.wishlist, []);
});

test('directory cards render untrusted text safely and link only to the public reader', async () => {
  const source = await fs.readFile(new URL('../templates/partials/directory-card.njk', import.meta.url), 'utf8');
  const { document } = parseHTML(source);
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    const profile = { slug: 'sample-profile', display_name: '<img src=x onerror=alert(1)>', sl_username: 'sample.resident', role_type: 'sub', tags: ['<script>alert(1)</script>'], avatar_image: 'javascript:alert(1)', availability: 'available' };
    const card = directoryCard(document.querySelector('template'), profile);
    assert.equal(card.querySelector('[data-directory-name]').textContent, profile.display_name);
    assert.equal(card.querySelector('script,[onerror],img'), null);
    assert.equal(card.querySelector('[data-directory-link]').getAttribute('href'), '/directory-profile?slug=sample-profile');
    assert.equal(publicImageUrl('data:text/html,test'), '');
    assert.equal(publicImageUrl('//unsafe.example/image'), '');
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test('creator blog renders locked teasers publicly and full posts only when the server unlocks them', async () => {
  const { document } = parseHTML('<p id="status"></p><div id="feed"></div>');
  const previous = globalThis.document;
  globalThis.document = document;
  const signedCalls = [];
  const client = { storage: { from: bucket => ({ createSignedUrl: async (path, lifetime) => {
    signedCalls.push({ bucket, path, lifetime });
    return { data: { signedUrl: 'https://signed.example/private.webp' }, error: null };
  } }) } };
  const profile = { id: '33333333-3333-4333-8333-333333333333', display_name: 'Sample Creator' };
  const offer = { creator_avatar_uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', monthly_price_linden: 1500, benefits: 'Exclusive posts', terminal_slurl: 'secondlife://finance/128/128/20', viewer_is_subscribed: false };
  const locked = { id: '11111111-1111-4111-8111-111111111111', post_type: 'post', access_level: 'subscribers', title: 'Private set', tag: 'Lookbook', teaser: 'A public preview.', body_markdown: null, media_type: null, media_path: null, media_url: null, is_locked: true };
  const publicPost = { id: '22222222-2222-4222-8222-222222222222', post_type: 'live_update', access_level: 'public', title: 'Public update', tag: 'Live', teaser: '', body_markdown: 'Visible update.', media_type: 'text', media_path: '', media_url: '', is_locked: false };
  try {
    await renderCreatorBlogFeed(document.getElementById('feed'), document.getElementById('status'), client, profile, offer, [locked, publicPost]);
    const lockedCard = document.querySelector('.creator-blog-card.is-locked');
    assert.equal(lockedCard.querySelector('.creator-blog-post-teaser').textContent, 'A public preview.');
    assert.equal(lockedCard.querySelector('.creator-blog-post-body'), null);
    assert.equal(lockedCard.textContent.includes('Full subscribers-only details.'), false);
    assert.equal(lockedCard.querySelector('a'), null);
    assert.match(lockedCard.querySelector('button').textContent, /Unlock for L\$1,500/);
    assert.equal(document.querySelector('.creator-blog-membership-action strong').textContent, 'L$1,500 / month');
    await renderCreatorBlogFeed(document.getElementById('feed'), document.getElementById('status'), client, profile, { ...offer, viewer_is_subscribed: true }, [
      { ...locked, is_locked: false, body_markdown: 'Full subscribers-only details.', media_type: 'image', media_path: `${profile.id}/${locked.id}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp` }
    ]);
    assert.match(document.querySelector('.creator-blog-post-body').textContent, /Full subscribers-only details/);
    assert.equal(document.querySelector('.creator-blog-media-image').src, 'https://signed.example/private.webp');
    assert.deepEqual(signedCalls, [{ bucket: 'creator-blog-media', path: `${profile.id}/${locked.id}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp`, lifetime: 300 }]);
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});

for (const mode of ['published', 'single', 'empty', 'failed']) test(`public profile gallery preview and tabs handle ${mode} data`, async () => {
  const { document, window } = parseHTML(await fs.readFile(new URL('../directory-profile.html', import.meta.url), 'utf8'));
  const previousDocument = globalThis.document;
  const previousLocation = globalThis.location;
  globalThis.document = document;
  globalThis.location = { href: 'https://example.test/directory-profile.html?slug=sample-profile' };
  const photos = Array.from({ length: 6 }, (_, index) => ({
    id: `dddddddd-dddd-4ddd-8ddd-${String(index).padStart(12, '0')}`,
    title: `Photo ${index}`, category: index % 2 ? 'Portraits' : 'Studio', description: '<script>not markup</script>',
    image_url: `/images/photo-${index}.jpg`, is_published: index !== 0, sort_order: index
  }));
  const requests = [];
  const client = createPublicDirectoryClient(config, async url => {
    const request = new URL(url);
    requests.push(request);
    if (request.pathname.endsWith('/directory_profiles')) return new Response(JSON.stringify([{
      id: '33333333-3333-4333-8333-333333333333', slug: 'sample-profile',
      display_name: 'Sample Creator', sl_username: 'sample.resident', role_type: 'switch',
      about: 'About this creator', availability: 'away', tags: [], rate_categories: [], booking_hours: null,
      hardware_title: 'My Toys',
      hardware_compat: mode === 'published' ? [{ name: '<script>Gush</script>', desc: 'Remote control', icon: '💎', badge_text: 'Ready' }] : [],
      wishlist_title: 'Wishlist & Tributes',
      wishlist: mode === 'published' ? [{ title: 'Throne Wishlist', url: 'https://throne.com/example', note: 'Gifts' }] : [],
      boundaries: mode === 'empty' ? '  ' : '<script>Respect limits</script>\nSecond line',
      booking_instructions: mode === 'empty' ? '' : 'Contact me in-world.\nConfirm a time.'
    }]), { headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify(mode === 'failed' ? { message: 'Internal error' } : mode === 'empty' ? [] : mode === 'single' ? [photos[1]] : photos), {
      status: mode === 'failed' ? 403 : 200, headers: { 'content-type': 'application/json' }
    });
  });
  try {
    await initDirectoryProfile(client);
    assert.equal(document.querySelector('[data-public-profile-status]').textContent, '');
    assert.equal(document.querySelector('[data-public-profile-name]').textContent, 'Sample Creator');
    assert.equal(document.querySelector('.public-profile-summary').classList.contains('preview-hidden'), true);
    const boundaries = document.querySelector('[data-public-profile-boundaries]');
    const instructions = document.querySelector('[data-public-profile-instructions]');
    const toys = document.querySelector('[data-public-profile-hardware]');
    const wishlist = document.querySelector('[data-public-profile-wishlist]');
    assert.equal(boundaries.classList.contains('preview-hidden'), mode === 'empty');
    assert.equal(instructions.classList.contains('preview-hidden'), mode === 'empty');
    assert.equal(toys.classList.contains('preview-hidden'), mode !== 'published');
    assert.equal(wishlist.classList.contains('preview-hidden'), mode !== 'published');
    if (mode === 'published') {
      assert.equal(toys.querySelector('.public-hardware-copy h3').textContent, '<script>Gush</script>');
      assert.equal(toys.querySelector('script'), null);
      assert.equal(wishlist.querySelector('.public-wishlist-copy h3').textContent, 'Throne Wishlist');
      assert.equal(wishlist.querySelector('a').getAttribute('href'), 'https://throne.com/example');
    }
    if (mode !== 'empty') {
      assert.deepEqual([...boundaries.querySelectorAll('.public-boundaries-list li')].map(item => item.textContent), ['<script>Respect limits</script>', 'Second line']);
      assert.equal(boundaries.querySelector('script'), null);
      assert.equal(instructions.querySelector('[data-profile-protocol-text] p').textContent, 'Contact me in-world.Confirm a time.');
      assert.equal(instructions.querySelectorAll('[data-profile-protocol-text] br').length, 1);
    }
    assert.equal(requests[1].searchParams.get('is_published'), 'eq.true');
    assert.equal(requests[1].searchParams.get('profile_id'), 'eq.33333333-3333-4333-8333-333333333333');
    const nav = document.querySelector('[data-public-profile-tabs]');
    const preview = document.querySelector('[data-public-gallery-preview-section]');
    assert.equal(nav.hidden, mode === 'empty');
    assert.equal(preview.classList.contains('preview-hidden'), mode === 'empty');
    const galleryTab = document.getElementById('profile-tab-gallery');
    const details = document.getElementById('profile-panel-details');
    const gallery = document.getElementById('profile-panel-gallery');
    assert.equal(gallery.classList.contains('preview-hidden'), true);
    if (mode === 'published') {
      assert.equal(document.querySelectorAll('[data-public-gallery-preview] [data-photo]').length, 4);
      assert.equal(document.querySelectorAll('#gallery-library-grid [data-photo]').length, 5);
      assert.equal(galleryTab.textContent, 'Gallery (5)');
      assert.equal(document.querySelector('[data-public-profile-content]').innerHTML.includes('/images/photo-0.jpg'), false);
      assert.equal(document.querySelectorAll('script').length, 1);
      let focused = false;
      galleryTab.focus = () => { focused = true; };
      nav.scrollIntoView = () => {};
      document.querySelector('[data-public-gallery-view-all]').click();
      assert.equal(focused, true);
      assert.equal(galleryTab.getAttribute('aria-selected'), 'true');
      assert.equal(details.classList.contains('preview-hidden'), true);
      assert.equal(gallery.classList.contains('preview-hidden'), false);
      const event = new window.Event('keydown', { cancelable: true });
      event.key = 'ArrowLeft';
      galleryTab.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true);
      assert.equal(document.getElementById('profile-tab-details').getAttribute('aria-selected'), 'true');
      assert.equal(details.classList.contains('preview-hidden'), false);
    } else if (mode === 'single') {
      assert.equal(document.querySelectorAll('[data-public-gallery-preview] [data-photo]').length, 1);
      assert.equal(document.querySelectorAll('#gallery-library-grid [data-photo]').length, 1);
      assert.equal(galleryTab.textContent, 'Gallery (1)');
      assert.equal(document.querySelector('[data-public-gallery-view-all]').textContent, 'View all 1 photo');
      const image = document.querySelector('[data-public-gallery-preview] img');
      image.dispatchEvent(new window.Event('error'));
      assert.equal(image.hidden, true);
      assert.match(document.querySelector('[data-public-gallery-preview]').textContent, /Photo 1 - image unavailable/);
    } else {
      assert.equal(document.querySelectorAll('[data-photo]').length, 0);
      if (mode === 'failed') {
        assert.equal(document.querySelector('[data-public-gallery-preview-status]').textContent, 'Gallery is temporarily unavailable.');
        assert.equal(document.querySelector('[data-public-gallery-status]').textContent, 'Gallery is temporarily unavailable.');
        assert.equal(document.querySelector('[data-public-gallery-view-all]').hidden, true);
        galleryTab.click();
        assert.equal(gallery.classList.contains('preview-hidden'), false);
      }
    }
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousLocation === undefined) delete globalThis.location; else globalThis.location = previousLocation;
  }
});
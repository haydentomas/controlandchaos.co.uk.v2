import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { createPublicDirectoryClient, directoryConfig, fetchDirectory, fetchPublicProfile, publicImageUrl, PUBLIC_PROFILE_COLUMNS } from '../src/modules/directory-api.js';
import { directoryCard } from '../src/modules/directory.js';

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
    assert.equal(card.querySelector('[data-directory-link]').getAttribute('href'), '/directory-profile.html?slug=sample-profile');
    assert.equal(publicImageUrl('data:text/html,test'), '');
    assert.equal(publicImageUrl('//unsafe.example/image'), '');
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});
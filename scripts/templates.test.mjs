import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseHTML } from 'linkedom';
import { pageInventory } from './render-templates.mjs';

const root = path.resolve(import.meta.dirname, '..');
const manifest = await pageInventory();

test('all public and directory template families exist', () => {
  for (const name of ['index', 'directory', 'get-listed', 'checkout', 'directory-admin', 'directory-editor', 'profile', 'profile-blog', 'profile-feed', 'profile-gallery', 'profile-post', 'profile-white-label', 'profile-post-white-label']) assert.ok(manifest.some(template => template.page === `${name}.html`));
  assert.ok(manifest.length >= 28);
});

test('profile protocol controls are labelled and bounded, and public cards start hidden', async () => {
  const { document: editor } = parseHTML(await fs.readFile(path.join(root, 'directory-editor.html'), 'utf8'));
  for (const name of ['boundaries', 'booking_instructions']) {
    const field = editor.querySelector(`textarea[name="${name}"]`);
    assert.equal(field.getAttribute('maxlength'), '4000');
    assert.ok(editor.querySelector(`label[for="${field.id}"]`));
    assert.ok(field.closest('[data-creator-fields]'));
  }
  const anchor = editor.querySelector('.creator-editor-nav a[href="#creator-protocol"]');
  assert.ok(editor.querySelector(anchor.getAttribute('href')));
  const username = editor.querySelector('[data-creator-username]');
  assert.equal(username.hasAttribute('readonly'), true);
  assert.equal(username.getAttribute('aria-describedby'), 'creator-username-note');
  assert.equal(editor.getElementById('creator-username-note').textContent, 'From your linked avatar');
  const sidebar = editor.querySelector('.creator-editor-sidebar');
  assert.ok(sidebar.contains(editor.querySelector('.creator-editor-nav')));
  assert.ok(sidebar.contains(editor.querySelector('.creator-editor-savebar')));
  assert.ok(sidebar.querySelector('[data-creator-save]'));
  assert.ok(sidebar.querySelector('input[name="is_published"]'));
  const publicProfileLink = sidebar.querySelector('[data-creator-public]');
  assert.equal(sidebar.querySelector('[data-creator-save]').nextElementSibling, publicProfileLink);
  assert.equal(publicProfileLink.textContent, 'View public profile');
  const { document: profile } = parseHTML(await fs.readFile(path.join(root, 'directory-profile.html'), 'utf8'));
  for (const selector of ['[data-public-profile-boundaries]', '[data-public-profile-instructions]']) {
    const card = profile.querySelector(selector);
    assert.ok(card.classList.contains('preview-hidden'));
    assert.ok(card.querySelector('h2'));
    assert.equal(card.querySelector('[data-profile-protocol-text]').textContent, '');
  }
});

test('directory profile tabs expose only supported views with accessible panel relationships', async () => {
  const { document } = parseHTML(await fs.readFile(path.join(root, 'directory-profile.html'), 'utf8'));
  const tabs = [...document.querySelectorAll('[data-public-profile-tabs] [role="tab"]')];
  assert.deepEqual(tabs.map(tab => tab.textContent.trim()), ['Rate Card & Bio', 'Gallery', 'Blog']);
  assert.equal(document.querySelector('[data-public-profile-tabs]').hasAttribute('hidden'), true);
  assert.equal(tabs[1].hasAttribute('hidden'), true);
  assert.equal(tabs[2].hasAttribute('hidden'), true);
  for (const tab of tabs) {
    const panel = document.getElementById(tab.getAttribute('aria-controls'));
    assert.ok(panel);
    assert.equal(panel.getAttribute('aria-labelledby'), tab.id);
    assert.equal(panel.getAttribute('role'), 'tabpanel');
  }
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
  assert.equal(document.getElementById(tabs[1].getAttribute('aria-controls')).classList.contains('preview-hidden'), true);
});

test('public profile sidebar follows Gallery, toys, protocol, hours, booking and wishlist order', async () => {
  const { document } = parseHTML(await fs.readFile(path.join(root, 'directory-profile.html'), 'utf8'));
  const sections = [...document.querySelectorAll('.public-profile-sidebar > section')];
  assert.equal(sections[0].hasAttribute('data-public-gallery-preview-section'), true);
  assert.equal(sections[1].hasAttribute('data-public-tributes'), true);
  assert.equal(sections[1].hidden, true);
  assert.deepEqual(sections.slice(2, 7).map(section => section.querySelector('h2').textContent.trim()), [
    `${String.fromCodePoint(0x26a1)} My Toys`,
    `${String.fromCodePoint(0x1f6e1)} Hard Limits & Boundaries`,
    `${String.fromCodePoint(0x1f552)} Booking Hours`,
    'How to Book',
    `${String.fromCodePoint(0x1f381)} Wishlist & Tributes`
  ]);
});

test('public profile rate categories are not nested inside a shared panel', async () => {
  const { document } = parseHTML(await fs.readFile(path.join(root, 'directory-profile.html'), 'utf8'));
  const section = document.querySelector('[data-public-profile-rate-section]');
  assert.ok(section);
  assert.equal(section.classList.contains('public-profile-panel'), false);
  assert.ok(section.querySelector('[data-public-profile-rates]'));
});

test('live booking form is a Netlify form and is excluded from preview-only handling', async () => {
  const { document } = parseHTML(await fs.readFile(path.join(root, 'directory-profile.html'), 'utf8'));
  const form = document.querySelector('[data-live-booking-form]');
  assert.ok(form);
  assert.equal(form.getAttribute('name'), 'directory-booking');
  assert.equal(form.getAttribute('data-netlify'), 'true');
  assert.equal(form.getAttribute('data-netlify-honeypot'), 'bot-field');
  assert.ok(form.querySelector('[name="profile_id"]'));
  assert.ok(form.querySelector('[name="selected_services"]'));
  const previewActions = await fs.readFile(path.join(root, 'src/modules/preview-actions.js'), 'utf8');
  assert.match(previewActions, /form:not\(\[data-live-auth-form\]\):not\(\[data-live-booking-form\]\)/);
});

test('creator Studio keeps the booking notification email owner-only', async () => {
  const { document } = parseHTML(await fs.readFile(path.join(root, 'directory-editor.html'), 'utf8'));
  const email = document.querySelector('[name="booking_email"]');
  assert.ok(email);
  assert.equal(email.type, 'email');
  assert.equal(email.getAttribute('maxlength'), '254');
  assert.ok(email.closest('[data-booking-fields]'));
  const { document: profile } = parseHTML(await fs.readFile(path.join(root, 'directory-profile.html'), 'utf8'));
  assert.equal(profile.querySelector('[name="booking_email"]'), null);
});

test('creator Studio exposes owner repeaters for My Toys and Wishlist', async () => {
  const { document } = parseHTML(await fs.readFile(path.join(root, 'directory-editor.html'), 'utf8'));
  for (const selector of ['[name="hardware_title"]', '[data-hardware-editor]', '[data-hardware-add]', '[name="wishlist_title"]', '[data-wishlist-editor]', '[data-wishlist-add]']) assert.ok(document.querySelector(selector), selector);
  for (const kind of ['toys', 'wishlist']) {
    const section = document.querySelector(`[data-collection-section="${kind}"]`);
    assert.ok(section.querySelector('[data-collection-section-toggle]'));
    assert.equal(section.querySelector('[data-collection-section-details]').hidden, true);
  }
  const { document: profile } = parseHTML(await fs.readFile(path.join(root, 'directory-profile.html'), 'utf8'));
  for (const selector of ['[data-public-profile-hardware]', '[data-public-profile-wishlist]']) assert.ok(profile.querySelector(selector));
});

test('signed-in account exposes directory and creator subscription lists', async () => {
  const { document } = parseHTML(await fs.readFile(path.join(root, 'auth.html'), 'utf8'));
  const session = document.querySelector('[data-account-session]');
  assert.ok(session.querySelector('[data-account-directory] [data-subscription-list]'));
  assert.ok(session.querySelector('[data-account-creator-subscriptions] [data-creator-subscription-list]'));
  assert.equal(session.querySelector('[data-subscription-refresh]').textContent.trim(), 'Refresh subscriptions');
});

test('directory admin page is a live authenticated console, not a browser-token mock', async () => {
  const { document } = parseHTML(await fs.readFile(path.join(root, 'directory-admin.html'), 'utf8'));
  assert.ok(document.querySelector('[data-directory-admin]'));
  assert.ok(document.querySelector('[data-admin-gate]'));
  assert.ok(document.querySelector('[data-admin-listings]'));
  assert.ok(document.querySelector('[data-admin-subscribers]'));
  assert.ok(document.querySelector('[data-admin-edit-form]'));
  assert.equal(document.querySelector('[name="ADMIN_EDIT_TOKEN"]'), null);
  assert.equal(document.querySelector('[placeholder*="admin token"]'), null);
  assert.equal(document.querySelector('input[type="password"]'), null);
});

for (const template of manifest) test(`${template.page}: flat, styled, and isolated from the backend`, async () => {
  const html = await fs.readFile(path.join(root, template.page), 'utf8');
  const { document } = parseHTML(html);
  assert.equal(document.querySelectorAll('[style]').length, 0);
  assert.equal([...document.querySelectorAll('[class]')].some(element => [...element.classList].some(name => /^ui-[a-z]+-[a-f0-9]{8}$/.test(name))), false);
  for (const paragraph of document.querySelectorAll('.article-content p')) assert.ok(!paragraph.hasAttribute('class'));
  for (const element of document.querySelectorAll('[id]')) assert.ok(!/^spotlight-card-|^post-(?:blog|\d)/.test(element.id));
  assert.equal([...document.querySelectorAll('*')].some(element => [...element.attributes].some(attribute => attribute.name.startsWith('on'))), false);
  assert.equal(document.querySelectorAll('script').length, 1);
  assert.equal(document.querySelector('script').getAttribute('src'), '/src/main.js');
  assert.ok(document.body.textContent.trim().length > 100);
  assert.ok(!html.includes('CC_DIRECTORY_SECRET_2026_GOLD'));
  assert.ok(!html.includes('/.netlify/functions/'));
  assert.equal(document.querySelector('meta[name="robots"]').getAttribute('content'), 'noindex,nofollow');
  for (const image of document.querySelectorAll('img[src]')) {
    const src = image.getAttribute('src');
    if (src.startsWith('/')) await fs.access(path.join(root, 'public', decodeURIComponent(src.split('?')[0])));
  }
  for (const anchor of document.querySelectorAll('a[href]')) {
    const target = anchor.getAttribute('href').split('#')[0];
    if (target.startsWith('/') && target.endsWith('.html')) await fs.access(path.join(root, target));
  }
});

test('single-post text and images use readable styling rather than generated presentation IDs', async () => {
  const { document } = parseHTML(await fs.readFile(path.join(root, 'profile-post.html'), 'utf8'));
  assert.equal(document.getElementById('dynamic-article-wrap'), null);
  for (const paragraph of document.querySelectorAll('.article-content p')) {
    assert.equal(paragraph.hasAttribute('id'), false);
    assert.equal(paragraph.hasAttribute('class'), false);
  }
  const image = document.querySelector('.companion-article-body img');
  assert.ok([...image.classList].some(name => name.startsWith('tw:')));
});
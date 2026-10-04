import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseHTML } from 'linkedom';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'templates.json'), 'utf8'));

test('all public and directory template families exist', () => {
  for (const name of ['index', 'directory', 'get-listed', 'checkout', 'directory-admin', 'directory-editor', 'profile', 'profile-blog', 'profile-feed', 'profile-gallery', 'profile-post', 'profile-white-label', 'profile-post-white-label']) assert.ok(manifest.some(template => template.page === `${name}.html`));
  assert.ok(manifest.length >= 29);
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
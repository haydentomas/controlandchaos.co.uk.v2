import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pageShellTags, pageShellPlugin } from './page-shell.mjs';
import { parseHTML } from 'linkedom';
import { loadSite, renderPage, templateEnvironment } from './render-templates.mjs';

test('shared layout renders escaped site settings and complete navigation before JavaScript', async () => {
  const site = await loadSite();
  site.navigation.links[0].label = '<img src=x onerror=alert(1)>';
  site.footer.copyright = 'One shared copyright';
  const page = { template: 'test', title: 'A & B', bodyClass: '', whiteLabel: false, meta: [], links: [] };
  const html = templateEnvironment().renderString('{% extends "layouts/site.njk" %}{% block content %}<main>Test content</main>{% endblock %}', { page, site });
  const { document } = parseHTML(html);
  assert.equal(document.querySelectorAll('site-navbar').length, 1);
  assert.equal(document.querySelectorAll('site-footer').length, 1);
  assert.equal(document.querySelector('.footer-bottom').textContent, site.footer.copyright);
  assert.equal(document.querySelectorAll('.nav-link img').length, 0);
  assert.equal(document.querySelector('.nav-link').textContent, site.navigation.links[0].label);
  assert.equal(document.title, page.title);
  assert.equal(document.querySelectorAll('script').length, 1);
});

test('white-label layout omits global navigation and renders only the compact footer', async () => {
  const site = await loadSite();
  const page = { template: 'test-white-label', title: 'Creator', bodyClass: 'is-whitelabel-custom-domain', whiteLabel: true, meta: [], links: [] };
  const html = templateEnvironment().renderString('{% extends "layouts/white-label.njk" %}{% block content %}<main>Creator content</main>{% endblock %}', { page, site });
  const { document } = parseHTML(html);
  assert.equal(document.querySelector('site-navbar'), null);
  assert.equal(document.querySelector('.footer-grid'), null);
  assert.ok(document.querySelector('.footer-bottom'));
  assert.equal(document.body.className, page.bodyClass);
});

test('one settings change reaches every page through shared templates', async () => {
  const site = await loadSite();
  site.footer.copyright = 'Shared footer regression check';
  site.navigation.links[0].label = 'Shared navigation regression check';
  const manifest = JSON.parse(await fs.readFile(new URL('../templates.json', import.meta.url), 'utf8'));
  for (const { page } of manifest) {
    const source = await fs.readFile(new URL(`../templates/pages/${page.replace('.html', '.njk')}`, import.meta.url), 'utf8');
    assert.match(source, /extends "layouts\/(?:site|white-label)\.njk"/);
    assert.doesNotMatch(source, /<site-navbar|<site-footer|<head>|<script/);
    const { document } = parseHTML(await renderPage(page, { site }));
    assert.equal(document.querySelector('.footer-bottom').textContent, site.footer.copyright, page);
    if (!page.includes('white-label')) assert.equal(document.querySelector('.nav-link').textContent, site.navigation.links[0].label, page);
  }
});

test('creator hero data is shared and escaped on profile, article and white-label pages', async () => {
  const creator = JSON.parse(await fs.readFile(new URL('../content/creator-preview.json', import.meta.url), 'utf8'));
  creator.name = '<img src=x onerror=alert(1)>';
  const manifest = JSON.parse(await fs.readFile(new URL('../templates.json', import.meta.url), 'utf8'));
  for (const { page } of manifest.filter(item => item.page.startsWith('profile'))) {
    const source = await fs.readFile(new URL(`../templates/pages/${page.replace('.html', '.njk')}`, import.meta.url), 'utf8');
    assert.match(source, /include "partials\/creator-hero\.njk"/);
    assert.match(source, /include "partials\/profile-tabs\.njk"/);
    const { document } = parseHTML(await renderPage(page, { creator }));
    assert.equal(document.querySelector('header.hero h1').textContent, creator.name);
    assert.equal(document.querySelector('header.hero h1 img'), null);
    assert.equal(document.querySelectorAll('#profile-tabs-nav').length, 1);
  }
});

test('renderer rejects paths outside the page inventory and missing sources', async () => {
  await assert.rejects(renderPage('../index.html'), /Invalid page name/);
  await assert.rejects(renderPage('missing.html'), /ENOENT/);
});

test('page shell paints a dark canvas and loads CSS before document content', () => {
  const tags = pageShellTags();
  const canvas = tags.find(tag => tag.attrs?.id === 'v2-page-canvas');
  assert.equal(canvas.injectTo, 'head-prepend');
  assert.match(canvas.children, /background:#12100e/);
  assert.match(canvas.children, /color-scheme:dark/);
  assert.ok(tags.some(tag => tag.tag === 'link' && tag.attrs.href === '/src/templates.css' && tag.attrs.rel === 'stylesheet'));
  assert.equal(pageShellPlugin().transformIndexHtml.order, 'pre');
  assert.ok(!tags.some(tag => tag.tag === 'script'));
});

test('page fades use native navigation and respect reduced motion', async () => {
  const css = await fs.readFile(new URL('../src/templates.css', import.meta.url), 'utf8');
  assert.match(css, /@view-transition\s*\{\s*navigation:\s*auto/);
  assert.match(css, /::view-transition-old\(root\)/);
  assert.match(css, /::view-transition-new\(root\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /animation:\s*none !important/);
});
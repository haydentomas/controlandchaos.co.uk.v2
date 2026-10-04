import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { adminRoutePlugin, pageShellTags, pageShellPlugin } from './page-shell.mjs';
import { parseHTML } from 'linkedom';
import { loadSite, pageInventory, renderPage, staleBlogPages, staleGuidePages, templateEnvironment } from './render-templates.mjs';
import { loadGuides, loadPosts, prepareEvents, prepareGuides, preparePosts, validateSiteContent } from './cms-content.mjs';
import YAML from 'yaml';
import { localProxyOptions } from './start-cms.mjs';
import { generateCMSPreviews } from './cms-previews.mjs';

test('guide records sanitize sections, preserve anchors and reject unsafe or duplicate data', () => {
  const guide = { id: 'test-guide', title: 'Manual', badge: 'GUIDE', icon: 'G', price: 'Free', marketplace_url: 'https://marketplace.secondlife.com', pill_text: 'Documentation', description: 'Description', published: true, order: 0, listing: { title: 'Manual', badge: 'GUIDE', description: 'Description', image: '/images/logo.png', featured: false }, sections: [{ title: 'Start', section_id: 'quick-start', content: '## Heading\n\n<script>alert(1)</script><img src=x onerror=alert(1)>' }] };
  const result = prepareGuides([guide, { ...guide, id: 'draft-guide', published: false }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].url, '/guide-test-guide.html');
  assert.equal(result[0].sections[0].section_id, 'quick-start');
  const { document } = parseHTML(result[0].sections[0].bodyHtml);
  assert.ok(document.querySelector('h2'));
  assert.equal(document.querySelector('script,[onerror]'), null);
  assert.throws(() => prepareGuides([guide, guide]), /Duplicate guide ID/);
  assert.throws(() => prepareGuides([{ ...guide, sections: [...guide.sections, ...guide.sections] }]), /duplicate or reserved section anchor/);
  assert.throws(() => prepareGuides([{ ...guide, marketplace_url: 'javascript:alert(1)' }]), /Guide/);
});

test('new guides generate pages, working anchors, metadata and safe unpublish cleanup', async () => {
  const original = (await loadGuides())[0];
  const { url, canonical, sections, ...record } = original;
  const guides = prepareGuides([{ ...record, id: 'new-device', title: 'New Device', sections: sections.map(({ bodyHtml, ...section }) => section) }]);
  assert.ok((await pageInventory([], guides)).some(item => item.page === 'guide-new-device.html'));
  const { document } = parseHTML(await renderPage('guide-new-device.html', { guides }));
  assert.match(document.querySelector('h1').textContent, /New Device/);
  const jump = document.querySelector('header a[href^="#"]').getAttribute('href').slice(1);
  assert.ok(document.getElementById(jump));
  assert.equal(document.querySelector('link[rel="canonical"]').getAttribute('href'), 'https://controlandchaos.co.uk/guides/new-device/');
  assert.ok(document.querySelector('.manual-rich-text'));
  await assert.rejects(renderPage('guide-new-device.html', { guides: [] }), /not published/);
  assert.deepEqual(staleGuidePages(['guide-old.html', 'guide-template.html', '../private.html', 'index.html'], ['guide-new-device.html']), ['guide-old.html']);
  const directory = parseHTML(await renderPage('guides.html', { guides })).document;
  assert.equal(directory.querySelectorAll('[data-cms-guide-card]').length, 1);
  assert.equal(directory.querySelector('[data-cms-guide-card] a').getAttribute('href'), '/guide-new-device.html');
});

test('site posts validate, sanitize Markdown and omit unpublished records', () => {
  const post = { id: 'test-post', title: 'Test', category: 'Community', date: 'October 2026', published_at: '2026-10-04', author: 'Staff', summary: 'Summary', content: '## Heading\n\n**Bold**\n\n<script>alert(1)</script><img src="/images/logo.png" onerror="alert(1)">\n\n[Unsafe](javascript:alert(1))', published: true, order: 0 };
  const prepared = preparePosts([post, { ...post, id: 'draft', published: false }]);
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].url, '/blog-test-post.html');
  const { document } = parseHTML(prepared[0].bodyHtml);
  assert.ok(document.querySelector('h2'));
  assert.ok(document.querySelector('strong'));
  assert.equal(document.querySelector('script, [onerror], a[href^="javascript:"]'), null);
  assert.throws(() => preparePosts([post, post]), /Duplicate blog ID/);
  assert.throws(() => preparePosts([{ ...post, id: '../private' }]), /Blog post/);
  assert.throws(() => preparePosts([{ ...post, featured_image: 'javascript:alert(1)' }]), /Blog post/);
});

test('new published site posts enter the page inventory and render metadata and article content', async () => {
  const posts = preparePosts([{ id: 'brand-new-post', title: 'New & Useful', category: 'Community', date: 'October 2026', published_at: '2026-10-04', author: 'Staff', summary: 'New post summary', content: '## Fresh article\n\nA paragraph.', published: true, order: 0 }]);
  const inventory = await pageInventory(posts);
  assert.ok(inventory.some(item => item.page === 'blog-brand-new-post.html'));
  assert.ok(!inventory.some(item => item.page === 'blog-vow-launch.html'));
  const { document } = parseHTML(await renderPage('blog-brand-new-post.html', { posts }));
  assert.equal(document.querySelector('h1').textContent, 'New & Useful');
  assert.equal(document.querySelector('.article-body h2').textContent, 'Fresh article');
  assert.equal(document.querySelector('meta[property="og:title"]').getAttribute('content'), 'New & Useful');
  assert.equal(document.querySelector('link[rel="canonical"]').getAttribute('href'), 'https://controlandchaos.co.uk/blog/brand-new-post/');
  await assert.rejects(renderPage('blog-unpublished.html', { posts }), /not published/);
  assert.deepEqual(staleBlogPages(['blog-unpublished.html', 'index.html', '../private.html', 'profile-blog.html'], ['blog-brand-new-post.html']), ['blog-unpublished.html']);
});

test('blog ordering uses publication date, then same-date order; empty feeds render safely', async () => {
  const existing = (await loadPosts())[0];
  const records = [
    { ...existing, id: 'old', published_at: '2026-09-01', order: 0 },
    { ...existing, id: 'new-second', published_at: '2026-10-04', order: 1 },
    { ...existing, id: 'new-first', published_at: '2026-10-04', order: 0 }
  ].map(({ bodyHtml, url, canonical, shareUrl, readMinutes, ...record }) => record);
  assert.deepEqual(preparePosts(records).map(post => post.id), ['new-first', 'new-second', 'old']);
  const { document } = parseHTML(await renderPage('blog.html', { posts: [] }));
  assert.equal(document.querySelectorAll('[data-blog-category]').length, 0);
  assert.ok(!document.querySelector('[data-blog-empty]').classList.contains('preview-hidden'));
});

test('CMS previews reuse site partials, escape draft text and block unsafe links', async () => {
  await generateCMSPreviews();
  const runtime = createRequire(import.meta.url)('nunjucks/browser/nunjucks-slim.js');
  const window = {};
  runInNewContext(await fs.readFile(new URL('../public/admin/preview-templates.js', import.meta.url), 'utf8'), { window });
  const previews = new Map();
  const styles = [];
  runInNewContext(await fs.readFile(new URL('../public/admin/previews.js', import.meta.url), 'utf8'), {
    window, nunjucks: runtime, URL,
    h: (tag, props) => ({ tag, props }),
    createClass: component => component,
    CMS: { registerPreviewTemplate: (name, component) => previews.set(name, component), registerPreviewStyle: url => styles.push(url) }
  });
  assert.ok(styles.includes('/admin/site-preview.css'));
  assert.ok(styles.includes('/admin/preview.css'));
  const render = (name, data) => {
    const result = previews.get(name).render.call({ props: { entry: { get: () => ({ toJS: () => data }) }, getAsset: value => ({ toString: () => value }) } });
    return parseHTML(result.props.dangerouslySetInnerHTML.__html).document;
  };
  const site = await loadSite();
  site.brand = '<img src=x onerror=alert(1)>';
  site.logo = 'javascript:alert(1)';
  site.navigation.links[0].url = 'javascript:alert(1)';
  const settings = render('global', site);
  assert.ok(settings.querySelector('.navbar'));
  assert.ok(settings.querySelector('.footer'));
  assert.equal(settings.querySelector('.brand-logo-img').getAttribute('src'), '/images/logo.png');
  assert.equal(settings.querySelector('.nav-link').getAttribute('href'), '#');
  assert.equal(settings.querySelector('[onerror]'), null);
  const event = JSON.parse(await fs.readFile(new URL('../content/events/cage-break-championship.json', import.meta.url), 'utf8'));
  event.title = '<img src=x onerror=alert(1)>';
  event.slurl = 'javascript:alert(1)';
  const card = render('events', event);
  assert.equal(card.querySelector('.card-title').textContent, event.title);
  assert.equal(card.querySelector('.card-title img'), null);
  assert.equal(card.querySelector('.card-actions-bar a:last-child').getAttribute('href'), '#');
});

test('local CMS uses only loopback hosts and a V2-rooted development proxy', async () => {
  const config = YAML.parse(await fs.readFile(new URL('../public/admin/config.yml', import.meta.url), 'utf8'));
  assert.equal(config.local_backend.url, 'http://127.0.0.1:8081/api/v1');
  assert.deepEqual(config.local_backend.allowed_hosts, ['localhost', '127.0.0.1']);
  assert.equal(config.backend.name, 'github');
  const options = localProxyOptions();
  assert.equal(options.cwd, fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, ''));
  assert.equal(options.env.BIND_HOST, '127.0.0.1');
  assert.equal(options.env.PORT, '8081');
  assert.equal(options.env.ORIGIN, '');
});

test('Vite serves Decap for admin directory URLs rather than the homepage fallback', async () => {
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('..', import.meta.url)),
    plugins: [adminRoutePlugin()],
    server: { host: '127.0.0.1', port: 0 },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'silent'
  });
  try {
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    for (const route of ['/admin', '/admin/', '/admin/?review=1', '/admin/index.html']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, /Staff CMS<\/title>/);
      assert.match(html, /decap-cms@3\.16\.3/);
      assert.doesNotMatch(html, /MAKING FINDOM FUN AGAIN/);
    }
    assert.match(await (await fetch(base + '/admin/config.yml')).text(), /name: github/);
    assert.match(await (await fetch(base + '/')).text(), /MAKING FINDOM FUN AGAIN/);
  } finally {
    await server.close();
  }
});

test('Decap exposes only staff records and preserves all shared settings fields', async () => {
  const config = YAML.parse(await fs.readFile(new URL('../public/admin/config.yml', import.meta.url), 'utf8'));
  assert.equal(config.backend.name, 'github');
  assert.equal(config.backend.repo, 'haydentomas/controlandchaos.co.uk.v2');
  assert.equal(config.backend.branch, 'main');
  assert.deepEqual(config.collections.map(collection => collection.name), ['events', 'blog', 'product_guides', 'settings']);
  assert.equal(config.media_folder, 'public/assets/uploads');
  assert.equal(config.public_folder, '/assets/uploads');
  const fields = config.collections.find(collection => collection.name === 'settings').files[0].fields;
  assert.deepEqual(fields.map(field => field.name).sort(), Object.keys(await loadSite()).sort());
  assert.equal(fields.find(field => field.name === 'fontStylesheet').widget, 'hidden');
});

test('editable event records filter unpublished entries, sort and safely render changed text', async () => {
  const original = JSON.parse(await fs.readFile(new URL('../content/events/cage-break-championship.json', import.meta.url), 'utf8'));
  const first = { ...original, id: 'first', order: 1, title: '<img src=x onerror=alert(1)>' };
  const second = { ...original, id: 'second', order: 2 };
  const unpublished = { ...original, id: 'hidden', published: false };
  const events = prepareEvents([second, unpublished, first]);
  assert.deepEqual(events.map(event => event.id), ['first', 'second']);
  const { document } = parseHTML(await renderPage('events.html', { events }));
  assert.equal(document.querySelectorAll('[data-event-category]').length, 2);
  assert.equal(document.querySelector('[data-event-category] h3').textContent, first.title);
  assert.equal(document.querySelector('[data-event-category] h3 img'), null);
  assert.equal(document.querySelector('[data-event-counter]').textContent, 'Showing 2 of 2 events');
  const empty = parseHTML(await renderPage('events.html', { events: [] })).document;
  assert.match(empty.querySelector('[data-event-list]').textContent, /No events scheduled/);
});

test('event validation rejects unsafe links, duplicate IDs and invalid calendar ranges', async () => {
  const original = JSON.parse(await fs.readFile(new URL('../content/events/cage-break-championship.json', import.meta.url), 'utf8'));
  assert.throws(() => prepareEvents([{ ...original, slurl: 'javascript:alert(1)' }]), /Event/);
  assert.throws(() => prepareEvents([original, original]), /Duplicate event ID/);
  assert.throws(() => prepareEvents([{ ...original, gcal_start: '2026-10-09T18:00:00-07:00' }]), /both be supplied/);
  assert.throws(() => prepareEvents([{ ...original, gcal_start: '2026-10-09T18:00:00-07:00', gcal_end: '2026-10-09T17:00:00-07:00' }]), /end must follow start/);
  assert.throws(() => prepareEvents([{ ...original, gcal_start: '2026-10-09T18:00', gcal_end: '2026-10-09T19:00' }]), /date-time/);
  const event = prepareEvents([{ ...original, gcal_start: '2026-10-09T18:00:00-07:00', gcal_end: '2026-10-09T19:00:00-07:00' }])[0];
  assert.equal(new URL(event.calendarUrl).searchParams.get('dates'), '20261010T010000Z/20261010T020000Z');
  const optional = { ...original };
  for (const name of ['gcal_title', 'gcal_details', 'gcal_location', 'gcal_start', 'gcal_end']) delete optional[name];
  assert.equal(new URL(prepareEvents([optional])[0].calendarUrl).searchParams.get('text'), original.title);
});

test('CMS content validation rejects unsafe destinations and unknown internal settings', async () => {
  const site = await loadSite();
  site.navigation.links[0].url = 'javascript:alert(1)';
  assert.throws(() => validateSiteContent(site), /content\/site.json/);
  site.navigation.links[0].url = '/products.html';
  site.adminToken = 'not-a-public-setting';
  assert.throws(() => validateSiteContent(site), /additional properties/);
});

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
  const manifest = await pageInventory();
  for (const { page } of manifest) {
    const sourceName = page.startsWith('blog-') ? 'site-blog-article.njk' : page.startsWith('guide-') && page !== 'guide-template.html' ? 'product-manual.njk' : page.replace('.html', '.njk');
    const source = await fs.readFile(new URL(`../templates/pages/${sourceName}`, import.meta.url), 'utf8');
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
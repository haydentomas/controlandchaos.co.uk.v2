import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { gunzipSync } from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const inventory = JSON.parse(await fs.readFile(path.join(root, 'templates.json'), 'utf8'));
const references = JSON.parse(gunzipSync(await fs.readFile(new URL('./fixtures/visual-reference.json.gz', import.meta.url))).toString('utf8'));
const manifest = inventory.filter(template => references[template.page]);
const output = path.join(root, 'test-results/visual');
let server;
let baseUrl = process.env.TEMPLATE_BASE_URL;
if (!baseUrl) {
  const buildRoot = path.join(root, 'build');
  server = http.createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const pagePath = pathname === '/' ? '/index.html' : pathname.endsWith('.html') ? pathname : `${pathname}.html`;
    const file = path.resolve(buildRoot, '.' + pagePath);
    if (!file.startsWith(buildRoot + path.sep)) { response.writeHead(403); response.end(); return; }
    try {
      const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
      response.setHeader('Content-Type', types[path.extname(file).toLowerCase()] || 'application/octet-stream');
      response.end(await fs.readFile(file));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
const selectors = ['.navbar-container', 'header.hero', 'main', '#profile-tabs-nav', '.section-title', '.card', '.editor-card'];

try {
  const navigationContext = await browser.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: 'no-preference' });
  await navigationContext.addInitScript(() => {
    addEventListener('pagereveal', event => { window.v2NativePageTransition = !!event.viewTransition; });
  });
  const navigationPage = await navigationContext.newPage();
  let releaseStyles;
  const styleGate = new Promise(resolve => { releaseStyles = resolve; });
  await navigationPage.route('**/assets/*.css', async route => { await styleGate; await route.continue(); });
  await navigationPage.goto(`${baseUrl}/`, { waitUntil: 'commit' });
  await navigationPage.locator('#v2-page-canvas').waitFor({ state: 'attached' });
  const earlyCanvas = await navigationPage.evaluate(() => ({
    background: getComputedStyle(document.documentElement).backgroundColor,
    scheme: getComputedStyle(document.documentElement).colorScheme,
    stylesheet: !!document.head.querySelector('link[rel="stylesheet"]')
  }));
  if (earlyCanvas.background !== 'rgb(18, 16, 14)' || earlyCanvas.scheme !== 'dark' || !earlyCanvas.stylesheet) throw new Error(JSON.stringify(earlyCanvas));
  releaseStyles();
  await navigationPage.waitForLoadState('networkidle');
  await navigationPage.unroute('**/assets/*.css');
  await navigationPage.locator('.nav-link[href="/products"]').click();
  await navigationPage.waitForURL('**/products', { waitUntil: 'networkidle' });
  const nativeTransition = await navigationPage.evaluate(() => window.v2NativePageTransition);
  if (!nativeTransition) throw new Error('Native cross-document transition was not enabled');
  await navigationPage.goBack({ waitUntil: 'networkidle' });
  if (!navigationPage.url().endsWith('/')) throw new Error('Back navigation was changed');
  await navigationContext.close();
  const reducedContext = await browser.newContext({ reducedMotion: 'reduce' });
  const reducedPage = await reducedContext.newPage();
  await reducedPage.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
  const reducedAnimation = await reducedPage.evaluate(() => getComputedStyle(document.documentElement, '::view-transition-new(root)').animationName);
  if (reducedAnimation !== 'none') throw new Error('Reduced motion still animates page transitions');
  await reducedContext.close();
  console.log('Navigation: dark first paint with delayed CSS, native page fade, Back, and reduced motion passed');
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    await context.route('**/reference/*', route => {
      const filename = new URL(route.request().url()).pathname.slice('/reference/'.length);
      const body = references[filename];
      return route.fulfill({ status: typeof body === 'string' ? 200 : 404, contentType: filename.endsWith('.css') ? 'text/css' : 'text/html', body: body ?? '' });
    });
    for (const template of manifest) {
      const measurements = [];
      for (const reference of [true, false]) {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const url = `${baseUrl}/${reference ? 'reference/' : ''}${template.page}`;
        await page.goto(url, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        await page.addStyleTag({ content: '*,::before,::after { animation:none!important;transition:none!important;scroll-behavior:auto!important; }' });
        const metrics = await page.evaluate(selectors => ({
          overflow: document.documentElement.scrollWidth > innerWidth,
          background: getComputedStyle(document.body).backgroundColor,
          font: getComputedStyle(document.body).fontFamily,
          cmsArticle: !!document.querySelector('[data-cms-article]'),
          cmsGuide: !!document.querySelector('[data-cms-guide]'),
          tabs: (() => {
            const tabs = document.getElementById('profile-tabs-nav');
            if (!tabs) return null;
            const bounds = tabs.getBoundingClientRect();
            const items = [...tabs.querySelectorAll('.profile-tab-btn')].filter(item => getComputedStyle(item).display !== 'none');
            return { height: bounds.height, scrollWidth: tabs.scrollWidth, clientWidth: tabs.clientWidth, rows: new Set(items.map(item => Math.round(item.getBoundingClientRect().top))).size, allFit: items.every(item => { const rect = item.getBoundingClientRect(); return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && rect.width > 0; }) };
          })(),
          bounds: selectors.map(selector => { const element = document.querySelector(selector); if (!element) return null; const rect = element.getBoundingClientRect(); return { selector, x: rect.x, y: rect.y, width: rect.width, height: rect.height }; })
        }), selectors);
        await page.screenshot({ path: path.join(output, `${template.page.replace('.html', '')}-${viewport.width}-${reference ? 'reference' : 'tailwind'}.png`), fullPage: false });
        measurements.push({ ...metrics, errors });
        await page.close();
      }
      const [reference, actual] = measurements;
      const responsiveTabs = viewport.width <= 700 && template.page.startsWith('profile') && actual.tabs;
      const tabHeightChange = responsiveTabs ? actual.tabs.height - reference.tabs.height : 0;
      if (responsiveTabs && (!actual.tabs.allFit || actual.tabs.scrollWidth > actual.tabs.clientWidth + 1 || actual.tabs.rows < 2)) throw new Error(`Profile tabs do not all fit: ${template.page}`);
      const differences = actual.bounds.flatMap((bounds, index) => {
        const expected = reference.bounds[index];
        if (!bounds || !expected) return [];
        return ['x', 'y', 'width', 'height'].filter(key => {
          if (actual.cmsArticle && bounds.selector === 'main' && key === 'height') return false;
          if (actual.cmsGuide && bounds.selector !== '.navbar-container' && (key === 'height' || key === 'y')) return false;
          const allowed = responsiveTabs && ((bounds.selector === '#profile-tabs-nav' && key === 'height') || (bounds.selector === 'main' && key === 'height') || (key === 'y' && expected.y > reference.bounds.find(item => item?.selector === '#profile-tabs-nav').y)) ? tabHeightChange : 0;
          return Math.abs(bounds[key] - (expected[key] + allowed)) > 2;
        }).map(key => `${bounds.selector}.${key}: ${expected[key]} -> ${bounds[key]}`);
      });
      const result = { page: template.page, viewport: viewport.width, differences, responsiveTabs: actual.tabs, backgroundMatches: reference.background === actual.background, fontMatches: reference.font === actual.font, overflow: actual.overflow, referenceOverflow: reference.overflow, errors: actual.errors };
      results.push(result);
      await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(results, null, 2));
      console.log(`${template.page} ${viewport.width}: ${differences.length} layout differences; ${actual.errors.length} runtime errors`);
    }
    const interaction = await context.newPage();
    await interaction.goto(`${baseUrl}/blog.html`, { waitUntil: 'networkidle' });
    await interaction.locator('[data-cat="Patch Notes"]').click();
    if (await interaction.locator('[data-blog-category]:visible').count() !== 1) throw new Error('Blog category filter did not narrow the feed');
    await interaction.locator('[data-cat="all"]').click();
    await interaction.getByRole('textbox', { name: 'Search blog posts' }).fill('Vow Collar');
    if (await interaction.locator('[data-blog-category]:visible').count() !== 1) throw new Error('Blog search did not narrow the feed');
    await interaction.getByRole('textbox', { name: 'Search blog posts' }).fill('no matching post expected');
    if (await interaction.locator('[data-blog-category]:visible').count() !== 0 || !await interaction.locator('[data-blog-empty]').isVisible()) throw new Error('Blog empty state did not appear');
    await interaction.goto(`${baseUrl}/events.html`, { waitUntil: 'networkidle' });
    await interaction.locator('[data-filter="Tournament"]').click();
    if (await interaction.locator('[data-event-category]:visible').count() !== 1) throw new Error('Event category filter did not hide other categories');
    if (await interaction.locator('[data-event-counter]').innerText() !== 'Showing 1 of 4 events') throw new Error('Event count did not update');
    if (await interaction.locator('[data-filter="Tournament"]').getAttribute('aria-pressed') !== 'true') throw new Error('Event filter active state did not update');
    await interaction.locator('[data-filter="all"]').click();
    if (await interaction.locator('[data-event-category]:visible').count() !== 4) throw new Error('All-events filter did not restore events');
    await interaction.goto(`${baseUrl}/profile-gallery.html`, { waitUntil: 'networkidle' });
    await interaction.locator('.gallery-library-tile').first().click();
    await interaction.locator('#gallery-lightbox.active').waitFor();
    const firstCounter = await interaction.locator('#lightbox-counter').innerText();
    await interaction.locator('#lightbox-next').click();
    if (await interaction.locator('#lightbox-counter').innerText() === firstCounter) throw new Error('Gallery arrow did not change the photo');
    await interaction.keyboard.press('Escape');
    if (await interaction.locator('#gallery-lightbox').isVisible()) throw new Error('Lightbox did not close');
    await interaction.goto(`${baseUrl}/directory-editor.html`, { waitUntil: 'networkidle' });
    await interaction.locator('[data-editor-tab="tab-blog"]').click();
    await interaction.locator('[data-open-editor="blog"]').first().click();
    await interaction.locator('#modal-blog-content').fill('## Preview heading\n\n**Bold preview text**');
    await interaction.locator('[data-content-mode="preview"]').click();
    await interaction.locator('#modal-blog-preview-rendered h2').waitFor();
    if (await interaction.locator('#modal-blog-preview-rendered h2').innerText() !== 'Preview heading') throw new Error('Markdown preview did not render');
    await interaction.locator('[data-editor-tab="tab-gallery"]').first().click();
    await interaction.locator('#gallery-manager-card').waitFor({ state: 'visible' });
    if (viewport.width < 600) {
      await interaction.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
      await interaction.locator('#nav-toggle').click();
      if (await interaction.locator('#nav-toggle').getAttribute('aria-expanded') !== 'true') throw new Error('Mobile menu did not open');
      await interaction.keyboard.press('Escape');
    }
    await interaction.close();
    console.log(`Preview interactions ${viewport.width}: passed`);
    await context.close();
  }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(results, null, 2));
  if (results.some(result => result.differences.length || !result.backgroundMatches || !result.fontMatches || result.errors.length || (result.overflow && !result.referenceOverflow))) process.exitCode = 1;
} finally {
  await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
}
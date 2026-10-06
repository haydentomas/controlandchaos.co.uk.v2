import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

test('owner blog previews render saved and selected media, handle errors, and clear on access loss', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false }, logLevel: 'error' });
  let browser;
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (!route.request().url().startsWith(origin)) return route.abort();
      return route.continue();
    });
    await page.route('**/src/main.js', route => route.fulfill({ contentType: 'text/javascript', body: "import '/src/templates.css';" }));
    await page.route('**/src/modules/rich-text-editor.js', route => route.fulfill({
      contentType: 'text/javascript',
      body: 'export function initRichTextEditor() { return { destroy() {} }; } export function flushRichTextEditors() {}'
    }));
    await page.goto(`${origin}/directory-editor.html`);
    await page.evaluate(async origin => {
      const profile = { id: '33333333-3333-4333-8333-333333333333', creator_blog_monthly_linden: 1500 };
      const post = {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Private draft', post_type: 'post', access_level: 'subscribers',
        body_markdown: 'Private text', media_type: 'image', media_path: `${profile.id}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp`,
        media_url: '', is_published: false
      };
      const fixture = window.blogFixture = { profile, post, calls: [], fail: false, deferred: false, objectUrls: [], revoked: [] };
      const createObjectURL = URL.createObjectURL.bind(URL);
      const revokeObjectURL = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = blob => { const url = createObjectURL(blob); fixture.objectUrls.push(url); return url; };
      URL.revokeObjectURL = url => { fixture.revoked.push(url); revokeObjectURL(url); };
      const fieldset = document.createElement('fieldset');
      fieldset.id = 'blog-preview-fixture';
      fieldset.innerHTML = '<input id="test-price"><input id="test-benefits"><button id="test-add">Add</button><div id="test-posts"></div>';
      document.querySelector('main').replaceChildren(fieldset);
      const client = {
        rpc: async (name, args) => {
          if (name === 'creator_blog_editor_posts_v2') return { data: [fixture.post], error: null };
          if (name !== 'creator_blog_save_all_v2') throw new Error(`Unexpected RPC ${name}`);
          fixture.post = args.posts[0];
          fixture.calls.push(['save']);
          return { error: null };
        },
        storage: { from: bucket => ({
          createSignedUrl: async (path, expiry) => {
            fixture.calls.push(['sign', bucket, path, expiry]);
            if (fixture.deferred) await new Promise(resolve => { fixture.resolve = resolve; });
            return fixture.fail ? { error: { message: 'private provider detail' } } : { data: { signedUrl: `${origin}/images/products/shop-banner.png?fake-signed-preview=1` }, error: null };
          },
          upload: async (path, blob, options) => {
            fixture.calls.push(['upload', bucket, path, blob.type, options.contentType]);
            return { error: null };
          },
          remove: async () => ({ error: null })
        }) }
      };
      fixture.editor = (await import('/src/modules/creator-blog.js')).initCreatorBlogEditor(
        document.getElementById('test-posts'), document.getElementById('test-add'),
        document.getElementById('test-price'), document.getElementById('test-benefits')
      );
      fixture.load = () => fixture.editor.load(client, profile);
      await fixture.load();
    }, origin);
    assert.deepEqual(await page.evaluate(() => window.blogFixture.calls), []);
    const toggle = page.locator('[data-blog-post-toggle]');
    await toggle.click();
    let preview = page.locator('.creator-blog-editor-media-preview').first();
    await preview.locator('img').waitFor();
    await page.waitForFunction(() => {
      const image = document.querySelector('.creator-blog-editor-media-preview img');
      return image?.complete && image.naturalWidth > 0;
    });
    assert.deepEqual((await page.evaluate(() => window.blogFixture.calls))[0], [
      'sign', 'creator-blog-media', '33333333-3333-4333-8333-333333333333/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp', 300
    ]);
    assert.match(await preview.textContent(), /Private media preview/);
    assert.equal(await preview.locator('img').getAttribute('referrerpolicy'), 'no-referrer');
    assert.equal(await page.evaluate(() => {
      const image = document.querySelector('.creator-blog-editor-media-preview img');
      return image.getBoundingClientRect().width <= 390;
    }), true);
    const chooser = page.locator('#test-posts input[type="file"]');
    await chooser.setInputFiles(fileURLToPath(new URL('../public/images/products/shop-banner.png', import.meta.url)));
    const selectedPreview = page.locator('.creator-blog-editor-media-preview').nth(1);
    assert.match(await selectedPreview.textContent(), /Selected file preview/);
    assert.match(await selectedPreview.locator('img').getAttribute('src'), /^blob:/);
    await page.evaluate(() => window.blogFixture.editor.save());
    await page.evaluate(() => window.blogFixture.load());
    assert.equal(await page.evaluate(() => window.blogFixture.revoked.length), 1);
    await toggle.click();
    await preview.locator('img').waitFor();
    assert.match(await preview.locator('img').getAttribute('src'), /fake-signed-preview/);
    const calls = await page.evaluate(() => window.blogFixture.calls);
    assert.equal(calls.find(call => call[0] === 'upload')[3], 'image/webp');
    assert.equal(calls.find(call => call[0] === 'upload')[4], 'image/webp');
    assert.equal(await page.evaluate(() => window.blogFixture.post.is_published), false);
    assert.equal(await page.evaluate(() => window.blogFixture.post.attachments.length), 2);
    await page.getByRole('button', { name: 'Move attachment 2 up', exact: true }).click();
    await page.evaluate(() => window.blogFixture.editor.save());
    assert.notEqual(await page.evaluate(() => window.blogFixture.post.attachments[0].media_path), '33333333-3333-4333-8333-333333333333/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp');
    await page.getByRole('button', { name: 'Remove attachment 2', exact: true }).click();
    await page.evaluate(() => window.blogFixture.editor.save());
    assert.equal(await page.evaluate(() => window.blogFixture.post.attachments.length), 1);
    await page.locator('#test-posts input[type="file"]').setInputFiles(Array.from({ length: 9 }, (_, index) => ({
      name: `voice-${index}.mp3`, mimeType: 'audio/mpeg', buffer: Buffer.from('fake-audio')
    })));
    assert.equal(await page.locator('[data-blog-attachment]').count(), 10);
    await page.locator('#test-posts input[type="file"]').setInputFiles({ name: 'too-many.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('fake-audio') });
    assert.equal(await page.locator('[data-blog-attachment]').count(), 10);
    assert.match(await page.locator('.creator-blog-attachments').textContent(), /No files were added/);
    await page.evaluate(() => window.blogFixture.load());

    for (const type of ['audio', 'video']) {
      await page.evaluate(async type => {
        window.blogFixture.post.attachments = [{ ...window.blogFixture.post.attachments[0], media_type: type }];
        await window.blogFixture.load();
      }, type);
      await toggle.click();
      const media = preview.locator(type);
      await media.waitFor();
      assert.equal(await media.evaluate(node => node.controls && !node.autoplay && node.preload === 'none'), true);
    }
    await page.evaluate(async () => { window.blogFixture.post.attachments[0].media_type = 'image'; window.blogFixture.fail = true; await window.blogFixture.load(); });
    await toggle.click();
    await preview.getByRole('status').filter({ hasText: 'could not be loaded' }).waitFor();
    assert.equal(await preview.locator('img').count(), 0);
    assert.ok(!(await preview.textContent()).includes('private provider detail'));

    await page.evaluate(async () => { window.blogFixture.fail = false; await window.blogFixture.load(); });
    await toggle.click();
    await preview.locator('img').waitFor();
    await preview.locator('img').evaluate(node => node.dispatchEvent(new Event('error')));
    assert.match(await preview.textContent(), /could not be loaded/);
    assert.equal(await preview.locator('img').count(), 0);

    await page.evaluate(async () => { window.blogFixture.deferred = true; await window.blogFixture.load(); });
    await toggle.click();
    await page.waitForFunction(() => !!window.blogFixture.resolve);
    await page.evaluate(() => { window.blogFixture.editor.clear(); window.blogFixture.resolve(); });
    assert.equal(await page.locator('#test-posts img').count(), 0);
    assert.equal(await page.locator('#test-posts [data-blog-editor-post]').count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
});

test('public mixed posts use the existing image lightbox and never load subscriber-locked attachments', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false }, logLevel: 'error' });
  let browser;
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.route('**/src/main.js', route => route.fulfill({ contentType: 'text/javascript', body: "import '/src/templates.css';" }));
    await page.goto(`${origin}/directory-profile.html`);
    await page.evaluate(async origin => {
      const container = document.querySelector('[data-public-blog-feed]');
      container.closest('[role="tabpanel"]').hidden = false;
      container.closest('[role="tabpanel"]').classList.remove('preview-hidden');
      document.querySelector('[data-public-profile-content]').classList.remove('preview-hidden');
      const attachments = [
        { id: '1', media_type: 'image', media_url: `${origin}/images/products/shop-banner.png` },
        { id: '2', media_type: 'audio', media_path: 'audio-private-path' },
        { id: '3', media_type: 'image', media_path: 'image-private-path' },
        { id: '4', media_type: 'video', media_path: 'video-private-path' }
      ];
      const calls = window.signedMediaCalls = [];
      const client = { storage: { from: () => ({ createSignedUrl: async path => {
        calls.push(path);
        return { data: { signedUrl: `${origin}/images/products/shop-banner.png` }, error: null };
      } }) } };
      await (await import('/src/modules/creator-blog-feed.js')).renderCreatorBlogFeed(
        container, document.querySelector('[data-public-blog-status]'), client, { display_name: 'Example creator' }, null,
        [
          { id: 'public', title: 'Mixed media set', access_level: 'public', body_markdown: 'Text above the attachments.', attachments },
          { id: 'locked', title: 'Locked set', access_level: 'subscribers', is_locked: true, teaser: 'Public teaser', attachments: [{ media_type: 'image', media_path: 'never-sign-this' }] }
        ]
      );
      (await import('/src/modules/gallery.js')).initGallery();
    }, origin);
    assert.deepEqual(await page.evaluate(() => window.signedMediaCalls), ['audio-private-path','image-private-path','video-private-path']);
    assert.equal(await page.locator('[data-public-blog-feed] [data-photo]').count(), 2);
    assert.equal(await page.locator('.creator-blog-card.is-locked img').count(), 0);
    const tiles = page.locator('[data-public-blog-feed] [data-photo]');
    await tiles.first().click();
    assert.equal(await page.locator('#lightbox-counter').textContent(), '1 / 2');
    await page.locator('#lightbox-next').click();
    assert.equal(await page.locator('#lightbox-counter').textContent(), '2 / 2');
    await page.keyboard.press('Escape');
    assert.equal(await tiles.first().evaluate(node => node === document.activeElement), true);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('.creator-blog-post-media').evaluate(node => node.scrollWidth <= node.clientWidth), true);
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
});

test('attachment editing retains the real rich-text instance and pending body edits', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false }, logLevel: 'error' });
  let browser;
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.route('**/src/main.js', route => route.fulfill({ contentType: 'text/javascript', body: "import '/src/templates.css';" }));
    await page.goto(`${origin}/directory-editor.html`);
    await page.evaluate(async origin => {
      const profile = { id: '33333333-3333-4333-8333-333333333333', creator_blog_monthly_linden: 1500 };
      const post = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Rich draft', post_type: 'post', access_level: 'public', body_markdown: 'Initial text', attachments: [], is_published: false };
      const fixture = window.richBlogFixture = { saved: null };
      const fieldset = document.createElement('fieldset');
      fieldset.innerHTML = '<input id="rich-price"><input id="rich-benefits"><button id="rich-add"></button><div id="rich-posts"></div>';
      document.querySelector('main').replaceChildren(fieldset);
      const client = {
        rpc: async (name, args) => {
          if (name === 'creator_blog_editor_posts_v2') return { data: [post], error: null };
          fixture.saved = args;
          return { error: null };
        },
        storage: { from: () => ({
          upload: async () => ({ error: null }),
          createSignedUrl: async () => ({ data: { signedUrl: `${origin}/images/products/shop-banner.png` }, error: null })
        }) }
      };
      fixture.editor = (await import('/src/modules/creator-blog.js')).initCreatorBlogEditor(
        document.getElementById('rich-posts'), document.getElementById('rich-add'),
        document.getElementById('rich-price'), document.getElementById('rich-benefits')
      );
      await fixture.editor.load(client, profile);
    }, origin);
    await page.locator('[data-blog-post-toggle]').click();
    const surface = page.locator('.toastui-editor-ww-container .ProseMirror');
    await surface.waitFor();
    await surface.fill('Edited text survives attachment ordering');
    await page.evaluate(() => { window.originalBlogEditor = document.querySelector('.toastui-editor-defaultUI'); });
    await page.locator('input[type="file"]').setInputFiles(fileURLToPath(new URL('../public/images/products/shop-banner.png', import.meta.url)));
    await page.locator('input[type="file"]').setInputFiles({ name: 'voice.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('fake-audio') });
    await page.getByRole('button', { name: 'Move attachment 2 up', exact: true }).click();
    assert.equal(await page.evaluate(() => document.querySelector('.toastui-editor-defaultUI') === window.originalBlogEditor), true);
    await page.evaluate(() => window.richBlogFixture.editor.save());
    assert.equal(await page.evaluate(() => window.richBlogFixture.saved.posts[0].body_markdown), 'Edited text survives attachment ordering');
    assert.deepEqual(await page.evaluate(() => window.richBlogFixture.saved.posts[0].attachments.map(item => item.media_type)), ['audio','image']);
    await page.locator('[data-blog-post-toggle]').click();
    await page.locator('[data-blog-post-toggle]').click();
    assert.match(await surface.textContent(), /Edited text survives/);
    await page.getByRole('button', { name: 'Remove attachment 1', exact: true }).click();
    assert.equal(await page.evaluate(() => document.querySelector('.toastui-editor-defaultUI') === window.originalBlogEditor), true);
    await page.waitForFunction(() => document.querySelector('.creator-blog-editor-media-preview img')?.complete);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
});

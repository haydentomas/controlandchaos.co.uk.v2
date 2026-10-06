import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

test('standard editor links, modes and all profile fields persist through save/reload and public rendering', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false }, logLevel: 'error' });
  let browser;
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    const externalRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (!route.request().url().startsWith(origin)) { externalRequests.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    await page.route('**/src/main.js', route => route.fulfill({ contentType: 'text/javascript', body: "import '/src/templates.css';" }));
    const fixture = {
      row: {
        id: '33333333-3333-4333-8333-333333333333', slug: 'sample-profile', sl_username: 'sample.resident',
        display_name: 'Sample Creator', role_type: 'switch', headline: 'Headline', tagline: '**Tagline**',
        about: 'First paragraph.\n\nSecond paragraph.\n\n- One\n- Two', avatar_image: '', banner_image: '',
        starting_rate: 'L$100', availability: 'available', availability_note: 'Available today', tags: ['Example'],
        is_published: true, is_approved: true, boundaries: 'Respect limits.\n\n- Ask first\n- Confirm',
        booking_instructions: 'Contact me.\n\n1. Send a message\n2. Agree a time',
        rate_categories: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Consultations', description: '**Category** description', items: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Introduction', price: 'L$7,500+', unit: '30 minutes', description: '- Detail one\n- Detail two' }] }],
        booking_email: 'bookings@example.test',
        booking_hours: { timezone: 'Europe/London', days: ['sat'], start_time: '18:00', end_time: '22:00', slot_minutes: 60, notes: '**Advance notice**\n\nContact first.' }
      },
      photos: [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', title: 'Portrait', category: 'Portraits', description: '**Photo** description\n\n- Detail', image_url: '/images/shop-banner.png', is_published: true }]
    };
    const mountEditor = async data => {
      await page.goto(`${origin}/directory-editor.html`);
      await page.evaluate(async data => {
        window.fixture = structuredClone(data);
        window.saves = [];
        const client = {
          auth: { getUser: async () => ({ data: { user: { id: 'fake-owner' } } }), onAuthStateChange: callback => { window.notifyAuth = callback; return { data: { subscription: { unsubscribe() {} } } }; } },
          rpc(name, args) {
            if (name === 'my_directory_subscriptions') return Promise.resolve({ data: [{ profile_id: window.fixture.row.id, avatar_uuid: window.fixture.row.id, plan_code: 'basic_lifetime', is_active: true, is_lifetime: true }] });
            if (name === 'my_directory_booking_contact') return Promise.resolve({ data: window.fixture.row.booking_email || '', error: null });
            if (name !== 'save_directory_profile_booking') throw new Error(`Unexpected RPC ${name}`);
            return { maybeSingle: async () => {
              window.saves.push(structuredClone(args));
              Object.assign(window.fixture.row, args.profile_changes);
              window.fixture.row.booking_email = args.contact_email;
              window.fixture.photos = args.photos;
              return { data: structuredClone(window.fixture.row) };
            } };
          },
          from() {
            const chain = { select() { return chain; }, eq() { return chain; }, order() { return chain; }, maybeSingle: async () => ({ data: structuredClone(window.fixture.row) }), then(resolve, reject) { return Promise.resolve({ data: window.fixture.photos }).then(resolve, reject); } };
            return chain;
          }
        };
        await (await import('/src/modules/creator-editor.js')).initCreatorEditor(client);
      }, data);
      await page.waitForFunction(() => document.querySelectorAll('.toastui-editor-defaultUI').length === 8);
    };
    const field = selector => page.locator(selector).locator('..');
    const surface = group => group.locator('.toastui-editor-ww-container .ProseMirror');
    const mode = async (group, name) => group.locator('.toastui-editor-mode-switch').getByText(name, { exact: true }).click();
    const selectText = async (group, text) => {
      await surface(group).scrollIntoViewIfNeeded();
      const bounds = await surface(group).evaluate((element, text) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const start = node.textContent.indexOf(text);
          if (start < 0) continue;
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, start + text.length);
          const rect = range.getBoundingClientRect();
          return { left: rect.left, right: rect.right, y: rect.top + rect.height / 2 };
        }
        throw new Error(`Text not found: ${text}`);
      }, text);
      await page.mouse.move(bounds.left + 1, bounds.y);
      await page.mouse.down();
      await page.mouse.move(bounds.right - 1, bounds.y, { steps: 5 });
      await page.mouse.up();
      assert.equal(await page.evaluate(() => window.getSelection().toString()), text);
    };
    const openLinkDialog = async group => {
      if (!await group.locator('button.link:visible').count()) await group.locator('button.more').click();
      await group.locator('button.link:visible').click();
    };
    const applyLink = async (group, text, url, enter = false) => {
      await selectText(group, text);
      await openLinkDialog(group);
      const popup = group.locator('.toastui-editor-popup').filter({ has: page.locator('input[data-standard-link="url"]') });
      await popup.getByLabel('URL', { exact: true }).fill(url);
      await popup.getByLabel('Link text', { exact: true }).fill(text);
      if (enter) await popup.getByLabel('Link text', { exact: true }).press('Enter');
      else await popup.getByRole('button', { name: 'OK', exact: true }).click();
    };
    await mountEditor(fixture);
    const about = field('#creator-about');
    assert.equal(await page.locator('#creator-about').inputValue(), fixture.row.about);
    await mode(about, 'Markdown');
    await about.getByText('Preview', { exact: true }).click();
    assert.equal(await about.locator('.toastui-editor-md-preview li').count(), 2);
    await about.getByText('Write', { exact: true }).click();
    await mode(about, 'WYSIWYG');
    assert.equal(await page.locator('#creator-about').inputValue(), fixture.row.about);
    await selectText(about, 'First');
    await about.locator('button.bold').click();
    assert.match(await page.locator('#creator-about').inputValue(), /\*\*First\*\*/);
    await surface(about).focus();
    await page.keyboard.press('Control+z');
    assert.doesNotMatch(await page.locator('#creator-about').inputValue(), /\*\*First\*\*/);
    await page.keyboard.press('Control+Shift+z');
    assert.match(await page.locator('#creator-about').inputValue(), /\*\*First\*\*/);
    await applyLink(about, 'Second', 'https://example.com/about');
    assert.equal(await surface(about).locator('a').getAttribute('href'), 'https://example.com/about');
    assert.match(await page.locator('#creator-about').inputValue(), /\[Second\]\(https:\/\/example.com\/about\)/);
    const instructions = field('#creator-booking-instructions');
    await applyLink(instructions, 'Contact', 'javascript:alert(1)');
    assert.match(await instructions.locator('.rich-text-status').textContent(), /valid HTTP/);
    assert.equal(await surface(instructions).locator('a').count(), 0);
    await instructions.locator('.toastui-editor-popup').getByRole('button', { name: 'Cancel', exact: true }).click();
    await applyLink(instructions, 'Contact', 'https://example.com/book');
    assert.equal(await surface(instructions).locator('a').getAttribute('href'), 'https://example.com/book');
    const notes = field('[data-booking-notes]');
    await applyLink(notes, 'Advance notice', 'https://example.com/notice', true);
    assert.equal(await page.evaluate(() => window.saves.length), 0);
    assert.match(await page.locator('[data-booking-notes]').inputValue(), /https:\/\/example.com\/notice/);
    await page.locator('[data-booking-enabled]').uncheck();
    await page.waitForFunction(() => document.querySelector('[data-booking-notes]').closest('.rich-text-editor').querySelector('.standard-text-editor').inert);
    assert.equal(await surface(notes).getAttribute('contenteditable'), 'false');
    await page.locator('[data-booking-enabled]').check();
    await page.waitForFunction(() => !document.querySelector('[data-booking-notes]').closest('.rich-text-editor').querySelector('.standard-text-editor').inert);
    const photo = field('[data-gallery-editor] textarea[data-rich-text-source]');
    await selectText(photo, 'description');
    await photo.locator('button.bold').click();
    const service = page.locator('[data-rate-item] .rich-text-editor');
    await selectText(service, 'Detail one');
    await service.locator('button.bold').click();
    fixture.photos[0].description = await photo.locator('textarea[data-rich-text-source]').inputValue();
    fixture.row.rate_categories[0].items[0].description = await service.locator('textarea[data-rich-text-source]').inputValue();
    fixture.row.booking_hours.notes = await notes.locator('textarea[data-rich-text-source]').inputValue();
    const boundaries = field('#creator-boundaries');
    const original = await boundaries.locator('textarea[data-rich-text-source]').inputValue();
    await mode(boundaries, 'Markdown');
    const markdown = boundaries.locator('.toastui-editor-md-container .ProseMirror');
    await markdown.fill('x'.repeat(4001));
    await page.locator('[data-creator-save]').click();
    assert.equal(await page.evaluate(() => window.saves.length), 0);
    assert.match(await boundaries.locator('.rich-text-status').textContent(), /shorten/);
    await markdown.fill('x'.repeat(4000));
    assert.equal((await boundaries.locator('textarea[data-rich-text-source]').inputValue()).length, 4000);
    await markdown.fill(original);
    await page.locator('[data-creator-save]').click();
    await page.waitForFunction(() => document.querySelector('[data-creator-status]').textContent === 'Profile saved.');
    const saved = await page.evaluate(() => ({ fixture: window.fixture, args: window.saves.at(-1) }));
    assert.deepEqual(saved.args.photos, fixture.photos);
    assert.deepEqual(saved.args.profile_changes.rate_categories, fixture.row.rate_categories);
    assert.deepEqual(saved.args.profile_changes.booking_hours, fixture.row.booking_hours);
    assert.equal(saved.args.profile_changes.headline, fixture.row.headline);
    assert.equal(saved.args.contact_email, 'bookings@example.test');
    await mountEditor(saved.fixture);
    assert.match(await page.locator('#creator-about').inputValue(), /https:\/\/example.com\/about/);
    assert.match(await page.locator('#creator-booking-instructions').inputValue(), /https:\/\/example.com\/book/);
    await page.setViewportSize({ width: 390, height: 844 });
    await mountEditor(saved.fixture);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await applyLink(field('#creator-about'), 'Second', 'https://example.com/mobile');
    assert.equal(await surface(field('#creator-about')).locator('a').getAttribute('href'), 'https://example.com/mobile');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await mode(field('#creator-about'), 'Markdown');
    await field('#creator-about').getByText('Write', { exact: true }).click();
    await openLinkDialog(field('#creator-about'));
    const sourcePopup = field('#creator-about').locator('.toastui-editor-popup');
    await sourcePopup.getByLabel('URL', { exact: true }).fill('https://example.com/source');
    await sourcePopup.getByLabel('Link text', { exact: true }).fill('Source link');
    await sourcePopup.getByRole('button', { name: 'OK', exact: true }).click();
    assert.match(await page.locator('#creator-about').inputValue(), /\[Source link\]\(https:\/\/example.com\/source\)/);
    const unsafeFixture = structuredClone(saved.fixture);
    unsafeFixture.row.about = '<script>window.unsafeExecuted=true</script>\n\n![Alt](https://example.com/image.jpg)';
    await mountEditor(unsafeFixture);
    const unsafeAbout = field('#creator-about');
    assert.equal(await page.locator('#creator-about').inputValue(), unsafeFixture.row.about);
    await mode(unsafeAbout, 'WYSIWYG');
    assert.match(await unsafeAbout.locator('.rich-text-status').textContent(), /source has not been changed/);
    assert.equal(await page.locator('#creator-about').inputValue(), unsafeFixture.row.about);
    await unsafeAbout.getByText('Preview', { exact: true }).click();
    assert.equal(await unsafeAbout.locator('.toastui-editor-md-preview script, .toastui-editor-md-preview img').count(), 0);
    assert.match(await unsafeAbout.locator('.toastui-editor-md-preview').textContent(), /<script>/);
    assert.equal(await page.evaluate(() => window.unsafeExecuted), undefined);
    await page.evaluate(() => window.notifyAuth('SIGNED_OUT'));
    assert.equal(await page.locator('[data-live-profile-form]').isVisible(), false);
    await page.goto(`${origin}/directory-profile.html?slug=sample-profile`);
    await page.evaluate(async data => {
      const client = { from() {
        const chain = { select() { return chain; }, eq() { return chain; }, order() { return chain; }, maybeSingle: async () => ({ data: data.row }), then(resolve, reject) { return Promise.resolve({ data: data.photos }).then(resolve, reject); } };
        return chain;
      } };
      await (await import('/src/modules/directory-profile.js')).initDirectoryProfile(client);
      (await import('/src/modules/gallery.js')).initGallery();
    }, saved.fixture);
    assert.equal(await page.locator('[data-public-profile-about] strong').textContent(), 'First');
    assert.equal(await page.locator('[data-public-profile-about] a').getAttribute('href'), 'https://example.com/about');
    assert.equal(await page.locator('[data-public-profile-instructions] a').getAttribute('href'), 'https://example.com/book');
    assert.equal(await page.locator('[data-public-profile-boundaries] li').count(), 2);
    assert.equal(await page.locator('[data-public-profile-instructions] li').count(), 2);
    assert.equal(await page.locator('[data-public-profile-tagline] strong').textContent(), 'Tagline');
    assert.equal(await page.locator('.public-rate-category > .rich-text-content strong').textContent(), 'Category');
    assert.equal(await page.locator('.public-rate-item li').count(), 2);
    assert.equal(await page.locator('[data-public-profile-hours] a').getAttribute('href'), 'https://example.com/notice');
    await page.locator('.service-select-toggle').click();
    assert.equal(await page.locator('[name="selected_services"]').inputValue(), '["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]');
    const expectedBookingMessage = [
      'Hello Sample Creator,',
      '',
      'I would like to request a booking/session for the following services:',
      '  \u2022 Introduction (Consultations \u2014 L7,500)',
      '',
      'Estimated Total: L7,500 (~30)',
      '',
      'Session Preferences & Notes:',
      '[Please specify your scenario, preferences, or timing details here]'
    ].join('\n');
    assert.equal(await page.locator('[name="message"]').inputValue(), expectedBookingMessage);
    await page.locator('.service-select-toggle').click();
    assert.equal(await page.locator('[name="message"]').inputValue(), '');
    await page.locator('[data-public-gallery-preview] [data-photo]').click();
    assert.equal(await page.locator('#lightbox-description li').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests.filter(url => !url.startsWith('https://fonts.googleapis.com/')), []);
    const fallback = await browser.newPage();
    await fallback.route('**/src/main.js', route => route.fulfill({ contentType: 'text/javascript', body: "import '/src/templates.css';" }));
    await fallback.route('**/*', route => {
      if (route.request().url().includes('@toast-ui')) return route.abort();
      return route.fallback();
    });
    await fallback.goto(`${origin}/directory-editor.html`);
    await fallback.evaluate(async () => {
      document.querySelector('[data-live-profile-form]').classList.remove('preview-hidden');
      document.querySelector('[data-creator-fields]').disabled = false;
      const input = document.querySelector('#creator-about');
      input.value = 'Retain this Markdown.\n\n- Item';
      (await import('/src/modules/rich-text-editor.js')).initRichTextEditor(input);
    });
    await fallback.waitForFunction(() => document.querySelector('#creator-about').closest('.rich-text-editor').querySelector('[role=status]').textContent.includes('could not be loaded'));
    assert.equal(await fallback.locator('#creator-about').inputValue(), 'Retain this Markdown.\n\n- Item');
    assert.equal(await fallback.locator('#creator-about').isVisible(), true);
    await fallback.locator('#creator-about').fill('Still editable after the loading failure.');
    assert.equal(await fallback.locator('#creator-about').inputValue(), 'Still editable after the loading failure.');
    await fallback.close();
  } finally {
    await browser?.close();
    await server.close();
  }
});

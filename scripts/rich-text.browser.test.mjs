import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

test('visual/Markdown studio saves, reloads and renders all long-form fields without touching live data', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false }, logLevel: 'error' });
  let browser;
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/src/main.js', route => route.fulfill({ contentType: 'text/javascript', body: "import '/src/templates.css';" }));
    await page.goto(`${origin}/directory-editor.html`);
    const fixture = {
      row: {
        id: '33333333-3333-4333-8333-333333333333', slug: 'sample-profile', sl_username: 'sample.resident',
        display_name: 'Sample Creator', role_type: 'switch', headline: 'Headline', tagline: '**Tagline**',
        about: 'First paragraph.\n\nSecond paragraph.\n\n- One\n- Two', avatar_image: '', banner_image: '',
        starting_rate: 'L$100', availability: 'available', availability_note: 'Available today', tags: ['Example'],
        is_published: true, is_approved: true, boundaries: 'Respect limits.\n\n- Ask first\n- Confirm',
        booking_instructions: 'Contact me.\n\n1. Send a message\n2. Agree a time',
        rate_categories: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Consultations', description: '**Category** description', items: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Introduction', price: 'L$100', unit: '30 minutes', description: '- Detail one\n- Detail two' }] }],
        booking_hours: { timezone: 'Europe/London', days: ['sat'], start_time: '18:00', end_time: '22:00', slot_minutes: 60, notes: '**Advance notice**\n\nContact first.' }
      },
      photos: [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', title: 'Portrait', category: 'Portraits', description: '**Photo** description\n\n- Detail', image_url: '/images/shop-banner.png', is_published: true }]
    };
    const mountEditor = async data => page.evaluate(async data => {
      window.fixture = structuredClone(data);
      window.saves = [];
      const client = {
        auth: { getUser: async () => ({ data: { user: { id: 'fake-owner' } } }), onAuthStateChange: callback => { window.notifyAuth = callback; return { data: { subscription: { unsubscribe() {} } } }; } },
        rpc(name, args) {
          if (name === 'my_directory_subscriptions') return Promise.resolve({ data: [{ profile_id: window.fixture.row.id, avatar_uuid: window.fixture.row.id, plan_code: 'basic_lifetime', is_active: true, is_lifetime: true }] });
          if (name !== 'save_directory_profile_media') throw new Error(`Unexpected RPC ${name}`);
          return { maybeSingle: async () => {
            window.saves.push(structuredClone(args));
            Object.assign(window.fixture.row, args.profile_changes);
            window.fixture.photos = args.photos;
            return { data: structuredClone(window.fixture.row) };
          } };
        },
        from(name) {
          const chain = { select() { return chain; }, eq() { return chain; }, order() { return chain; }, maybeSingle: async () => ({ data: structuredClone(window.fixture.row) }), then(resolve, reject) { return Promise.resolve({ data: window.fixture.photos }).then(resolve, reject); } };
          if (!['directory_profiles', 'directory_gallery_photos'].includes(name)) throw new Error(name);
          return chain;
        }
      };
      const { initCreatorEditor } = await import('/src/modules/creator-editor.js');
      await initCreatorEditor(client);
    }, data);
    await mountEditor(fixture);
    assert.equal(await page.locator('.rich-text-editor').count(), 8);
    const about = page.locator('#creator-about').locator('..');
    await about.getByRole('button', { name: 'Visual', exact: true }).click();
    await about.locator('.tiptap').waitFor({ state: 'visible' });
    await about.locator('.tiptap').waitFor();
    assert.equal(await page.locator('#creator-about').inputValue(), fixture.row.about);
    assert.equal(await about.locator('.tiptap > p').count(), 2);
    assert.equal(await about.locator('.tiptap li').count(), 2);
    await about.locator('.tiptap').evaluate(element => {
      const text = element.querySelector('p').firstChild;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 5);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await about.getByRole('button', { name: 'Bold', exact: true }).click();
    assert.match(await page.locator('#creator-about').inputValue(), /\*\*First\*\*/);
    await about.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.doesNotMatch(await page.locator('#creator-about').inputValue(), /\*\*First\*\*/);
    await about.getByRole('button', { name: 'Redo', exact: true }).click();
    assert.match(await page.locator('#creator-about').inputValue(), /\*\*First\*\*/);
    await about.getByRole('button', { name: 'Markdown', exact: true }).click();
    await about.getByRole('button', { name: 'Preview', exact: true }).click();
    assert.equal(await about.locator('.rich-text-preview strong').textContent(), 'First');
    await about.getByRole('button', { name: 'Visual', exact: true }).click();
    const boundaries = page.locator('#creator-boundaries').locator('..');
    await page.locator('#creator-boundaries').fill('Paragraph one.\n\nParagraph two.\n\n- First\n- Second');
    assert.equal(await page.locator('#creator-boundaries').inputValue(), 'Paragraph one.\n\nParagraph two.\n\n- First\n- Second');
    await boundaries.getByRole('button', { name: 'Preview', exact: true }).click();
    assert.equal(await boundaries.locator('.rich-text-preview > p').count(), 2);
    assert.equal(await boundaries.locator('.rich-text-preview li').count(), 2);
    const instructions = page.locator('#creator-booking-instructions').locator('..');
    await page.locator('#creator-booking-instructions').fill('<b>Retain literal text</b>');
    await instructions.getByRole('button', { name: 'Visual', exact: true }).click();
    assert.equal(await instructions.getAttribute('data-mode'), 'markdown');
    assert.match(await instructions.locator('.rich-text-status').textContent(), /source has not been changed/);
    assert.equal(await page.locator('#creator-booking-instructions').inputValue(), '<b>Retain literal text</b>');
    await page.locator('#creator-booking-instructions').fill(fixture.row.booking_instructions);
    const photoSource = page.locator('[data-gallery-editor] textarea');
    const photoEditor = page.locator('[data-gallery-editor] .rich-text-editor');
    await photoEditor.getByRole('button', { name: 'Visual', exact: true }).click();
    await photoEditor.locator('.tiptap').waitFor();
    await photoEditor.locator('.tiptap').fill('Updated photo description');
    fixture.photos[0].description = '**Updated photo description**';
    assert.equal(await photoSource.inputValue(), fixture.photos[0].description);
    await photoEditor.getByRole('button', { name: 'Markdown', exact: true }).click();
    await photoSource.fill('**Photo** description\n\n- Detail');
    fixture.photos[0].description = '**Photo** description\n\n- Detail';
    const serviceEditor = page.locator('[data-rate-item] .rich-text-editor');
    await serviceEditor.getByRole('button', { name: 'Visual', exact: true }).click();
    await serviceEditor.locator('.tiptap').waitFor();
    await serviceEditor.locator('.tiptap p').first().evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await serviceEditor.getByRole('button', { name: 'Bold', exact: true }).click();
    assert.match(await serviceEditor.locator('textarea').inputValue(), /\*\*Detail one\*\*/);
    fixture.row.rate_categories[0].items[0].description = await serviceEditor.locator('textarea').inputValue();
    const notes = page.locator('[data-booking-notes]').locator('..');
    await notes.getByRole('button', { name: 'Visual', exact: true }).click();
    await notes.locator('.tiptap').waitFor();
    await page.locator('[data-booking-enabled]').uncheck();
    await page.waitForFunction(() => document.querySelector('[data-booking-notes]').closest('.rich-text-editor').querySelector('.tiptap').getAttribute('contenteditable') === 'false');
    await page.locator('[data-booking-enabled]').check();
    await page.waitForFunction(() => document.querySelector('[data-booking-notes]').closest('.rich-text-editor').querySelector('.tiptap').getAttribute('contenteditable') === 'true');
    await page.locator('#creator-booking-instructions').fill('Link text');
    await page.locator('#creator-booking-instructions').evaluate(element => element.setSelectionRange(0, 4));
    await instructions.getByRole('button', { name: 'Bold', exact: true }).click();
    assert.equal(await page.locator('#creator-booking-instructions').inputValue(), '**Link** text');
    await instructions.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal(await page.locator('#creator-booking-instructions').inputValue(), 'Link text');
    await instructions.getByRole('button', { name: 'Redo', exact: true }).click();
    assert.equal(await page.locator('#creator-booking-instructions').inputValue(), '**Link** text');
    await instructions.getByRole('button', { name: 'Link', exact: true }).click();
    await instructions.getByRole('textbox', { name: 'Link URL' }).fill('javascript:alert(1)');
    await instructions.getByRole('button', { name: 'Apply link', exact: true }).click();
    assert.match(await instructions.locator('.rich-text-link-panel [role=status]').textContent(), /valid HTTP/);
    await instructions.getByRole('button', { name: 'Cancel link', exact: true }).click();
    await page.locator('#creator-booking-instructions').fill(fixture.row.booking_instructions);
    const boundarySource = await page.locator('#creator-boundaries').inputValue();
    await boundaries.getByRole('button', { name: 'Markdown', exact: true }).click();
    await page.locator('#creator-boundaries').fill('x'.repeat(4000));
    await page.locator('#creator-boundaries').evaluate(element => element.setSelectionRange(0, 1));
    await boundaries.getByRole('button', { name: 'Bold', exact: true }).click();
    assert.match(await boundaries.locator('.rich-text-status').textContent(), /exceed 4000/);
    assert.equal((await page.locator('#creator-boundaries').inputValue()).length, 4000);
    await page.locator('#creator-boundaries').evaluate(element => { element.value = 'x'.repeat(4001); element.dispatchEvent(new Event('input', { bubbles: true })); });
    await boundaries.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.locator('[data-creator-save]').click();
    assert.equal(await page.evaluate(() => window.saves.length), 0);
    assert.equal(await boundaries.getAttribute('data-mode'), 'markdown');
    await page.locator('#creator-boundaries').fill(boundarySource);
    await page.locator('[data-creator-save]').click();
    await page.waitForFunction(() => document.querySelector('[data-creator-status]').textContent === 'Profile saved.');
    let saved = await page.evaluate(() => ({ fixture: window.fixture, args: window.saves.at(-1) }));
    assert.deepEqual(saved.args.photos, fixture.photos);
    assert.deepEqual(saved.args.profile_changes.rate_categories, fixture.row.rate_categories);
    assert.deepEqual(saved.args.profile_changes.booking_hours, fixture.row.booking_hours);
    assert.equal(saved.args.profile_changes.headline, fixture.row.headline);
    await page.reload();
    await mountEditor(saved.fixture);
    assert.match(await page.locator('#creator-about').inputValue(), /\*\*First\*\*/);
    assert.equal(await page.locator('#creator-boundaries').inputValue(), saved.args.profile_changes.boundaries);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.evaluate(() => window.notifyAuth('SIGNED_OUT'));
    assert.equal(await page.locator('[data-live-profile-form]').isVisible(), false);
    await page.goto(`${origin}/directory-profile.html?slug=sample-profile`);
    await page.evaluate(async data => {
      const client = { from(name) {
        const chain = { select() { return chain; }, eq() { return chain; }, order() { return chain; }, maybeSingle: async () => ({ data: data.row }), then(resolve, reject) { return Promise.resolve({ data: data.photos }).then(resolve, reject); } };
        return chain;
      } };
      await (await import('/src/modules/directory-profile.js')).initDirectoryProfile(client);
      (await import('/src/modules/gallery.js')).initGallery();
    }, saved.fixture);
    assert.equal(await page.locator('[data-public-profile-about] strong').textContent(), 'First');
    assert.equal(await page.locator('[data-public-profile-boundaries] li').count(), 2);
    assert.equal(await page.locator('[data-public-profile-instructions] ol > li').count(), 2);
    assert.equal(await page.locator('[data-public-profile-tagline] strong').textContent(), 'Tagline');
    assert.equal(await page.locator('.public-rate-category > .rich-text-content strong').textContent(), 'Category');
    assert.equal(await page.locator('.public-rate-item li').count(), 2);
    assert.equal(await page.locator('[data-public-profile-hours] strong').textContent(), 'Advance notice');
    await page.locator('[data-public-gallery-preview] [data-photo]').click();
    assert.equal(await page.locator('#lightbox-description strong').textContent(), 'Photo');
    assert.equal(await page.locator('#lightbox-description li').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({ width: 1440, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});

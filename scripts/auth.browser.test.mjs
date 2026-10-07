import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

test('account settings let terminal-authenticated users set a verified web password without emails', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false }, logLevel: 'error' });
  let browser;
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    const external = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (!route.request().url().startsWith(origin)) { external.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    await page.route('**/src/main.js', route => route.fulfill({ contentType: 'text/javascript', body: "import '/src/templates.css';" }));
    await page.goto(`${origin}/auth.html`);
    await page.evaluate(async () => {
      const user = { id: 'test-owner', email: 'owner@example.test', email_confirmed_at: '2026-10-04T00:00:00Z' };
      window.authFixture = { user, calls: [], error: null, callbacks: [], adminAccess: true };
      const fixture = window.authFixture;
      const client = {
        auth: {
          getSession: async () => ({ data: { session: fixture.user ? {} : null } }),
          getUser: async () => ({ data: { user: fixture.user } }),
          onAuthStateChange: callback => {
            fixture.callbacks.push(callback);
            return { data: { subscription: { unsubscribe() {} } } };
          },
          updateUser: async payload => {
            fixture.calls.push(['update', payload]);
            fixture.callbacks.forEach(callback => callback('USER_UPDATED'));
            return { error: fixture.error };
          },
          signOut: async () => {
            fixture.calls.push(['account-signout']);
            fixture.user = null;
            fixture.callbacks.forEach(callback => callback('SIGNED_OUT'));
            return { error: null };
          }
        },
        rpc: async name => {
          if (name === 'my_directory_admin_access') return { data: fixture.adminAccess, error: null };
          if (!['my_directory_subscriptions', 'my_verified_avatars'].includes(name)) throw new Error(`Unexpected RPC: ${name}`);
          return { data: [], error: null };
        }
      };
      const verifier = { auth: {
        signInWithPassword: async payload => {
          fixture.calls.push(['verify', payload]);
          return { data: { user, session: {} }, error: null };
        },
        signOut: async options => { fixture.calls.push(['verification-signout', options]); return { error: null }; }
      } };
      await (await import('/src/modules/auth.js')).initAuth(client, () => verifier);
    });
    assert.equal(await page.getByRole('link', { name: 'Superadmin' }).isVisible(), true);
    const change = page.getByRole('button', { name: 'Set or change web password' });
    await change.click();
    await page.locator('#account-password').fill('fake-browser-password');
    await page.locator('#account-confirm').fill('wrong-confirmation');
    await page.getByRole('button', { name: 'Update password', exact: true }).click();
    assert.match(await page.locator('[data-account-status]').textContent(), /do not match/);
    assert.deepEqual(await page.evaluate(() => window.authFixture.calls), []);
    await page.locator('#account-confirm').fill('fake-browser-password');
    await page.getByRole('button', { name: 'Update password', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Password updated and web sign-in verified' }).waitFor();
    assert.equal(await page.locator('[data-account-form-container]').isVisible(), false);
    assert.equal(await page.locator('[data-account-session]').isVisible(), true);
    assert.equal(await page.locator('#account-password').inputValue(), '');
    assert.equal(await page.locator('#account-confirm').inputValue(), '');
    assert.deepEqual(await page.evaluate(() => window.authFixture.calls), [
      ['update', { password: 'fake-browser-password' }],
      ['verify', { email: 'owner@example.test', password: 'fake-browser-password' }],
      ['verification-signout', { scope: 'local' }]
    ]);
    await change.click();
    await page.locator('#account-password').fill('fake-browser-password');
    await page.getByRole('button', { name: 'Cancel password change' }).click();
    assert.equal(await page.locator('#account-password').inputValue(), '');
    assert.equal(await page.locator('[data-account-form-container]').isVisible(), false);

    await page.evaluate(() => { window.authFixture.error = { code: 'reauthentication_needed', message: 'private details' }; });
    await change.click();
    await page.locator('#account-password').fill('fake-browser-password');
    await page.locator('#account-confirm').fill('fake-browser-password');
    await page.getByRole('button', { name: 'Update password', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'fresh authentication' }).waitFor();
    assert.equal(await page.locator('[data-account-form-container]').isVisible(), true);
    assert.equal(await page.locator('#account-password').inputValue(), '');
    assert.ok(!(await page.locator('[data-account-status]').textContent()).includes('private details'));

    await page.getByRole('button', { name: 'Cancel password change' }).click();
    await page.evaluate(() => {
      window.authFixture.error = null;
      window.authFixture.callbacks.forEach(callback => callback('PASSWORD_RECOVERY'));
    });
    await page.getByRole('button', { name: 'Update password', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Cancel password change' }).isVisible(), false);
    await page.locator('#account-password').fill('fake-recovery-password');
    await page.locator('#account-confirm').fill('fake-recovery-password');
    await page.getByRole('button', { name: 'Update password', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Password updated and web sign-in verified' }).waitFor();
    assert.equal(await page.locator('[data-account-session]').isVisible(), false);
    assert.equal(await page.getByRole('button', { name: 'Sign in', exact: true }).count(), 1);
    assert.ok(external.every(url => new URL(url).hostname === 'fonts.googleapis.com'));
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
});

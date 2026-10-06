import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { renderPage } from './render-templates.mjs';
import { accountLinkMessage, accountRequestMessage, authenticate, authRedirect, AUTH_STORAGE_KEY, callbackState, createCreatorClient, exchangeAuthCallback, exchangeTerminalLogin, setWebPassword } from '../src/modules/auth-api.js';
import { createPublicDirectoryClient } from '../src/modules/directory-api.js';

test('creator sessions use PKCE and separate storage while public directory remains anonymous', async () => {
  const config = { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test_only' };
  const creator = createCreatorClient(config, { auth: { autoRefreshToken: false } });
  const directory = createPublicDirectoryClient(config);
  assert.equal(creator.auth.flowType, 'pkce');
  assert.equal(creator.auth.storageKey, AUTH_STORAGE_KEY);
  assert.equal(creator.auth.persistSession, true);
  assert.equal(creator.auth.detectSessionInUrl, false);
  assert.equal(directory.auth.persistSession, false);
  assert.notEqual(creator.auth.storageKey, directory.auth.storageKey);
  await creator.auth.stopAutoRefresh();
});

test('account page uses real form hooks and suppresses callback referrers', async () => {
  const { document } = parseHTML(await renderPage('auth.html'));
  assert.ok(document.querySelector('form[data-live-auth-form]'));
  assert.equal(document.querySelector('meta[name="referrer"]').getAttribute('content'), 'no-referrer');
  assert.equal(document.querySelector('#account-password').getAttribute('type'), 'password');
  assert.equal(document.querySelectorAll('[data-account-mode]').length, 3);
  assert.ok(document.querySelector('[data-account-session] [data-account-change-password]'));
  assert.equal(document.querySelector('[data-account-cancel-password]').getAttribute('type'), 'button');
  const handlers = await fs.readFile(new URL('../src/modules/preview-actions.js', import.meta.url), 'utf8');
  assert.match(handlers, /form:not\(\[data-live-auth-form\]\)/);
});

test('signed-in web password setting verifies the server identity and password without profile writes', async () => {
  const calls = [];
  const user = { id: 'owner', email: 'owner@example.test', email_confirmed_at: '2026-10-04T00:00:00Z' };
  const client = { auth: {
    getUser: async () => { calls.push('getUser'); return { data: { user }, error: null }; },
    updateUser: async payload => { calls.push(['update', payload]); return { error: null }; }
  } };
  const verifier = { auth: {
    signInWithPassword: async payload => { calls.push(['verify', payload]); return { data: { user, session: {} }, error: null }; },
    signOut: async options => { calls.push(['signout', options]); return { error: null }; }
  } };
  const request = { password: 'test-password-long', confirmation: 'test-password-long' };
  assert.equal(await setWebPassword(client, request, () => verifier), user.email);
  assert.deepEqual(calls, ['getUser', ['update', { password: request.password }], ['verify', { email: user.email, password: request.password }], ['signout', { scope: 'local' }]]);
  await assert.rejects(setWebPassword(client, { ...request, confirmation: 'mismatch' }, () => verifier), /do not match/);
  await assert.rejects(setWebPassword(client, { password: 'short', confirmation: 'short' }, () => verifier), /12 characters/);
  const count = calls.length;
  await assert.rejects(setWebPassword({ auth: { getUser: async () => ({ data: { user: { ...user, email_confirmed_at: null } } }) } }, request, () => verifier), /email-confirmed/);
  assert.equal(calls.length, count);
});

test('password-setting failures distinguish rejected updates from unverified updates', async () => {
  const user = { id: 'owner', email: 'owner@example.test', email_confirmed_at: '2026-10-04T00:00:00Z' };
  const request = { password: 'test-password-long', confirmation: 'test-password-long' };
  for (const [code, expected] of [['reauthentication_needed', /fresh authentication/], ['weak_password', /stronger/], ['same_password', /different/], ['unexpected', /was not changed/]]) {
    const client = { auth: { getUser: async () => ({ data: { user } }), updateUser: async () => ({ error: { code, message: 'private provider details' } }) } };
    await assert.rejects(setWebPassword(client, request, () => ({})), error => expected.test(error.message) && !error.message.includes('private provider'));
  }
  let signedOut = false;
  const client = { auth: { getUser: async () => ({ data: { user } }), updateUser: async () => ({ error: null }) } };
  const verifier = { auth: {
    signInWithPassword: async () => ({ data: {}, error: { code: 'invalid_credentials' } }),
    signOut: async () => { signedOut = true; return { error: null }; }
  } };
  await assert.rejects(setWebPassword(client, request, () => verifier), /Password updated, but normal web sign-in could not be verified/);
  assert.equal(signedOut, true);
});

test('account redirects accept only configured exact local/staging addresses', () => {
  assert.equal(authRedirect('http://127.0.0.1:4182/auth.html?next=https://unsafe.test'), 'http://127.0.0.1:4182/auth.html');
  assert.equal(authRedirect('https://controlandchaosv2.netlify.app/auth.html'), 'https://controlandchaosv2.netlify.app/auth.html');
  assert.throws(() => authRedirect('https://unsafe.test/auth.html'));
  const preview = 'https://feature-creator-blog-pass-through-20261006--controlandchaosv2.netlify.app';
  assert.equal(authRedirect(`${preview}/directory-editor.html?next=https://unsafe.test`), `${preview}/auth.html`);
  assert.throws(() => authRedirect(preview.replace('https:', 'http:')));
  assert.throws(() => authRedirect(`${preview}:444/auth.html`));
  assert.throws(() => authRedirect('https://unapproved--controlandchaosv2.netlify.app/auth.html'));
  assert.throws(() => authRedirect(`${preview}.unsafe.test/auth.html`));
  assert.throws(() => authRedirect('http://localhost:9999/auth.html'));
  assert.notEqual(AUTH_STORAGE_KEY, 'sb-example-auth-token');
});

test('callback parsing strips codes, errors and fragments rather than following arbitrary next URLs', () => {
  const result = callbackState('http://127.0.0.1:4182/auth.html?code=test-code&next=https://unsafe.test#access_token=do-not-render');
  assert.equal(result.code, 'test-code');
  assert.equal(result.unsupportedToken, true);
  assert.equal(result.cleanUrl, 'http://127.0.0.1:4182/auth.html');
  assert.equal(callbackState('http://127.0.0.1:4182/auth.html#error=expired').error, true);
});

test('PKCE flow ID survives URL cleanup and is passed explicitly to session exchange', async () => {
  const callback = callbackState('http://127.0.0.1:4182/auth.html?code=fake-code&sb_flow_id=test-flow-id');
  assert.equal(callback.flowId, 'test-flow-id');
  assert.equal(callback.cleanUrl, 'http://127.0.0.1:4182/auth.html');
  let exchange;
  const client = { auth: { exchangeCodeForSession: async (code, options) => { exchange = { code, options }; return { error: null }; } } };
  await exchangeAuthCallback(client, callback);
  assert.deepEqual(exchange, { code: 'fake-code', options: { flowId: 'test-flow-id' } });
  assert.match(accountLinkMessage(callbackState('http://127.0.0.1:4182/auth.html#error_code=otp_expired&error_description=private')), /already used/);
  assert.ok(!accountLinkMessage(callbackState('http://127.0.0.1:4182/auth.html#error_description=private&error=error')).includes('private'));
  assert.match(accountRequestMessage({ code: 'email_not_confirmed' }), /not confirmed/);
  assert.match(accountRequestMessage({ code: 'over_email_send_rate_limit' }), /wait/);
  assert.ok(!accountRequestMessage({ message: 'private backend details' }).includes('private'));
});

test('account operations call the official auth methods without directory writes or ownership metadata', async () => {
  const calls = [];
  const operation = name => async (payload, options) => { calls.push({ name, payload, options }); return { data: {}, error: null }; };
  const client = { auth: { signInWithPassword: operation('signin'), signUp: operation('signup'), resetPasswordForEmail: operation('reset'), updateUser: operation('update') } };
  const request = { email: ' account@example.test ', password: 'test-password-long', confirmation: 'test-password-long', locationUrl: 'http://127.0.0.1:4182/auth.html' };
  for (const mode of ['signin', 'signup', 'reset', 'update']) await authenticate(client, { ...request, mode });
  assert.equal(calls[0].payload.email, 'account@example.test');
  assert.equal(calls[1].payload.options.emailRedirectTo, 'http://127.0.0.1:4182/auth.html');
  assert.equal(calls[1].payload.options.data, undefined);
  assert.equal(calls[2].options.redirectTo, 'http://127.0.0.1:4182/auth.html');
  assert.deepEqual(calls[3].payload, { password: 'test-password-long' });
  await assert.rejects(authenticate(client, { ...request, mode: 'signup', confirmation: 'different' }), /do not match/);
  await assert.rejects(authenticate(client, { ...request, mode: 'update', password: 'short' }), /12 characters/);
});

test('official SDK exchanges the correct namespaced signup verifier after URL cleanup', async () => {
  const values = new Map();
  const signupFlows = [];
  let exchangedVerifier;
  const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'test@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-10-04T00:00:00Z' };
  const client = createCreatorClient({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test_only' }, {
    auth: { autoRefreshToken: false, experimental: { appendPkceFlowIdToRedirects: true }, storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } },
    fetch: async (input, options) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/signup')) {
        signupFlows.push(new URL(url.searchParams.get('redirect_to')).searchParams.get('sb_flow_id'));
        return new Response(JSON.stringify(user), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      exchangedVerifier = JSON.parse(options.body).code_verifier;
      return new Response(JSON.stringify({ access_token: 'fake-access-token', refresh_token: 'fake-refresh-token', expires_in: 3600, token_type: 'bearer', user }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  try {
    const request = { mode: 'signup', email: 'test@example.test', password: 'test-password-long', confirmation: 'test-password-long', locationUrl: 'http://127.0.0.1:4182/auth.html' };
    for (let index = 0; index < 2; index++) assert.equal((await authenticate(client, request)).error, null);
    assert.ok(signupFlows.every(Boolean));
    assert.notEqual(signupFlows[0], signupFlows[1]);
    const slot = [...values.entries()].find(([key]) => key.includes(signupFlows[0]));
    assert.ok(slot);
    const verifier = JSON.parse(slot[1]).split('/')[0];
    const callback = callbackState(`http://127.0.0.1:4182/auth.html?code=fake-code&sb_flow_id=${signupFlows[0]}`);
    assert.equal((await exchangeAuthCallback(client, callback)).error, null);
    assert.equal(exchangedVerifier, verifier);
  } finally { await client.auth.stopAutoRefresh(); }
});

test('terminal links are stripped before redemption and use official single-use OTP verification', async () => {
  const token = 'a'.repeat(64);
  const callback = callbackState(`https://controlandchaosv2.netlify.app/auth.html#terminal_token=${token}`);
  assert.equal(callback.terminalToken, token);
  assert.equal(callback.cleanUrl, 'https://controlandchaosv2.netlify.app/auth.html');
  let verified;
  const client = { auth: { verifyOtp: async payload => { verified = payload; return { error: null }; } } };
  await exchangeTerminalLogin(client, token, async (url, options) => {
    assert.equal(url, '/.netlify/functions/terminal-login');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.deepEqual(JSON.parse(options.body), { action: 'redeem', token });
    return new Response(JSON.stringify({ token_hash: 'fake-otp-hash' }));
  });
  assert.deepEqual(verified, { token_hash: 'fake-otp-hash', type: 'magiclink' });
  await assert.rejects(exchangeTerminalLogin(client, 'bad-token'), /Invalid/);
  assert.equal(callbackState('https://controlandchaosv2.netlify.app/auth.html#terminal_setup=1').terminalSetup, true);
});
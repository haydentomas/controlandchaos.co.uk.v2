import { createClient } from '@supabase/supabase-js';
import { directoryConfig } from './directory-api.js';

export const AUTH_STORAGE_KEY = 'cc-v2-creator-auth';

export function createCreatorClient(config = directoryConfig(), options = {}) {
  return createClient(config.url, config.publishableKey, {
    auth: {
      storageKey: AUTH_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
      ...options.auth
    },
    ...(options.fetch ? { global: { fetch: options.fetch } } : {})
  });
}

export function authRedirect(locationUrl) {
  const url = new URL(locationUrl);
  const local = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '4182';
  const staging = [
    'https://controlandchaosv2.netlify.app',
    'https://feature-creator-blog-pass-through-20261006--controlandchaosv2.netlify.app'
  ].includes(url.origin);
  if (!local && !staging) throw new Error('This sign-in address is not configured.');
  return `${url.origin}/auth.html`;
}

export function callbackState(locationUrl) {
  const url = new URL(locationUrl);
  const fragment = new URLSearchParams(url.hash.slice(1));
  return {
    code: url.searchParams.get('code'),
    flowId: url.searchParams.get('sb_flow_id'),
    terminalToken: fragment.get('terminal_token'),
    terminalSetup: fragment.get('terminal_setup') === '1',
    errorCode: url.searchParams.get('error_code') || fragment.get('error_code'),
    error: url.searchParams.has('error') || url.searchParams.has('error_code') || fragment.has('error') || fragment.has('error_code'),
    unsupportedToken: fragment.has('access_token') || fragment.has('refresh_token'),
    cleanUrl: `${url.origin}${url.pathname}`
  };
}

export async function authenticate(client, { mode, email, password, confirmation, locationUrl }) {
  if (mode === 'signin') return client.auth.signInWithPassword({ email: email.trim(), password });
  if (mode === 'signup' || mode === 'update') {
    if (password.length < 12) throw new Error('Use a password of at least 12 characters.');
    if (password !== confirmation) throw new Error('The passwords do not match.');
  }
  if (mode === 'signup') return client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: authRedirect(locationUrl) } });
  if (mode === 'reset') return client.auth.resetPasswordForEmail(email.trim(), { redirectTo: authRedirect(locationUrl) });
  if (mode === 'update') return client.auth.updateUser({ password });
  throw new Error('Invalid account action.');
}

export function accountLinkMessage(callback) {
  if (callback.errorCode === 'otp_expired') return 'This email link has expired or was already used. Try signing in with your account password first.';
  if (callback.unsupportedToken) return 'Your email may be confirmed, but this link cannot complete secure sign-in. Sign in with your account email and password.';
  return 'This account link could not be completed. Try signing in, or request a fresh link in the same browser.';
}

export function accountRequestMessage(error) {
  if (error.code === 'email_not_confirmed') return 'Your email is not confirmed yet. Use a fresh confirmation email; do not reuse the old link.';
  if (error.code === 'invalid_credentials') return 'Unable to sign in. Check your account email and password.';
  if (['over_email_send_rate_limit', 'over_request_rate_limit'].includes(error.code)) return 'Too many requests. Please wait before requesting another email.';
  return 'Unable to complete this request. Check your details and try again.';
}

export async function setWebPassword(client, { password, confirmation }, verifierFactory = () => createCreatorClient(undefined, {
  auth: { storageKey: `${AUTH_STORAGE_KEY}-password-check`, persistSession: false, autoRefreshToken: false }
})) {
  if (password.length < 12) throw new Error('Use a password of at least 12 characters.');
  if (password !== confirmation) throw new Error('The passwords do not match.');
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user?.email || !data.user.email_confirmed_at) {
    throw new Error('Sign in to an email-confirmed account before setting your web password.');
  }
  const verifier = verifierFactory();
  const { error: updateError } = await client.auth.updateUser({ password });
  if (updateError) {
    if (['reauthentication_needed', 'reauthentication_not_valid'].includes(updateError.code)) {
      throw new Error('Supabase requires fresh authentication. Request a fresh terminal login or password recovery link before changing your password.');
    }
    if (updateError.code === 'same_password') throw new Error('Choose a different password from your current password.');
    if (updateError.code === 'weak_password') throw new Error('This password does not meet the account password policy. Choose a stronger password.');
    throw new Error('Password update was rejected. Your web password was not changed. Check Supabase Auth logs.');
  }
  try {
    const { data: verified, error: verificationError } = await verifier.auth.signInWithPassword({ email: data.user.email, password });
    if (verificationError || !verified?.session || verified.user?.id !== data.user.id) {
      throw new Error('Password updated, but normal web sign-in could not be verified. Keep this session open and check Supabase Auth logs.');
    }
  } catch {
    throw new Error('Password updated, but normal web sign-in could not be verified. Keep this session open and check Supabase Auth logs.');
  } finally {
    const { error: signOutError } = await verifier.auth.signOut({ scope: 'local' });
    if (signOutError) throw new Error('Password updated, but the verification session could not be cleared. Keep this account session open.');
  }
  return data.user.email;
}

export async function exchangeAuthCallback(client, callback) {
  return client.auth.exchangeCodeForSession(callback.code, callback.flowId ? { flowId: callback.flowId } : undefined);
}

export async function exchangeTerminalLogin(client, token, request = fetch) {
  if (!/^[a-f0-9]{64}$/.test(token || '')) throw new Error('Invalid terminal link.');
  const response = await request('/.netlify/functions/terminal-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    body: JSON.stringify({ action: 'redeem', token })
  });
  if (!response.ok) throw new Error('Terminal link could not be completed.');
  const result = await response.json();
  if (typeof result.token_hash !== 'string' || !result.token_hash) throw new Error('Invalid terminal response.');
  return client.auth.verifyOtp({ token_hash: result.token_hash, type: 'magiclink' });
}
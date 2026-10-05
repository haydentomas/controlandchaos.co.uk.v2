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
  const staging = url.origin === 'https://controlandchaosv2.netlify.app';
  if (!local && !staging) throw new Error('This sign-in address is not configured.');
  return `${url.origin}/auth.html`;
}

export function callbackState(locationUrl) {
  const url = new URL(locationUrl);
  const fragment = new URLSearchParams(url.hash.slice(1));
  return {
    code: url.searchParams.get('code'),
    flowId: url.searchParams.get('sb_flow_id'),
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

export async function exchangeAuthCallback(client, callback) {
  return client.auth.exchangeCodeForSession(callback.code, callback.flowId ? { flowId: callback.flowId } : undefined);
}
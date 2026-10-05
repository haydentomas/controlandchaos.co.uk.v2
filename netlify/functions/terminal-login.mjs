import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const accountUrl = 'https://controlandchaosv2.netlify.app/auth.html';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tokenPattern = /^[a-f0-9]{64}$/;
const digest = token => createHash('sha256').update(token).digest('hex');
const reply = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }, body: JSON.stringify(body) });

export function createTerminalLoginHandler(environment, clientFactory = createClient) {
  return async event => {
    if (event.httpMethod !== 'POST') return reply(405, { message: 'POST required.' });
    try {
      const endpoint = new URL(environment.SUPABASE_URL);
      if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.supabase.co') || endpoint.username || endpoint.password || !environment.SUPABASE_SECRET_KEY?.startsWith('sb_secret_')) throw new Error('Invalid configuration');
    } catch { return reply(503, { message: 'Account service unavailable.' }); }
    if (typeof event.body !== 'string' || Buffer.byteLength(event.body) > 1024) return reply(400, { message: 'Invalid login request.' });
    let payload;
    try { payload = JSON.parse(event.body); } catch { return reply(400, { message: 'Invalid login request.' }); }
    if (!payload || Array.isArray(payload) || typeof payload !== 'object' || !['issue', 'redeem'].includes(payload.action)) return reply(400, { message: 'Invalid login request.' });
    const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([name, value]) => [name.toLowerCase(), value]));
    if (payload.action === 'issue') {
      if (Object.keys(payload).some(name => !['action', 'avatar_uuid'].includes(name)) || !uuid.test(payload.avatar_uuid || '') || payload.avatar_uuid === '00000000-0000-0000-0000-000000000000') return reply(400, { message: 'Invalid login request.' });
      const secret = environment.CC_VERIFICATION_KIOSK_SECRET || '';
      const owner = environment.CC_VERIFICATION_KIOSK_OWNER || '';
      const object = environment.CC_VERIFICATION_KIOSK_OBJECT || '';
      if (secret.length < 32 || !uuid.test(owner) || !uuid.test(object)) return reply(503, { message: 'Terminal login is not configured.' });
      const supplied = headers['x-cc-kiosk-secret'];
      if (typeof supplied !== 'string' || Buffer.byteLength(secret) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(secret), Buffer.from(supplied)) || headers['x-secondlife-owner-key']?.toLowerCase() !== owner.toLowerCase() || headers['x-secondlife-object-key']?.toLowerCase() !== object.toLowerCase()) return reply(403, { message: 'Terminal request denied.' });
      try {
        const client = clientFactory(environment.SUPABASE_URL, environment.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
        const token = randomBytes(32).toString('hex');
        const { data, error } = await client.rpc('issue_terminal_login', { target_avatar: payload.avatar_uuid, login_hash: digest(token) });
        if (error) return reply(error.message === 'terminal_login_rate_limited' ? 429 : 503, { message: 'Unable to open account. Please wait before trying again.' });
        return reply(200, { url: data ? `${accountUrl}#terminal_token=${token}` : `${accountUrl}#terminal_setup=1` });
      } catch { return reply(503, { message: 'Account service unavailable.' }); }
    }
    if (Object.keys(payload).some(name => !['action', 'token'].includes(name)) || !tokenPattern.test(payload.token || '') || (headers.origin && headers.origin !== new URL(accountUrl).origin)) return reply(400, { message: 'Invalid login request.' });
    try {
      const client = clientFactory(environment.SUPABASE_URL, environment.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      const { data: userId, error } = await client.rpc('consume_terminal_login', { login_hash: digest(payload.token) });
      if (error || !uuid.test(userId || '')) return reply(409, { message: 'Link expired or already used. Request a fresh link from the terminal.' });
      const { data: account, error: userError } = await client.auth.admin.getUserById(userId);
      const user = account?.user;
      if (userError || user?.id !== userId || !user.email || !user.email_confirmed_at || (user.banned_until && new Date(user.banned_until).getTime() > Date.now())) return reply(403, { message: 'Sign in with your account email to continue.' });
      const { data: link, error: linkError } = await client.auth.admin.generateLink({ type: 'magiclink', email: user.email, options: { redirectTo: accountUrl } });
      if (linkError || link?.user?.id !== userId || !link.properties?.hashed_token) return reply(503, { message: 'Unable to complete login. Request a fresh terminal link.' });
      return reply(200, { token_hash: link.properties.hashed_token });
    } catch { return reply(503, { message: 'Unable to complete login. Request a fresh terminal link.' }); }
  };
}

export const handler = event => createTerminalLoginHandler(process.env)(event);
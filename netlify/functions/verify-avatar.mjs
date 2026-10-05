import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (statusCode, message) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ message }) });

export function createVerificationHandler(environment, clientFactory = createClient) {
  return async event => {
    if (event.httpMethod !== 'POST') return reply(405, 'POST required.');
    const secret = environment.CC_VERIFICATION_KIOSK_SECRET || '';
    const owner = environment.CC_VERIFICATION_KIOSK_OWNER || '';
    const object = environment.CC_VERIFICATION_KIOSK_OBJECT || '';
    if (secret.length < 32 || !uuid.test(owner) || !uuid.test(object) || !environment.SUPABASE_URL || !environment.SUPABASE_SECRET_KEY?.startsWith('sb_secret_')) return reply(503, 'Verification is not configured.');
    try {
      const endpoint = new URL(environment.SUPABASE_URL);
      if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.supabase.co') || endpoint.username || endpoint.password) return reply(503, 'Verification is not configured.');
    } catch { return reply(503, 'Verification is not configured.'); }
    const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([name, value]) => [name.toLowerCase(), value]));
    const supplied = headers['x-cc-kiosk-secret'] || '';
    const first = Buffer.from(secret);
    const second = Buffer.from(supplied);
    if (first.length !== second.length || !timingSafeEqual(first, second) || headers['x-secondlife-owner-key']?.toLowerCase() !== owner.toLowerCase() || headers['x-secondlife-object-key']?.toLowerCase() !== object.toLowerCase()) return reply(403, 'Verification request denied.');
    if (typeof event.body !== 'string' || Buffer.byteLength(event.body) > 2048) return reply(400, 'Invalid verification request.');
    let payload;
    try { payload = JSON.parse(event.body); } catch { return reply(400, 'Invalid verification request.'); }
    if (!payload || Object.keys(payload).some(name => !['code', 'avatar_uuid', 'username'].includes(name)) || !uuid.test(payload.code || '') || !uuid.test(payload.avatar_uuid || '') || typeof payload.username !== 'string' || !payload.username.trim() || payload.username.length > 100) return reply(400, 'Invalid verification request.');
    try {
      const client = clientFactory(environment.SUPABASE_URL, environment.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      const { error } = await client.rpc('consume_avatar_verification', { challenge_code: payload.code, avatar_id: payload.avatar_uuid, avatar_username: payload.username });
      if (error) return reply(409, 'Code expired, already used, or avatar cannot be linked.');
      return reply(200, 'Avatar linked. Return to your account page and refresh verification.');
    } catch { return reply(503, 'Verification unavailable. Try again later.'); }
  };
}

export const handler = event => createVerificationHandler(process.env)(event);
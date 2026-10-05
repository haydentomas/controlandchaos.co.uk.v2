import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const zeroUuid = '00000000-0000-0000-0000-000000000000';
const reply = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

export function createReminderHandler(environment, clientFactory = createClient) {
  return async event => {
    if (event.httpMethod !== 'POST') return reply(405, { message: 'POST required.' });
    const secret = environment.CC_PAYMENT_KIOSK_SECRET || '';
    const owner = environment.CC_PAYMENT_KIOSK_OWNER || '';
    const object = environment.CC_PAYMENT_KIOSK_OBJECT || '';
    if (secret.length < 32 || !uuid.test(owner) || !uuid.test(object) || owner === zeroUuid || object === zeroUuid || !environment.SUPABASE_SECRET_KEY?.startsWith('sb_secret_')) return reply(503, { message: 'Reminders are not configured.' });
    try {
      const endpoint = new URL(environment.SUPABASE_URL);
      if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.supabase.co') || endpoint.username || endpoint.password) throw new Error('Invalid endpoint');
    } catch { return reply(503, { message: 'Reminders are not configured.' }); }
    const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([name, value]) => [name.toLowerCase(), value]));
    const supplied = headers['x-cc-payment-secret'];
    if (typeof supplied !== 'string' || Buffer.byteLength(secret) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(secret), Buffer.from(supplied)) || headers['x-secondlife-owner-key']?.toLowerCase() !== owner.toLowerCase() || headers['x-secondlife-object-key']?.toLowerCase() !== object.toLowerCase()) return reply(403, { message: 'Reminder request denied.' });
    if (typeof event.body !== 'string' || Buffer.byteLength(event.body) > 1024) return reply(400, { message: 'Invalid reminder request.' });
    let payload;
    try { payload = JSON.parse(event.body); } catch { return reply(400, { message: 'Invalid reminder request.' }); }
    if (!payload || Array.isArray(payload) || typeof payload !== 'object' || !['claim', 'authorize', 'ack'].includes(payload.action)) return reply(400, { message: 'Invalid reminder request.' });
    const allowed = payload.action === 'claim' ? ['action'] : ['action', 'id', 'claim_token'];
    if (Object.keys(payload).some(name => !allowed.includes(name)) || (payload.action !== 'claim' && (!uuid.test(payload.id || '') || !uuid.test(payload.claim_token || '')))) return reply(400, { message: 'Invalid reminder request.' });
    try {
      const client = clientFactory(environment.SUPABASE_URL, environment.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      const args = { kiosk_id: object.toLowerCase() };
      if (payload.action !== 'claim') Object.assign(args, { reminder_id: payload.id, delivery_token: payload.claim_token });
      const operation = { claim: 'claim_directory_reminder', authorize: 'authorize_directory_reminder', ack: 'acknowledge_directory_reminder' }[payload.action];
      const { data, error } = await client.rpc(operation, args);
      if (error) return reply(503, { message: 'Reminder service unavailable.' });
      if (payload.action === 'ack') return reply(data === true ? 200 : 409, { acknowledged: data === true });
      const reminder = data?.[0];
      if (!reminder) return reply(200, { reminder: null });
      if (payload.action === 'claim') return reply(200, { reminder });
      const expiry = new Date(reminder.expires_at);
      if (!uuid.test(reminder.avatar_uuid || '') || !['expiring', 'expired'].includes(reminder.kind) || Number.isNaN(expiry.getTime())) return reply(503, { message: 'Reminder service unavailable.' });
      const when = expiry.toISOString().replace('T', ' ').replace('.000Z', ' UTC').replace('Z', ' UTC');
      const message = reminder.kind === 'expiring'
        ? `[Control & Chaos] Your directory subscription expires at ${when}. Renew at the directory terminal. Your saved profile is retained if access expires.`
        : '[Control & Chaos] Your directory subscription has expired. Your listing is hidden and paid editing is disabled; your profile is saved. Renew at the directory terminal to restore access.';
      return reply(200, { reminder: { avatar_uuid: reminder.avatar_uuid, message } });
    } catch { return reply(503, { message: 'Reminder service unavailable.' }); }
  };
}

export const handler = event => createReminderHandler(process.env)(event);
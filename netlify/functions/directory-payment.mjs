import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const zeroUuid = '00000000-0000-0000-0000-000000000000';
const plans = new Set(['basic_monthly', 'basic_lifetime', 'vip_monthly', 'vip_lifetime']);
const reply = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

export function createPaymentHandler(environment, clientFactory = createClient) {
  return async event => {
    if (event.httpMethod !== 'POST') return reply(405, { message: 'POST required.' });
    const secret = environment.CC_PAYMENT_KIOSK_SECRET || '';
    const owner = environment.CC_PAYMENT_KIOSK_OWNER || '';
    const object = environment.CC_PAYMENT_KIOSK_OBJECT || '';
    if (secret.length < 32 || !uuid.test(owner) || !uuid.test(object) || owner === zeroUuid || object === zeroUuid || !environment.SUPABASE_SECRET_KEY?.startsWith('sb_secret_')) return reply(503, { message: 'Payments are not configured.' });
    try {
      const endpoint = new URL(environment.SUPABASE_URL);
      if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.supabase.co') || endpoint.username || endpoint.password) throw new Error('Invalid endpoint');
    } catch { return reply(503, { message: 'Payments are not configured.' }); }
    const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([name, value]) => [name.toLowerCase(), value]));
    const supplied = headers['x-cc-payment-secret'];
    if (typeof supplied !== 'string') return reply(403, { message: 'Payment request denied.' });
    const expectedBytes = Buffer.from(secret);
    const suppliedBytes = Buffer.from(supplied);
    if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes) || headers['x-secondlife-owner-key']?.toLowerCase() !== owner.toLowerCase() || headers['x-secondlife-object-key']?.toLowerCase() !== object.toLowerCase()) return reply(403, { message: 'Payment request denied.' });
    if (typeof event.body !== 'string' || Buffer.byteLength(event.body) > 2048) return reply(400, { message: 'Invalid payment request.' });
    let payload;
    try { payload = JSON.parse(event.body); } catch { return reply(400, { message: 'Invalid payment request.' }); }
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') return reply(400, { message: 'Invalid payment request.' });
    const allowed = payload.action === 'plans' ? ['action', 'avatar_uuid'] : ['action', 'payment_reference', 'avatar_uuid', 'plan', 'amount_linden'];
    if (Object.keys(payload).some(name => !allowed.includes(name)) || !['plans', 'payment'].includes(payload.action)) return reply(400, { message: 'Invalid payment request.' });
    if (!uuid.test(payload.avatar_uuid || '') || payload.avatar_uuid === zeroUuid) return reply(400, { message: 'Invalid payment request.' });
    if (payload.action === 'payment' && (!uuid.test(payload.payment_reference || '') || payload.payment_reference === zeroUuid || !uuid.test(payload.avatar_uuid || '') || payload.avatar_uuid === zeroUuid || !plans.has(payload.plan) || !Number.isInteger(payload.amount_linden) || payload.amount_linden <= 0 || payload.amount_linden > 2147483647)) return reply(400, { message: 'Invalid payment request.' });
    try {
      const client = clientFactory(environment.SUPABASE_URL, environment.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      if (payload.action === 'plans') {
        const { data, error } = await client.rpc('directory_payment_plans', { target_avatar: payload.avatar_uuid });
        if (error) return reply(503, { message: 'Plans unavailable.' });
        return reply(200, { plans: data || [] });
      }
      const { data, error } = await client.rpc('register_directory_payment', { payment_reference: payload.payment_reference, payer_avatar: payload.avatar_uuid, purchased_plan: payload.plan, paid_linden: payload.amount_linden });
      if (error) return reply(['invalid_payment', 'invalid_payment_plan_or_amount', 'payment_reference_conflict', 'subscription_tier_change_unavailable'].includes(error.message) ? 409 : 503, { message: 'Payment could not be confirmed. Retain the receipt for reconciliation.' });
      return reply(200, { payment_reference: payload.payment_reference, profile_id: data, message: data ? 'Subscription activated.' : 'Payment recorded. Verify your avatar on your account to unlock your profile.' });
    } catch { return reply(503, { message: 'Payment service unavailable. Retry the same receipt.' }); }
  };
}

export const handler = event => createPaymentHandler(process.env)(event);
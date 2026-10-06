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
    const actionFields = {
      plans: ['action', 'avatar_uuid'],
      payment: ['action', 'payment_reference', 'avatar_uuid', 'plan', 'amount_linden'],
      creator_blog_offer: ['action', 'creator_avatar_uuid'],
      creator_blog_prepare: ['action', 'payment_reference', 'avatar_uuid', 'creator_avatar_uuid', 'amount_linden'],
      creator_blog_start: ['action', 'payment_reference', 'avatar_uuid', 'creator_avatar_uuid', 'amount_linden'],
      creator_blog_confirm: ['action', 'payment_reference', 'avatar_uuid', 'creator_avatar_uuid', 'amount_linden'],
      creator_blog_cancel: ['action', 'payment_reference', 'avatar_uuid', 'creator_avatar_uuid', 'amount_linden'],
      creator_blog_refund_confirm: ['action', 'payment_reference', 'avatar_uuid', 'creator_avatar_uuid', 'amount_linden']
    };
    const allowed = actionFields[payload.action];
    if (!allowed || Object.keys(payload).some(name => !allowed.includes(name))) return reply(400, { message: 'Invalid payment request.' });
    const isDirectoryAction = ['plans', 'payment'].includes(payload.action);
    const avatar = isDirectoryAction ? payload.avatar_uuid : payload.creator_avatar_uuid;
    if (!uuid.test(avatar || '') || avatar === zeroUuid) return reply(400, { message: 'Invalid payment request.' });
    if (['payment', 'creator_blog_prepare', 'creator_blog_start', 'creator_blog_confirm', 'creator_blog_cancel', 'creator_blog_refund_confirm'].includes(payload.action)
      && (!uuid.test(payload.payment_reference || '') || payload.payment_reference === zeroUuid
        || !uuid.test(payload.avatar_uuid || '') || payload.avatar_uuid === zeroUuid
        || !Number.isInteger(payload.amount_linden) || payload.amount_linden <= 0 || payload.amount_linden > 2147483647)) return reply(400, { message: 'Invalid payment request.' });
    if (payload.action === 'payment' && !plans.has(payload.plan)) return reply(400, { message: 'Invalid payment request.' });
    try {
      const client = clientFactory(environment.SUPABASE_URL, environment.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      if (payload.action === 'plans') {
        const { data, error } = await client.rpc('directory_payment_plans', { target_avatar: payload.avatar_uuid });
        if (error) return reply(503, { message: 'Plans unavailable.' });
        return reply(200, { plans: data || [] });
      }
      if (payload.action === 'creator_blog_offer') {
        const { data, error } = await client.rpc('creator_blog_offer_for_terminal', { target_creator_avatar: payload.creator_avatar_uuid });
        if (error) return reply(503, { message: 'Creator offer unavailable.' });
        return data?.length ? reply(200, { offer: data[0] }) : reply(404, { message: 'Creator subscription is not available.' });
      }
      if (payload.action === 'creator_blog_prepare') {
        const { data, error } = await client.rpc('creator_blog_prepare_payment', {
          payment_reference: payload.payment_reference, payer_avatar: payload.avatar_uuid,
          target_creator_avatar: payload.creator_avatar_uuid, paid_linden: payload.amount_linden
        });
        if (error || !data?.length) return reply(409, { message: 'Creator payment could not be prepared.' });
        return reply(200, { payment_reference: payload.payment_reference, payout: data[0] });
      }
      if (payload.action === 'creator_blog_start') {
        const { data, error } = await client.rpc('creator_blog_start_payout', {
          payment_reference: payload.payment_reference, payer_avatar: payload.avatar_uuid,
          target_creator_avatar: payload.creator_avatar_uuid, paid_linden: payload.amount_linden
        });
        if (error) return reply(409, { message: 'Creator payout could not be started.' });
        return reply(200, { payment_reference: payload.payment_reference, start_payout: data === true });
      }
      if (payload.action === 'creator_blog_confirm') {
        const { data, error } = await client.rpc('creator_blog_confirm_payment', {
          payment_reference: payload.payment_reference, payer_avatar: payload.avatar_uuid,
          target_creator_avatar: payload.creator_avatar_uuid, paid_linden: payload.amount_linden
        });
        if (error || !data) return reply(503, { message: 'Creator access confirmation is delayed. Retry the same receipt.' });
        return reply(200, { payment_reference: payload.payment_reference, expires_at: data, message: 'Creator subscription activated.' });
      }
      if (payload.action === 'creator_blog_cancel') {
        const { data, error } = await client.rpc('creator_blog_cancel_payment', {
          payment_reference: payload.payment_reference, payer_avatar: payload.avatar_uuid,
          target_creator_avatar: payload.creator_avatar_uuid, paid_linden: payload.amount_linden
        });
        if (error) return reply(503, { message: 'Creator payment cancellation is delayed.' });
        return reply(200, { payment_reference: payload.payment_reference, refund_required: data === true });
      }
      if (payload.action === 'creator_blog_refund_confirm') {
        const { data, error } = await client.rpc('creator_blog_confirm_refund', {
          payment_reference: payload.payment_reference, payer_avatar: payload.avatar_uuid,
          target_creator_avatar: payload.creator_avatar_uuid, paid_linden: payload.amount_linden
        });
        if (error || data !== true) return reply(503, { message: 'Refund confirmation is delayed.' });
        return reply(200, { payment_reference: payload.payment_reference, refunded: true });
      }
      const { data, error } = await client.rpc('register_directory_payment', { payment_reference: payload.payment_reference, payer_avatar: payload.avatar_uuid, purchased_plan: payload.plan, paid_linden: payload.amount_linden });
      if (error) return reply(['invalid_payment', 'invalid_payment_plan_or_amount', 'payment_reference_conflict', 'subscription_tier_change_unavailable'].includes(error.message) ? 409 : 503, { message: 'Payment could not be confirmed. Retain the receipt for reconciliation.' });
      return reply(200, { payment_reference: payload.payment_reference, profile_id: data, message: data ? 'Subscription activated.' : 'Payment recorded. Verify your avatar on your account to unlock your profile.' });
    } catch { return reply(503, { message: 'Payment service unavailable. Retry the same receipt.' }); }
  };
}

export const handler = event => createPaymentHandler(process.env)(event);
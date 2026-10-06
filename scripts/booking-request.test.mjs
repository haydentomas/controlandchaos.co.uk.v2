import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBookingSubmissionHandler } from '../netlify/functions/submission-created.mjs';
import { bookingSlots, initBookingEnquiry } from '../src/modules/booking-enquiry.js';
import { parseHTML } from 'linkedom';

const profileId = '33333333-3333-4333-8333-333333333333';
const itemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const environment = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_fake_test_only', RESEND_API_KEY: 're_fake_test_only', RESEND_FROM_EMAIL: 'C&C <bookings@example.test>' };
const profile = {
  recipient_email: 'owner@example.test', display_name: 'Alek & Zane', sl_username: 'alek.zane',
  rate_categories: [{ title: 'Consultations', items: [{ id: itemId, name: 'Introduction', price: 'L$1,000', unit: '30 minutes' }] }],
  booking_hours: { timezone: 'America/Los_Angeles', days: ['sat'], start_time: '20:00', end_time: '23:00', slot_minutes: 60, notes: '' }
};
const submission = overrides => ({
  form_name: 'directory-booking',
  data: {
    'form-name': 'directory-booking', profile_id: profileId, client_name: 'Guest', client_contact: 'guest@example.test',
    preferred_date: '2026-10-10', preferred_time: '21:00', selected_services: JSON.stringify([itemId]), message: 'Please confirm.',
    ...overrides
  }
});

test('booking form sends validated profile pricing to the server-resolved owner through Resend', async () => {
  const calls = [];
  const handler = createBookingSubmissionHandler(environment,
    () => ({ rpc: async (...args) => { calls.push(args); return { data: [profile], error: null }; } }),
    async (url, options) => { calls.push({ url, options }); return { ok: true }; });
  const result = await handler({ body: JSON.stringify(submission({ recipient_email: 'attacker@example.test', quote_total: 'L1' })) });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(calls[0], ['directory_booking_recipient', { target_profile: profileId }]);
  const sent = JSON.parse(calls[1].options.body);
  assert.deepEqual(sent.to, ['owner@example.test']);
  assert.equal(sent.reply_to, 'guest@example.test');
  assert.match(sent.subject, /L1,000/);
  assert.match(sent.text, /Consultations - Introduction \(L\$1,000\)/);
  assert.doesNotMatch(sent.text, /attacker@example\.test/);
});

test('booking mail escapes submitted HTML and uses plain text for an in-world contact', async () => {
  let sent;
  const handler = createBookingSubmissionHandler(environment,
    () => ({ rpc: async () => ({ data: [profile], error: null }) }),
    async (_url, options) => { sent = JSON.parse(options.body); return { ok: true }; });
  const result = await handler({ body: JSON.stringify(submission({ client_contact: 'Guest Resident', message: '<script>alert(1)</script>' })) });
  assert.equal(result.statusCode, 200);
  assert.equal(sent.reply_to, undefined);
  assert.match(sent.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(sent.html, /<script>/);
});

test('overnight booking email labels post-midnight slots as the following day', async () => {
  let sent;
  const overnightProfile = { ...profile, booking_hours: { ...profile.booking_hours, start_time: '22:00', end_time: '02:00' } };
  const handler = createBookingSubmissionHandler(environment,
    () => ({ rpc: async () => ({ data: [overnightProfile], error: null }) }),
    async (_url, options) => { sent = JSON.parse(options.body); return { ok: true }; });
  const result = await handler({ body: JSON.stringify(submission({ preferred_time: '01:00' })) });
  assert.equal(result.statusCode, 200);
  assert.match(sent.text, /2026-10-11 \(next day\) at 01:00/);
});

test('booking handler ignores unrelated forms and Netlify honeypot submissions', async () => {
  let calls = 0;
  const handler = createBookingSubmissionHandler(environment, () => { calls++; throw new Error('unexpected lookup'); });
  assert.equal((await handler({ body: JSON.stringify({ form_name: 'contact', data: {} }) })).statusCode, 200);
  assert.equal((await handler({ body: JSON.stringify(submission({ 'bot-field': 'filled' })) })).statusCode, 200);
  assert.equal(calls, 0);
});

test('booking handler rejects invalid service IDs, stale slots and unavailable profiles without sending', async () => {
  let sends = 0;
  const handler = createBookingSubmissionHandler(environment,
    () => ({ rpc: async () => ({ data: [profile], error: null }) }),
    async () => { sends++; return { ok: true }; });
  for (const data of [
    submission({ selected_services: JSON.stringify(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']) }),
    submission({ preferred_date: '2026-10-11', preferred_time: '21:00' }),
    submission({ preferred_time: '22:30' })
  ]) {
    assert.equal((await handler({ body: JSON.stringify(data) })).statusCode, 400);
  }
  const unavailable = createBookingSubmissionHandler(environment,
    () => ({ rpc: async () => ({ data: [], error: null }) }),
    async () => { sends++; return { ok: true }; });
  assert.equal((await unavailable({ body: JSON.stringify(submission({})) })).statusCode, 409);
  assert.equal(sends, 0);
});

test('booking handler refuses to send when Resend is not configured', async () => {
  let calls = 0;
  const handler = createBookingSubmissionHandler({ ...environment, RESEND_API_KEY: '' }, () => { calls++; throw new Error('unexpected lookup'); });
  assert.equal((await handler({ body: JSON.stringify(submission({})) })).statusCode, 503);
  assert.equal(calls, 0);
});

test('booking slot picker uses configured days and preserves overnight windows', () => {
  assert.deepEqual(bookingSlots(profile.booking_hours, '2026-10-10').map(slot => slot.value), ['20:00', '21:00', '22:00', '23:00']);
  assert.deepEqual(bookingSlots(profile.booking_hours, '2026-10-11'), []);
  assert.deepEqual(bookingSlots({ ...profile.booking_hours, start_time: '22:00', end_time: '02:00' }, '2026-10-10'), [
    { value: '22:00', label: '10:00 PM' },
    { value: '23:00', label: '11:00 PM' },
    { value: '00:00', label: '12:00 AM (next day)' },
    { value: '01:00', label: '1:00 AM (next day)' },
    { value: '02:00', label: '2:00 AM (next day)' }
  ]);
});

test('local booking preview refuses to POST enquiries', async () => {
  const { document } = parseHTML(`<section data-public-profile-booking-enquiry>
    <form data-live-booking-form><input name="profile_id"><input name="selected_services"><input name="client_name"><input name="client_contact"><input type="date" data-booking-date><select name="preferred_time" data-booking-time><option value=""></option></select><label data-booking-flexible-label></label><input type="time" data-booking-time-flexible><textarea name="message"></textarea></form>
    <p data-booking-schedule></p><p data-booking-status></p><button data-booking-submit></button>
  </section>`);
  const previousDocument = globalThis.document;
  globalThis.document = document;
  let sends = 0;
  try {
    const section = document.querySelector('section');
    const form = section.querySelector('form');
    form.reportValidity = () => true;
    let selectedTime = '';
    Object.defineProperty(form.querySelector('[data-booking-time]'), 'value', { configurable: true, get: () => selectedTime, set: value => { selectedTime = String(value); } });
    initBookingEnquiry(section, { id: profileId, booking_hours: profile.booking_hours }, { production: false, fetchImplementation: async () => { sends++; return { ok: true }; } });
    assert.equal(form.querySelector('[data-booking-time]').required, true);
    assert.equal(form.querySelector('[data-booking-time-flexible]').disabled, true);
    const event = new document.defaultView.Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(event.defaultPrevented, true);
    assert.match(section.querySelector('[data-booking-status]').textContent, /disabled in the local preview/);
    assert.equal(sends, 0);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('flexible booking profiles expose an optional time field without requiring a weekday', () => {
  const { document } = parseHTML(`<section data-public-profile-booking-enquiry>
    <form data-live-booking-form><input name="profile_id"><input name="selected_services"><input name="client_name"><input name="client_contact"><input type="date" data-booking-date><select name="preferred_time" data-booking-time><option value=""></option></select><label class="preview-hidden" data-booking-flexible-label></label><input class="preview-hidden" type="time" data-booking-time-flexible><textarea name="message"></textarea></form>
    <p data-booking-schedule></p><p data-booking-status></p><button data-booking-submit></button>
  </section>`);
  const previousDocument = globalThis.document;
  globalThis.document = document;
  try {
    const section = document.querySelector('section');
    const form = section.querySelector('form');
    const editorHours = { ...profile.booking_hours, days: [] };
    let selectedTime = '';
    Object.defineProperty(form.querySelector('[data-booking-time]'), 'value', { configurable: true, get: () => selectedTime, set: value => { selectedTime = String(value); } });
    initBookingEnquiry(section, { id: profileId, booking_hours: editorHours }, { production: false });
    assert.equal(form.querySelector('[data-booking-time]').disabled, true);
    assert.equal(form.querySelector('[data-booking-time]').hasAttribute('name'), false);
    assert.equal(form.querySelector('[data-booking-time-flexible]').disabled, false);
    assert.equal(form.querySelector('[data-booking-time-flexible]').classList.contains('preview-hidden'), false);
    assert.equal(form.querySelector('[data-booking-flexible-label]').classList.contains('preview-hidden'), false);
    assert.equal(form.querySelector('[data-booking-date]').required, false);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
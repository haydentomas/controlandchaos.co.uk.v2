import { createClient } from '@supabase/supabase-js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const reply = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const text = (value, maximum) => typeof value === 'string' && value.trim().length <= maximum ? value.trim() : null;
const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function localDate(timezone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function validRequestedSlot(hours, date, time) {
  if (!hours || typeof hours !== 'object' || typeof hours.timezone !== 'string' || !Array.isArray(hours.days)) return false;
  if (!date && !time && hours.days.length === 0) return true;
  if (!validDate(date) || date < localDate(hours.timezone)) return false;
  if (hours.days.length === 0) return !time || /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  const weekday = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(`${date}T00:00:00Z`).getUTCDay()];
  if (!hours.days.includes(weekday) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time || '')) return false;
  const start = minutes(hours.start_time);
  let end = minutes(hours.end_time);
  if (end <= start) end += 1440;
  const requested = minutes(time);
  for (let slot = start; slot <= end; slot += hours.slot_minutes) if (slot % 1440 === requested) return true;
  return false;
}

function selectedServices(profile, ids) {
  if (!Array.isArray(ids) || ids.length > 300 || ids.some(id => typeof id !== 'string' || !uuid.test(id)) || new Set(ids).size !== ids.length) return null;
  const services = [];
  for (const id of ids) {
    let match;
    for (const category of profile.rate_categories || []) {
      const item = category.items?.find(candidate => candidate.id === id);
      if (item) { match = { category: category.title, ...item }; break; }
    }
    if (!match) return null;
    const amount = Number.parseInt(match.price.replace(/\D/g, ''), 10) || 0;
    services.push({ category: match.category, name: match.name, price: match.price || 'Contact for rates', amount });
  }
  return services;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function parseSubmission(event) {
  if (typeof event.body !== 'string' || Buffer.byteLength(event.body) > 20000) return null;
  try {
    const root = JSON.parse(event.body);
    const payload = root?.payload && typeof root.payload === 'object' ? root.payload : root;
    const data = payload?.data && typeof payload.data === 'object' ? payload.data : root?.data;
    return { formName: payload?.form_name || root?.form_name || data?.['form-name'], data };
  } catch { return null; }
}

export function createBookingSubmissionHandler(environment, clientFactory = createClient, fetchImplementation = fetch) {
  return async event => {
    const submission = parseSubmission(event);
    if (!submission) return reply(400, { message: 'Invalid booking submission.' });
    if (submission.formName !== 'directory-booking') return reply(200, { ignored: true });
    const data = submission.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return reply(400, { message: 'Invalid booking submission.' });
    if (typeof data['bot-field'] === 'string' && data['bot-field'].trim()) return reply(200, { ignored: true });

    const profileId = data.profile_id;
    const clientName = text(data.client_name, 100);
    const clientContact = text(data.client_contact, 254);
    const message = text(data.message || '', 4000);
    const requestedDate = text(data.preferred_date ?? '', 10);
    const requestedTime = text(data.preferred_time ?? '', 5);
    let serviceIds;
    if (typeof data.selected_services !== 'string' && data.selected_services !== undefined) return reply(400, { message: 'Invalid booking submission.' });
    try { serviceIds = JSON.parse(data.selected_services || '[]'); } catch { return reply(400, { message: 'Invalid booking submission.' }); }
    if (!uuid.test(profileId || '') || !clientName || !clientContact || message === null || requestedDate === null || requestedTime === null || !Array.isArray(serviceIds)) return reply(400, { message: 'Invalid booking submission.' });
    if (!environment.SUPABASE_URL || !environment.SUPABASE_URL.startsWith('https://') || !environment.SUPABASE_URL.endsWith('.supabase.co') || !environment.SUPABASE_SECRET_KEY?.startsWith('sb_secret_') || !environment.RESEND_API_KEY) return reply(503, { message: 'Booking notifications are not configured.' });

    try {
      const client = clientFactory(environment.SUPABASE_URL, environment.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      const { data: profiles, error } = await client.rpc('directory_booking_recipient', { target_profile: profileId });
      const profile = Array.isArray(profiles) ? profiles[0] : profiles;
      if (error || !profile || !email.test(profile.recipient_email || '') || !profile.booking_hours) return reply(409, { message: 'Booking is unavailable for this profile.' });
      if (!validRequestedSlot(profile.booking_hours, requestedDate, requestedTime)) return reply(400, { message: 'Choose an available booking date and time.' });
      const services = selectedServices(profile, serviceIds);
      if (!services) return reply(400, { message: 'Selected services have changed. Refresh the profile and try again.' });

      const total = services.reduce((sum, service) => sum + service.amount, 0);
      const quote = services.length ? `L${total.toLocaleString('en-US')}` : 'Standard Rates';
      let scheduledDate = requestedDate;
      let nextDay = false;
      if (requestedDate && requestedTime) {
        const start = minutes(profile.booking_hours.start_time);
        const end = minutes(profile.booking_hours.end_time);
        nextDay = end <= start && minutes(requestedTime) < start;
        if (nextDay) {
          const date = new Date(`${requestedDate}T00:00:00Z`);
          date.setUTCDate(date.getUTCDate() + 1);
          scheduledDate = date.toISOString().slice(0, 10);
        }
      }
      const schedule = requestedDate ? `${scheduledDate}${nextDay ? ' (next day)' : ''}${requestedTime ? ` at ${requestedTime}` : ''} (${profile.booking_hours.timezone})` : 'Flexible';
      const subjectName = profile.display_name.replace(/[\r\n]+/g, ' ').slice(0, 100);
      const serviceLines = services.length
        ? services.map(service => `${service.category} - ${service.name} (${service.price || 'Contact for rates'})`).join('\n')
        : 'No specific services selected';
      const htmlServices = services.length
        ? `<ul>${services.map(service => `<li>${escapeHtml(service.category)} - ${escapeHtml(service.name)} (${escapeHtml(service.price || 'Contact for rates')})</li>`).join('')}</ul>`
        : '<p>No specific services selected.</p>';
      const html = `<h2>New booking enquiry for ${escapeHtml(profile.display_name)}</h2><p><strong>Client:</strong> ${escapeHtml(clientName)}<br><strong>Contact:</strong> ${escapeHtml(clientContact)}<br><strong>Preferred time:</strong> ${escapeHtml(schedule)}<br><strong>Estimated quote:</strong> ${escapeHtml(quote)}</p><h3>Selected services</h3>${htmlServices}<h3>Session notes</h3><p style="white-space:pre-wrap">${escapeHtml(message || 'No additional notes.')}</p><p>Payment is arranged directly in-world after the date and time are confirmed.</p>`;
      const payload = {
        from: environment.RESEND_FROM_EMAIL || 'Control & Chaos <enquiries@controlandchaos.co.uk>',
        to: [profile.recipient_email],
        subject: `Booking enquiry for ${subjectName}: ${quote}`,
        html,
        text: `New booking enquiry for ${profile.display_name}\nClient: ${clientName}\nContact: ${clientContact}\nPreferred time: ${schedule}\nEstimated quote: ${quote}\n\nSelected services:\n${serviceLines}\n\nSession notes:\n${message || 'No additional notes.'}\n\nPayment is arranged directly in-world after the date and time are confirmed.`
      };
      if (email.test(clientContact)) payload.reply_to = clientContact;
      const response = await fetchImplementation('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${environment.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) return reply(503, { message: 'Unable to send this booking enquiry.' });
      return reply(200, { sent: true });
    } catch { return reply(503, { message: 'Unable to send this booking enquiry.' }); }
  };
}

export const handler = event => createBookingSubmissionHandler(process.env)(event);
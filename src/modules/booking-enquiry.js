import { BOOKING_DAYS, BOOKING_TIMEZONES, validateBookingHours } from './booking-hours.js';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

function localDate(timezone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dayKey(date) {
  if (!datePattern.test(date || '')) return '';
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return '';
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][parsed.getUTCDay()];
}

function clock(minutesAfterMidnight) {
  const hour = Math.floor((minutesAfterMidnight % 1440) / 60);
  const minute = minutesAfterMidnight % 60;
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}

export function bookingSlots(hoursValue, date) {
  const hours = validateBookingHours(hoursValue);
  if (!hours || !hours.days.length || !hours.days.includes(dayKey(date))) return [];
  const start = minutes(hours.start_time);
  let end = minutes(hours.end_time);
  if (end <= start) end += 1440;
  const slots = [];
  for (let current = start; current <= end; current += hours.slot_minutes) {
    const value = `${String(Math.floor((current % 1440) / 60)).padStart(2, '0')}:${String(current % 60).padStart(2, '0')}`;
    slots.push({ value, label: `${clock(current)}${current >= 1440 ? ' (next day)' : ''}` });
  }
  return slots;
}

export function initBookingEnquiry(section, profile, { fetchImplementation = fetch, production = import.meta.env?.PROD === true } = {}) {
  const form = section.querySelector('[data-live-booking-form]');
  if (!form || !profile.booking_hours) return;
  const hours = validateBookingHours(profile.booking_hours);
  const dateInput = form.querySelector('[data-booking-date]');
  const timeSelect = form.querySelector('[data-booking-time]');
  const flexibleTime = form.querySelector('[data-booking-time-flexible]');
  const flexibleTimeLabel = form.querySelector('[data-booking-flexible-label]');
  const schedule = section.querySelector('[data-booking-schedule]');
  const status = section.querySelector('[data-booking-status]');
  const submit = section.querySelector('[data-booking-submit]');
  const profileId = form.querySelector('[name="profile_id"]');
  const selectedServices = form.querySelector('[name="selected_services"]');
  const hasRegularDays = hours.days.length > 0;
  const timezoneLabel = BOOKING_TIMEZONES.find(([timezone]) => timezone === hours.timezone)?.[1] || hours.timezone;
  const dayLabels = hours.days.map(day => BOOKING_DAYS.find(([key]) => key === day)?.[1]).filter(Boolean).join(', ');

  profileId.value = profile.id;
  dateInput.min = localDate(hours.timezone);
  dateInput.required = hasRegularDays;
  timeSelect.required = hasRegularDays;
  flexibleTime.disabled = hasRegularDays;
  if (!hasRegularDays) {
    timeSelect.removeAttribute('name');
    timeSelect.disabled = true;
    timeSelect.classList.add('preview-hidden');
    flexibleTime.name = 'preferred_time';
    flexibleTime.classList.remove('preview-hidden');
    flexibleTimeLabel?.classList.remove('preview-hidden');
  } else {
    flexibleTime.removeAttribute('name');
    timeSelect.name = 'preferred_time';
    flexibleTime.classList.add('preview-hidden');
    flexibleTimeLabel?.classList.add('preview-hidden');
  }
  schedule.textContent = hasRegularDays
    ? `Active Booking Hours: ${hours.start_time} - ${hours.end_time} (${timezoneLabel}; ${dayLabels}). Select a date to see available time slots.`
    : `No regular booking days are listed (${timezoneLabel}). You can still request a flexible time and explain it in your notes.`;

  const updateSlots = () => {
    timeSelect.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = dateInput.value ? `No available times on ${BOOKING_DAYS.find(([key]) => key === dayKey(dateInput.value))?.[1] || 'this date'}` : 'Select a date first...';
    timeSelect.append(placeholder);
    const slots = bookingSlots(hours, dateInput.value);
    if (slots.length) {
      placeholder.textContent = 'Choose an available time slot';
      for (const slot of slots) {
        const option = document.createElement('option');
        option.value = slot.value;
        option.textContent = `${slot.label} ${timezoneLabel}`;
        timeSelect.append(option);
      }
    }
    timeSelect.value = '';
  };
  dateInput.addEventListener('change', updateSlots);
  updateSlots();

  form.addEventListener('submit', async event => {
    event.preventDefault();
    status.textContent = '';
    if (!production) {
      status.textContent = 'Booking enquiries are disabled in the local preview.';
      return;
    }
    if (!form.reportValidity()) return;
    if (!hasRegularDays && flexibleTime.value && !dateInput.value) {
      status.textContent = 'Choose a preferred date when entering a preferred time.';
      dateInput.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Sending Enquiry...';
    try {
      const body = new URLSearchParams(new FormData(form)).toString();
      const response = await fetchImplementation('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      });
      if (!response.ok) throw new Error('submission failed');
      const serviceIds = selectedServices.value;
      form.reset();
      profileId.value = profile.id;
      selectedServices.value = serviceIds;
      updateSlots();
      status.textContent = 'Your request was received. The creator will follow up using the contact details you provided.';
    } catch {
      status.textContent = 'The enquiry could not be sent. Please try again or contact the creator in-world.';
    } finally {
      submit.disabled = false;
      submit.textContent = 'Submit Booking Enquiry';
    }
  });
}
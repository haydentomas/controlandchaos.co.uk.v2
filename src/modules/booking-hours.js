import { renderRichText } from './profile-rich-text.js';
import { initRichTextEditor } from './rich-text-editor.js';

export const BOOKING_TIMEZONES = [
  ['America/Los_Angeles', 'Second Life Time (Pacific)'],
  ['America/New_York', 'US Eastern'],
  ['Europe/London', 'UK / London'],
  ['Europe/Berlin', 'Central Europe'],
  ['Etc/UTC', 'UTC']
];
export const BOOKING_DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
export const DEFAULT_BOOKING_HOURS = { timezone: 'America/Los_Angeles', days: [], start_time: '12:00', end_time: '22:00', slot_minutes: 60, notes: '' };
const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

export function validateBookingHours(hours) {
  if (hours === null) return null;
  if (!hours || typeof hours !== 'object' || Array.isArray(hours) || Object.keys(hours).some(field => !['timezone', 'days', 'start_time', 'end_time', 'slot_minutes', 'notes'].includes(field))) throw new Error('Invalid booking hours.');
  if (!BOOKING_TIMEZONES.some(([zone]) => zone === hours.timezone)) throw new Error('Choose a supported booking timezone.');
  if (!Array.isArray(hours.days) || hours.days.length > 7 || new Set(hours.days).size !== hours.days.length || hours.days.some(day => !BOOKING_DAYS.some(([value]) => value === day))) throw new Error('Choose valid, non-duplicate availability days.');
  if (![hours.start_time, hours.end_time].every(time => typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time))) throw new Error('Use valid start and end times.');
  if (![30, 60, 120].includes(hours.slot_minutes)) throw new Error('Choose a 30, 60 or 120 minute interval.');
  if (typeof hours.notes !== 'string' || hours.notes.length > 1000) throw new Error('Booking notes must be at most 1,000 characters.');
  const duration = (minutes(hours.end_time) - minutes(hours.start_time) + 1440) % 1440;
  if (!duration) throw new Error('Start and end times must differ.');
  if (hours.days.length && duration < hours.slot_minutes) throw new Error('Booking window must fit at least one interval.');
  return { timezone: hours.timezone, days: BOOKING_DAYS.map(([day]) => day).filter(day => hours.days.includes(day)), start_time: hours.start_time, end_time: hours.end_time, slot_minutes: hours.slot_minutes, notes: hours.notes.trim() };
}

export function bookingLocalTime(hours, date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: hours.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

export function renderBookingHours(container, value) {
  container.replaceChildren();
  const hours = validateBookingHours(value);
  if (!hours) return;
  const timeRow = document.createElement('div');
  timeRow.className = 'public-booking-hours-time-row';
  const time = document.createElement('span');
  time.className = 'public-booking-hours-time';
  const overnight = minutes(hours.end_time) < minutes(hours.start_time);
  time.textContent = `${hours.start_time} - ${hours.end_time}${overnight ? ' (next day)' : ''}`;
  timeRow.append(time);
  container.append(timeRow);

  const timezone = document.createElement('p');
  timezone.className = 'public-booking-hours-timezone';
  timezone.textContent = `${BOOKING_TIMEZONES.find(([zone]) => zone === hours.timezone)[1]} (${hours.timezone})`;
  container.append(timezone);

  if (!hours.days.length) {
    const unavailable = document.createElement('p');
    unavailable.className = 'public-booking-hours-empty';
    unavailable.textContent = 'No regular booking days currently available.';
    container.append(unavailable);
  } else {
    const days = document.createElement('ul');
    days.className = 'public-booking-hours-days';
    days.setAttribute('aria-label', 'Available booking days');
    for (const day of hours.days) {
      const item = document.createElement('li');
      item.textContent = BOOKING_DAYS.find(([value]) => value === day)[1];
      days.append(item);
    }
    container.append(days);
    const interval = document.createElement('p');
    interval.className = 'public-booking-hours-interval';
    interval.textContent = `Appointments every ${hours.slot_minutes} minutes`;
    container.append(interval);
  }
  if (hours.notes) {
    const notes = document.createElement('div');
    notes.className = 'public-booking-hours-notes';
    renderRichText(notes, hours.notes);
    container.append(notes);
  }
}

export function initBookingHoursEditor(container) {
  const enabled = container.querySelector('[data-booking-enabled]');
  const fields = container.querySelector('[data-booking-fields]');
  const timezone = container.querySelector('[data-booking-timezone]');
  const start = container.querySelector('[data-booking-start]');
  const end = container.querySelector('[data-booking-end]');
  const interval = container.querySelector('[data-booking-interval]');
  const notes = container.querySelector('[data-booking-notes]');
  const notesEditor = initRichTextEditor(notes);
  const checkboxes = [...container.querySelectorAll('[data-booking-day]')];
  for (const [zone, label] of BOOKING_TIMEZONES) {
    const option = document.createElement('option');
    option.value = zone;
    option.textContent = label;
    timezone.append(option);
  }
  const toggle = () => { fields.disabled = !enabled.checked; };
  enabled.addEventListener('change', toggle);
  return {
    load(value) {
      const hours = validateBookingHours(value ?? null) || DEFAULT_BOOKING_HOURS;
      enabled.checked = value != null;
      timezone.value = hours.timezone;
      start.value = hours.start_time;
      end.value = hours.end_time;
      interval.value = String(hours.slot_minutes);
      notesEditor.load(hours.notes);
      for (const input of checkboxes) input.checked = hours.days.includes(input.dataset.bookingDay);
      toggle();
    },
    value() {
      notesEditor.flush();
      return enabled.checked ? validateBookingHours({ timezone: timezone.value, days: checkboxes.filter(input => input.checked).map(input => input.dataset.bookingDay), start_time: start.value, end_time: end.value, slot_minutes: Number(interval.value), notes: notes.value }) : null;
    }
  };
}
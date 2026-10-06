import { renderRichText } from './profile-rich-text.js';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const RATE_CATEGORY_LIMIT = 20;
export const RATE_ITEM_LIMIT = 30;
export const RATE_TOTAL_ITEM_LIMIT = 300;

export function validateRateCategories(categories) {
  if (!Array.isArray(categories) || categories.length > RATE_CATEGORY_LIMIT) throw new Error('Use up to 20 rate categories.');
  const identifiers = new Set();
  let count = 0;
  const identity = value => {
    if (typeof value !== 'string' || !uuid.test(value) || identifiers.has(value)) throw new Error('Invalid or duplicate rate item identifier.');
    identifiers.add(value);
    return value;
  };
  const text = (value, maximum, required = false) => {
    if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) throw new Error('Check rate titles, descriptions, prices and units.');
    return value.trim();
  };
  const fields = (value, allowed) => {
    if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(field => !allowed.includes(field))) throw new Error('Invalid rate card fields.');
  };
  const result = categories.map(category => {
    fields(category, ['id', 'title', 'description', 'items']);
    const id = identity(category.id);
    if (!Array.isArray(category.items) || category.items.length > RATE_ITEM_LIMIT) throw new Error('Use up to 30 services per category.');
    return { id, title: text(category.title, 100, true), description: text(category.description, 1000), items: category.items.map(item => {
      fields(item, ['id', 'name', 'price', 'unit', 'description']);
      if (++count > RATE_TOTAL_ITEM_LIMIT) throw new Error('Use up to 300 services in total.');
      return { id: identity(item.id), name: text(item.name, 100, true), price: text(item.price, 100), unit: text(item.unit, 100), description: text(item.description, 2000) };
    }) };
  });
  if (new TextEncoder().encode(JSON.stringify(result)).length > 250000) throw new Error('Rate cards are too large.');
  return result;
}

export function renderPublicRateCards(container, categories, { bookingEnabled = false, onSelectionChange = () => {} } = {}) {
  container.replaceChildren();
  const selected = new Map();
  for (const category of validateRateCategories(categories)) {
    if (!category.items.length) continue;
    const section = document.createElement('section');
    section.className = 'public-rate-category';
    const header = document.createElement('div');
    header.className = 'public-rate-category-header';
    const heading = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = category.title;
    const description = document.createElement('div');
    description.className = 'text-muted public-rate-category-description';
    renderRichText(description, category.description);
    heading.append(title);
    if (category.description) heading.append(description);
    const instruction = document.createElement('span');
    instruction.className = 'public-rate-category-instruction';
    instruction.textContent = 'Click to select';
    header.append(heading, instruction);
    section.append(header);
    for (const item of category.items) {
      const row = document.createElement('article');
      row.className = 'service-select-card';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'service-select-toggle';
      toggle.setAttribute('aria-pressed', 'false');
      toggle.setAttribute('aria-label', `${item.name}, ${item.price || 'Contact for rates'}, ${item.unit || 'per session'}`);
      const copy = document.createElement('div');
      copy.className = 'service-select-copy';
      const checkbox = document.createElement('span');
      checkbox.className = 'service-check-box';
      checkbox.setAttribute('aria-hidden', 'true');
      const checkmark = document.createElement('span');
      checkmark.className = 'service-check-mark';
      checkmark.textContent = '\u2713';
      checkbox.append(checkmark);
      const name = document.createElement('span');
      name.className = 'service-select-name';
      name.textContent = item.name;
      toggle.append(checkbox, name);
      const pricing = document.createElement('span');
      pricing.className = 'service-select-pricing';
      const price = document.createElement('span');
      price.className = 'service-select-price';
      price.textContent = item.price || 'Contact for rates';
      const unit = document.createElement('span');
      unit.className = 'service-select-unit';
      unit.textContent = item.unit || 'per session';
      pricing.append(price, unit);
      copy.append(toggle);
      if (item.description) {
        const details = document.createElement('div');
        details.className = 'service-select-details rich-text-content';
        renderRichText(details, item.description);
        copy.append(details);
      }
      row.append(copy, pricing);
      const numericPrice = Number.parseInt(item.price.replace(/\D/g, ''), 10) || 0;
      row.addEventListener('click', event => {
        if (event.target.closest('a')) return;
        if (selected.has(item.id)) selected.delete(item.id);
        else selected.set(item.id, { id: item.id, name: item.name, category: category.title, amount: numericPrice });
        const isSelected = selected.has(item.id);
        toggle.setAttribute('aria-pressed', String(isSelected));
        row.dataset.selected = String(isSelected);
        updateQuote();
      });
      section.append(row);
    }
    container.append(section);
  }

  if (!container.querySelector('.public-rate-category')) return;
  const quote = document.createElement('div');
  quote.className = 'public-profile-rate-quote';
  quote.hidden = true;
  quote.setAttribute('aria-live', 'polite');
  const summary = document.createElement('div');
  const label = document.createElement('div');
  label.className = 'public-profile-rate-quote-label';
  label.textContent = 'Selected Services Quote';
  const values = document.createElement('div');
  values.className = 'public-profile-rate-quote-values';
  const total = document.createElement('span');
  total.className = 'public-profile-rate-quote-total';
  const count = document.createElement('span');
  count.className = 'public-profile-rate-quote-count';
  values.append(total, count);
  summary.append(label, values);
  const action = document.createElement('a');
  action.className = 'btn btn-gold btn-sm public-profile-rate-quote-action';
  action.href = '#booking-enquiry-section';
  action.textContent = 'Book with Selected Services';
  action.hidden = !bookingEnabled;
  quote.append(summary, action);
  container.append(quote);

  function updateQuote() {
    const values = [...selected.values()];
    total.textContent = `L${values.reduce((sum, value) => sum + value.amount, 0).toLocaleString('en-US')}`;
    count.textContent = `(${values.length} selected)`;
    quote.hidden = values.length === 0 || !bookingEnabled;
    onSelectionChange(values);
  }
}
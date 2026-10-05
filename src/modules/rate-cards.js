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

export function renderPublicRateCards(container, categories) {
  container.replaceChildren();
  for (const category of validateRateCategories(categories)) {
    if (!category.items.length) continue;
    const section = document.createElement('section');
    section.className = 'public-rate-category';
    const title = document.createElement('h3');
    title.className = 'account-subheading';
    title.textContent = category.title;
    const description = document.createElement('div');
    description.className = 'text-muted';
    renderRichText(description, category.description);
    section.append(title, description);
    for (const item of category.items) {
      const row = document.createElement('article');
      row.className = 'public-rate-item';
      const heading = document.createElement('h4');
      heading.textContent = item.name;
      const price = document.createElement('p');
      price.className = 'text-gold font-bold';
      price.textContent = [item.price || 'Contact for rates', item.unit].filter(Boolean).join(' / ');
      const details = document.createElement('div');
      renderRichText(details, item.description);
      row.append(heading, price, details);
      section.append(row);
    }
    container.append(section);
  }
}
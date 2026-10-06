import { validateRateCategories, RATE_CATEGORY_LIMIT, RATE_ITEM_LIMIT, RATE_TOTAL_ITEM_LIMIT } from './rate-cards.js';
import { initRichTextEditor, flushRichTextEditors } from './rich-text-editor.js';

export function initRateCardEditor(container, addCategory) {
  let categories = [];
  let textEditors = [];
  const element = (tag, className = '') => {
    const node = document.createElement(tag);
    node.className = className;
    return node;
  };
  const field = (parent, model, name, labelText, maximum, required = false) => {
    const group = element('div');
    const label = element('label', 'form-label');
    const input = element(name === 'description' ? 'textarea' : 'input', name === 'description' ? 'form-textarea' : 'form-input');
    input.id = `rate-${model.id}-${name}`;
    label.htmlFor = input.id;
    label.textContent = labelText;
    input.value = model[name];
    input.maxLength = maximum;
    input.required = required;
    if (input.tagName === 'TEXTAREA') input.rows = 2;
    else input.type = 'text';
    input.addEventListener('input', () => { model[name] = input.value; });
    group.append(label, input);
    parent.append(group);
    if (name === 'description') textEditors.push(initRichTextEditor(input));
  };
  const button = (text, title, action, disabled = false) => {
    const control = element('button', 'btn btn-secondary btn-sm');
    control.type = 'button';
    control.textContent = text;
    control.title = title;
    control.setAttribute('aria-label', title);
    control.disabled = disabled;
    control.addEventListener('click', () => {
      if (container.closest('fieldset')?.disabled) return;
      action();
    });
    return control;
  };
  const move = (list, index, offset) => {
    const target = index + offset;
    if (target < 0 || target >= list.length) return;
    const [moved] = list.splice(index, 1);
    list.splice(target, 0, moved);
    paint();
    document.getElementById(`rate-${moved.id}-${moved.items ? 'title' : 'name'}`)?.focus();
  };
  const paint = () => {
    for (const editor of textEditors) editor.destroy();
    textEditors = [];
    container.replaceChildren();
    const total = categories.reduce((count, category) => count + category.items.length, 0);
    addCategory.disabled = categories.length >= RATE_CATEGORY_LIMIT;
    if (!categories.length) {
      const empty = element('p', 'text-muted');
      empty.textContent = 'No rate categories yet.';
      container.append(empty);
    }
    categories.forEach((category, categoryIndex) => {
      const section = element('section', 'rate-editor-category');
      section.dataset.rateCategory = category.id;
      const toolbar = element('div', 'creator-editor-toolbar');
      const heading = element('h3', 'account-subheading');
      heading.textContent = `Category ${categoryIndex + 1}`;
      toolbar.append(heading,
        button('\u2191', 'Move category up', () => move(categories, categoryIndex, -1), categoryIndex === 0),
        button('\u2193', 'Move category down', () => move(categories, categoryIndex, 1), categoryIndex === categories.length - 1),
        button('Remove category', 'Remove category', () => { categories.splice(categoryIndex, 1); paint(); }));
      section.append(toolbar);
      container.append(section);
      field(section, category, 'title', 'Category title', 100, true);
      field(section, category, 'description', 'Category description', 1000);
      const services = element('div', 'rate-editor-services');
      section.append(services);
      category.items.forEach((item, itemIndex) => {
        const row = element('div', 'rate-editor-item');
        row.dataset.rateItem = item.id;
        const controls = element('div', 'creator-editor-toolbar');
        const label = element('h4');
        label.textContent = `Service ${itemIndex + 1}`;
        controls.append(label,
          button('\u2191', 'Move service up', () => move(category.items, itemIndex, -1), itemIndex === 0),
          button('\u2193', 'Move service down', () => move(category.items, itemIndex, 1), itemIndex === category.items.length - 1),
          button('Remove service', 'Remove service', () => { category.items.splice(itemIndex, 1); paint(); }));
        row.append(controls);
        services.append(row);
        field(row, item, 'name', 'Service name', 100, true);
        const priceFields = element('div', 'form-grid-2');
        field(priceFields, item, 'price', 'Price', 100);
        field(priceFields, item, 'unit', 'Duration / unit', 100);
        row.append(priceFields);
        field(row, item, 'description', 'Service description', 2000);
        services.append(row);
      });
      section.append(services, button('Add service', 'Add service', () => {
        category.items.push({ id: crypto.randomUUID(), name: '', price: '', unit: '', description: '' });
        paint();
        document.getElementById(`rate-${category.items.at(-1).id}-name`)?.focus();
      }, category.items.length >= RATE_ITEM_LIMIT || total >= RATE_TOTAL_ITEM_LIMIT));
      container.append(section);
    });
  };
  addCategory.addEventListener('click', () => {
    if (container.closest('fieldset')?.disabled || categories.length >= RATE_CATEGORY_LIMIT) return;
    categories.push({ id: crypto.randomUUID(), title: '', description: '', items: [] });
    paint();
    document.getElementById(`rate-${categories.at(-1).id}-title`)?.focus();
  });
  return {
    load(value) { categories = validateRateCategories(value || []); paint(); },
    clear() { categories = []; paint(); },
    value() { flushRichTextEditors(container); return validateRateCategories(categories); }
  };
}
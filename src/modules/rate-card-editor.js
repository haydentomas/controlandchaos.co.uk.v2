import { validateRateCategories, RATE_CATEGORY_LIMIT, RATE_ITEM_LIMIT, RATE_TOTAL_ITEM_LIMIT } from './rate-cards.js';
import { initRichTextEditor, flushRichTextEditors, COMPACT_RICH_TEXT_OPTIONS } from './rich-text-editor.js';

export function initRateCardEditor(container, addCategory) {
  let categories = [];
  let textEditors = [];
  let expandedCategoryId = null;
  let expandedServiceId = null;
  const element = (tag, className = '') => {
    const node = document.createElement(tag);
    node.className = className;
    return node;
  };
  const field = (parent, model, name, labelText, maximum, required = false, editorOptions, richTextEnabled = true) => {
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
    if (name === 'description' && richTextEnabled) textEditors.push(initRichTextEditor(input, editorOptions));
    return input;
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
    const focusField = moved.items
      ? expandedCategoryId === moved.id ? 'title' : 'category-toggle'
      : expandedServiceId === moved.id ? 'name' : 'toggle';
    document.getElementById(`rate-${moved.id}-${focusField}`)?.focus();
  };
  const paint = () => {
    flushRichTextEditors(container);
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
      const expanded = category.id === expandedCategoryId;
      const details = element('div', 'rate-category-details');
      details.id = `rate-${category.id}-details`;
      details.hidden = !expanded;
      const toolbar = element('div', 'creator-editor-toolbar');
      const summaryButton = element('button', 'rate-category-toggle');
      summaryButton.type = 'button';
      summaryButton.id = `rate-${category.id}-category-toggle`;
      summaryButton.dataset.rateCategoryToggle = '';
      summaryButton.setAttribute('aria-expanded', String(expanded));
      summaryButton.setAttribute('aria-controls', details.id);
      const summaryCopy = element('span', 'rate-category-summary-copy');
      const summaryTitle = element('span', 'rate-category-summary-title');
      const summaryMeta = element('span', 'rate-category-summary-meta');
      summaryCopy.append(summaryTitle, summaryMeta);
      const summaryAction = element('span', 'rate-category-summary-action');
      summaryAction.textContent = expanded ? 'Close' : 'Edit';
      summaryButton.append(summaryCopy, summaryAction);
      const updateSummary = () => {
        summaryTitle.textContent = category.title.trim() || `Untitled category ${categoryIndex + 1}`;
        summaryMeta.textContent = `${category.items.length} ${category.items.length === 1 ? 'service' : 'services'}`;
        summaryButton.setAttribute('aria-label', `${expanded ? 'Close' : 'Edit'} category ${categoryIndex + 1}: ${category.title.trim() || 'Untitled category'}`);
      };
      updateSummary();
      summaryButton.addEventListener('click', () => {
        const nextCategoryId = expanded ? null : category.id;
        if (expandedServiceId && !category.items.some(item => item.id === expandedServiceId)) expandedServiceId = null;
        expandedCategoryId = nextCategoryId;
        paint();
        document.getElementById(`rate-${category.id}-category-toggle`)?.focus();
      });
      toolbar.append(summaryButton,
        button('\u2191', 'Move category up', () => move(categories, categoryIndex, -1), categoryIndex === 0),
        button('\u2193', 'Move category down', () => move(categories, categoryIndex, 1), categoryIndex === categories.length - 1),
        button('Remove category', 'Remove category', () => {
          if (expandedServiceId && category.items.some(item => item.id === expandedServiceId)) expandedServiceId = null;
          if (expandedCategoryId === category.id) expandedCategoryId = null;
          categories.splice(categoryIndex, 1);
          paint();
        }));
      section.append(toolbar, details);
      container.append(section);
      const titleInput = field(details, category, 'title', 'Category title', 100, expanded);
      titleInput.addEventListener('input', updateSummary);
      field(details, category, 'description', 'Category description', 1000, false, COMPACT_RICH_TEXT_OPTIONS, expanded);
      const services = element('div', 'rate-editor-services');
      details.append(services);
      category.items.forEach((item, itemIndex) => {
        const row = element('div', 'rate-editor-item');
        row.dataset.rateItem = item.id;
        const expanded = item.id === expandedServiceId;
        const details = element('div', 'rate-service-details');
        details.id = `rate-${item.id}-details`;
        details.hidden = !expanded;
        const summaryButton = element('button', 'rate-service-toggle');
        summaryButton.type = 'button';
        summaryButton.id = `rate-${item.id}-toggle`;
        summaryButton.dataset.rateServiceToggle = '';
        summaryButton.setAttribute('aria-expanded', String(expanded));
        summaryButton.setAttribute('aria-controls', details.id);
        const summaryCopy = element('span', 'rate-service-summary-copy');
        const summaryName = element('span', 'rate-service-summary-name');
        const summaryMeta = element('span', 'rate-service-summary-meta');
        summaryCopy.append(summaryName, summaryMeta);
        const summaryAction = element('span', 'rate-service-summary-action');
        summaryAction.textContent = expanded ? 'Close' : 'Edit';
        summaryButton.append(summaryCopy, summaryAction);
        const updateSummary = () => {
          summaryName.textContent = item.name.trim() || `Untitled service ${itemIndex + 1}`;
          summaryMeta.textContent = [item.price.trim(), item.unit.trim()].filter(Boolean).join(' | ') || 'Price and duration not set';
          summaryButton.setAttribute('aria-label', `${expanded ? 'Close' : 'Edit'} service ${itemIndex + 1}: ${item.name.trim() || 'Untitled service'}`);
        };
        updateSummary();
        summaryButton.addEventListener('click', () => {
          expandedServiceId = expanded ? null : item.id;
          paint();
          document.getElementById(`rate-${item.id}-toggle`)?.focus();
        });
        const controls = element('div', 'creator-editor-toolbar');
        const label = element('h4');
        label.textContent = `Service ${itemIndex + 1}`;
        controls.append(label,
          button('\u2191', 'Move service up', () => move(category.items, itemIndex, -1), itemIndex === 0),
          button('\u2193', 'Move service down', () => move(category.items, itemIndex, 1), itemIndex === category.items.length - 1),
          button('Remove service', 'Remove service', () => { if (expandedServiceId === item.id) expandedServiceId = null; category.items.splice(itemIndex, 1); paint(); }));
        const header = element('div', 'rate-service-header');
        header.append(summaryButton, controls);
        row.append(header, details);
        services.append(row);
        const nameInput = field(details, item, 'name', 'Service name', 100, expanded);
        nameInput.addEventListener('input', updateSummary);
        const priceFields = element('div', 'form-grid-2');
        const priceInput = field(priceFields, item, 'price', 'Price', 100);
        const unitInput = field(priceFields, item, 'unit', 'Duration / unit', 100);
        priceInput.addEventListener('input', updateSummary);
        unitInput.addEventListener('input', updateSummary);
        details.append(priceFields);
        field(details, item, 'description', 'Service description', 2000, false, COMPACT_RICH_TEXT_OPTIONS, expanded);
      });
      details.append(button('Add service', 'Add service', () => {
        const item = { id: crypto.randomUUID(), name: '', price: '', unit: '', description: '' };
        category.items.push(item);
        expandedServiceId = item.id;
        paint();
        document.getElementById(`rate-${item.id}-name`)?.focus();
      }, category.items.length >= RATE_ITEM_LIMIT || total >= RATE_TOTAL_ITEM_LIMIT));
      container.append(section);
    });
  };
  addCategory.addEventListener('click', () => {
    if (container.closest('fieldset')?.disabled || categories.length >= RATE_CATEGORY_LIMIT) return;
    const category = { id: crypto.randomUUID(), title: '', description: '', items: [] };
    categories.push(category);
    expandedCategoryId = category.id;
    expandedServiceId = null;
    paint();
    document.getElementById(`rate-${category.id}-title`)?.focus();
  });
  return {
    load(value) { categories = validateRateCategories(value || []); expandedCategoryId = null; expandedServiceId = null; paint(); },
    clear() { categories = []; expandedCategoryId = null; expandedServiceId = null; paint(); },
    value() { flushRichTextEditors(container); return validateRateCategories(categories); }
  };
}
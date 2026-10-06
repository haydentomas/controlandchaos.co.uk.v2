function text(value, maximum, required = false) {
  if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) throw new Error('Check repeater titles, descriptions and links.');
  return value.trim();
}

function object(value, allowed) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(name => !allowed.includes(name))) throw new Error('Invalid repeater item fields.');
}

export function validateHardwareItems(items) {
  if (!Array.isArray(items) || items.length > 30) throw new Error('Use up to 30 toy or compatibility items.');
  return items.map(item => {
    object(item, ['name', 'desc', 'icon', 'badge_text']);
    return {
      name: text(item.name, 100, true),
      desc: text(item.desc ?? '', 300),
      icon: text(item.icon ?? '', 16),
      badge_text: text(item.badge_text ?? '', 40)
    };
  });
}

function safeWishlistUrl(value) {
  const url = text(value ?? '', 2048);
  if (!url) return '';
  if (/[\s\\]/.test(url) || url.startsWith('//')) throw new Error('Wishlist links must use a safe HTTPS URL.');
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('unsafe');
  } catch { throw new Error('Wishlist links must use a safe HTTPS URL.'); }
  return url;
}

export function validateWishlistItems(items) {
  if (!Array.isArray(items) || items.length > 20) throw new Error('Use up to 20 wishlist links.');
  return items.map(item => {
    object(item, ['title', 'url', 'note']);
    return {
      title: text(item.title, 100, true),
      url: safeWishlistUrl(item.url),
      note: text(item.note ?? '', 300)
    };
  });
}

export function initProfileCollectionEditor(container, addButton, { kind, fields, validate, createItem, limit }) {
  let items = [];
  const element = (tag, className = '') => {
    const node = document.createElement(tag);
    node.className = className;
    return node;
  };
  const button = (label, name, action, disabled = false) => {
    const control = element('button', 'btn btn-secondary btn-sm');
    control.type = 'button';
    control.textContent = label;
    control.title = name;
    control.setAttribute('aria-label', name);
    control.disabled = disabled;
    control.addEventListener('click', () => {
      if (!container.closest('fieldset')?.disabled) action();
    });
    return control;
  };
  const focusItem = index => container.querySelector(`[data-collection-item="${kind}-${index}"] input`)?.focus();
  const paint = () => {
    container.replaceChildren();
    addButton.disabled = items.length >= limit;
    if (!items.length) {
      const empty = element('p', 'text-muted');
      empty.textContent = kind === 'toys' ? 'No toy or compatibility items yet.' : 'No wishlist links yet.';
      container.append(empty);
    }
    items.forEach((item, index) => {
      const card = element('section', 'profile-collection-editor-item');
      card.dataset.collectionItem = `${kind}-${index}`;
      const toolbar = element('div', 'creator-editor-toolbar');
      const heading = element('h3', 'account-subheading');
      heading.textContent = `${kind === 'toys' ? 'Item' : 'Wishlist'} ${index + 1}`;
      const move = offset => {
        const target = index + offset;
        if (target < 0 || target >= items.length) return;
        const [moved] = items.splice(index, 1);
        items.splice(target, 0, moved);
        paint();
        focusItem(target);
      };
      toolbar.append(heading,
        button('\u2191', `Move ${kind === 'toys' ? 'item' : 'wishlist'} up`, () => move(-1), index === 0),
        button('\u2193', `Move ${kind === 'toys' ? 'item' : 'wishlist'} down`, () => move(1), index === items.length - 1),
        button(`Remove ${kind === 'toys' ? 'item' : 'wishlist'}`, `Remove ${kind === 'toys' ? 'item' : 'wishlist'}`, () => { items.splice(index, 1); paint(); }));
      card.append(toolbar);
      const grid = element('div', 'form-grid-2');
      for (const [name, labelText, maximum, type] of fields) {
        const group = element('div');
        const label = element('label', 'form-label');
        const input = element(type === 'textarea' ? 'textarea' : 'input', type === 'textarea' ? 'form-textarea' : 'form-input');
        input.id = `${kind}-${index}-${name}`;
        input.name = `${kind}[${index}][${name}]`;
        input.value = item[name] || '';
        input.maxLength = maximum;
        input.required = name === 'name' || name === 'title';
        if (type === 'textarea') input.rows = 2;
        else input.type = type || 'text';
        label.htmlFor = input.id;
        label.textContent = labelText;
        input.addEventListener('input', () => { item[name] = input.value; });
        group.append(label, input);
        grid.append(group);
      }
      card.append(grid);
      container.append(card);
    });
  };
  addButton.addEventListener('click', () => {
    if (container.closest('fieldset')?.disabled || items.length >= limit) return;
    items.push(createItem());
    paint();
    focusItem(items.length - 1);
  });
  return {
    load(value) { items = validate(value ?? []); paint(); },
    clear() { items = []; paint(); },
    value() { return validate(items); }
  };
}

export const HARDWARE_FIELDS = [
  ['name', 'Toy / feature name', 100, 'text'],
  ['desc', 'Description', 300, 'text'],
  ['icon', 'Icon emoji', 16, 'text'],
  ['badge_text', 'Status badge', 40, 'text']
];

export const WISHLIST_FIELDS = [
  ['title', 'Platform / item title', 100, 'text'],
  ['url', 'HTTPS link (optional)', 2048, 'url'],
  ['note', 'Note / description', 300, 'text']
];

export const createHardwareItem = () => ({ name: '', desc: '', icon: '\u{1F50C}', badge_text: '' });
export const createWishlistItem = () => ({ title: '', url: '', note: '' });

export function renderHardwareItems(container, value) {
  container.replaceChildren();
  for (const item of validateHardwareItems(value || [])) {
    const card = document.createElement('article');
    card.className = 'public-hardware-item';
    const icon = document.createElement('span');
    icon.className = 'public-hardware-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = item.icon || '\u{1F50C}';
    const copy = document.createElement('div');
    copy.className = 'public-hardware-copy';
    const name = document.createElement('h3');
    name.textContent = item.name;
    copy.append(name);
    if (item.desc) {
      const description = document.createElement('p');
      description.textContent = item.desc;
      copy.append(description);
    }
    card.append(icon, copy);
    if (item.badge_text) {
      const badge = document.createElement('span');
      badge.className = 'public-hardware-badge';
      badge.textContent = item.badge_text;
      card.append(badge);
    }
    container.append(card);
  }
}

export function renderWishlistItems(container, value) {
  container.replaceChildren();
  for (const item of validateWishlistItems(value || [])) {
    const row = document.createElement('article');
    row.className = 'public-wishlist-item';
    const copy = document.createElement('div');
    copy.className = 'public-wishlist-copy';
    const title = document.createElement('h3');
    title.textContent = item.title;
    copy.append(title);
    if (item.note) {
      const note = document.createElement('p');
      note.textContent = item.note;
      copy.append(note);
    }
    row.append(copy);
    if (item.url) {
      const link = document.createElement('a');
      link.className = 'btn btn-secondary btn-sm';
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer nofollow';
      link.textContent = 'View';
      row.append(link);
    }
    container.append(row);
  }
}

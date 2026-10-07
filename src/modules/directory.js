import { createPublicDirectoryClient, directoryConfig, DIRECTORY_PAGE_SIZE, fetchDirectory, publicImageUrl } from './directory-api.js';
import { richTextSummary } from './profile-rich-text.js';

export function directoryCard(template, profile) {
  const card = template.content.firstElementChild.cloneNode(true);
  const fill = (selector, value) => { card.querySelector(selector).textContent = value || ''; };
  fill('[data-directory-name]', profile.display_name);
  fill('[data-directory-username]', `@${profile.sl_username || ''}`);
  fill('[data-directory-role]', { domme: 'Dominant / Domme', sub: 'Submissive', switch: 'Switch' }[profile.role_type] || 'Creator');
  fill('[data-directory-headline]', profile.headline);
  fill('[data-directory-tagline]', richTextSummary(profile.tagline, card.ownerDocument));
  fill('[data-directory-rate]', profile.starting_rate || 'Contact for rates');
  fill('[data-directory-availability]', { available: 'Available', busy: 'Busy', away: 'Away', offline: 'Offline' }[profile.availability] || 'Unavailable');
  card.querySelector('[data-directory-availability]').classList.toggle('traffic-live', profile.availability === 'available');
  const avatar = card.querySelector('[data-directory-avatar]');
  const src = publicImageUrl(profile.avatar_image);
  if (src) {
    const image = document.createElement('img');
    image.src = src;
    image.alt = profile.display_name || 'Profile';
    image.loading = 'lazy';
    image.addEventListener('error', () => { avatar.textContent = (profile.display_name || '?').slice(0, 1); });
    avatar.appendChild(image);
  } else avatar.textContent = (profile.display_name || '?').slice(0, 1);
  for (const tag of Array.isArray(profile.tags) ? profile.tags : []) {
    const badge = document.createElement('span');
    badge.className = 'tag-pill-badge';
    badge.textContent = String(tag);
    card.querySelector('[data-directory-tags]').appendChild(badge);
  }
  card.querySelector('[data-directory-link]').href = `/directory-profile?slug=${encodeURIComponent(profile.slug)}`;
  return card;
}

export function initDirectory() {
  const grid = document.querySelector('[data-directory-grid]');
  const template = document.querySelector('[data-directory-card]');
  const status = document.querySelector('[data-directory-status]');
  const count = document.querySelector('[data-directory-count]');
  const search = document.querySelector('[data-directory-search]');
  const previous = document.querySelector('[data-directory-previous]');
  const next = document.querySelector('[data-directory-next]');
  const retry = document.querySelector('[data-directory-retry]');
  let client;
  let page = 0;
  let total = 0;
  let role = 'all';
  let tag = '';
  let controller;
  let timer;
  const sync = () => {
    previous.disabled = page === 0;
    next.disabled = (page + 1) * DIRECTORY_PAGE_SIZE >= total;
    for (const button of document.querySelectorAll('[data-role], [data-tag]')) {
      const active = button.dataset.role === role || !!tag && button.dataset.tag === tag;
      button.classList.toggle('btn-gold', active);
      button.classList.toggle('btn-secondary', !active);
      button.setAttribute('aria-pressed', String(active));
    }
  };
  const load = async () => {
    controller?.abort();
    const active = new AbortController();
    controller = active;
    grid.replaceChildren();
    grid.setAttribute('aria-busy', 'true');
    status.textContent = 'Loading directory...';
    retry.classList.add('preview-hidden');
    previous.disabled = next.disabled = true;
    try {
      client ||= createPublicDirectoryClient(directoryConfig());
      const result = await fetchDirectory(client, { page, role, tag, search: search.value, signal: active.signal });
      if (active.signal.aborted) return;
      total = result.total;
      if (page > 0 && !result.profiles.length) { page = 0; return load(); }
      for (const profile of result.profiles) grid.appendChild(directoryCard(template, profile));
      status.textContent = result.profiles.length ? '' : 'No listings found.';
      const start = total ? page * DIRECTORY_PAGE_SIZE + 1 : 0;
      const end = page * DIRECTORY_PAGE_SIZE + result.profiles.length;
      count.textContent = `Showing ${start}-${end} of ${total} listings`;
      sync();
    } catch {
      if (active.signal.aborted) return;
      status.textContent = 'The directory is unavailable. Please try again.';
      count.textContent = '';
      retry.classList.remove('preview-hidden');
    } finally {
      if (!active.signal.aborted) grid.setAttribute('aria-busy', 'false');
    }
  };
  search.addEventListener('input', () => { clearTimeout(timer); controller?.abort(); page = 0; timer = setTimeout(load, 250); });
  for (const button of document.querySelectorAll('[data-role], [data-tag]')) button.addEventListener('click', () => {
    clearTimeout(timer);
    if (button.dataset.role) { role = button.dataset.role; if (role === 'all') tag = ''; }
    else tag = tag === button.dataset.tag ? '' : button.dataset.tag;
    page = 0;
    sync();
    load();
  });
  previous.addEventListener('click', () => { page = Math.max(0, page - 1); load(); });
  next.addEventListener('click', () => { page++; load(); });
  retry.addEventListener('click', load);
  sync();
  load();
}
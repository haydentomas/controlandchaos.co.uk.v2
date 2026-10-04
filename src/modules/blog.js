export function initBlog() {
  const cards = [...document.querySelectorAll('[data-blog-category]')];
  const search = document.querySelector('[data-blog-search-input]');
  const buttons = [...document.querySelectorAll('[data-cat]')];
  const more = document.querySelector('[data-blog-more]');
  const empty = document.querySelector('[data-blog-empty]');
  let category = 'all';
  let limit = 8;
  const update = () => {
    const query = (search?.value || '').trim().toLocaleLowerCase();
    const matches = cards.filter(card => (category === 'all' || card.dataset.blogCategory === category) && card.dataset.blogSearch.toLocaleLowerCase().includes(query));
    const visible = new Set(matches.slice(0, limit));
    for (const card of cards) card.classList.toggle('preview-hidden', !visible.has(card));
    more?.parentElement.classList.toggle('preview-hidden', matches.length <= limit);
    empty?.classList.toggle('preview-hidden', matches.length > 0);
    for (const button of buttons) {
      const active = button.dataset.cat === category;
      button.classList.toggle('btn-gold', active);
      button.classList.toggle('btn-secondary', !active);
      button.setAttribute('aria-pressed', String(active));
    }
  };
  for (const button of buttons) button.addEventListener('click', () => { category = button.dataset.cat; limit = 8; update(); });
  search?.addEventListener('input', () => { limit = 8; update(); });
  more?.addEventListener('click', () => { limit += 8; update(); });
  if (search) update();
  document.querySelector('[data-copy-post]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      await navigator.clipboard.writeText(location.href);
      button.textContent = 'Link copied';
    } catch {
      button.textContent = 'Copy unavailable';
    }
  });
}
export function initEvents() {
  const cards = [...document.querySelectorAll('[data-event-category]')];
  const counter = document.querySelector('[data-event-counter]');
  const buttons = [...document.querySelectorAll('[data-filter]')];
  for (const button of buttons) {
    button.setAttribute('aria-pressed', String(button.dataset.filter === 'all'));
    button.addEventListener('click', () => {
      const category = button.dataset.filter;
      for (const card of cards) card.classList.toggle('preview-hidden', category !== 'all' && card.dataset.eventCategory !== category);
      for (const item of buttons) {
        const active = item === button;
        item.classList.toggle('btn-gold', active);
        item.classList.toggle('btn-secondary', !active);
        item.setAttribute('aria-pressed', String(active));
      }
      const visible = cards.filter(card => !card.classList.contains('preview-hidden')).length;
      if (counter) counter.textContent = `Showing ${visible} of ${cards.length} events`;
    });
  }
}
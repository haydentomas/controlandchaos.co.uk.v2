export function initNavigation() {
  const toggle = document.getElementById('nav-toggle');
  const drawer = document.getElementById('mobile-nav-drawer');
  if (!toggle || !drawer) return;
  const closeNavigation = () => {
    toggle.classList.remove('open');
    drawer.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  };
  toggle.addEventListener('click', () => {
    const open = !drawer.classList.contains('open');
    drawer.classList.toggle('open', open);
    toggle.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', event => {
    if (drawer.classList.contains('open') && !drawer.contains(event.target) && !toggle.contains(event.target)) closeNavigation();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && drawer.classList.contains('open')) {
      closeNavigation();
      toggle.focus({ preventScroll: true });
    }
  });
}
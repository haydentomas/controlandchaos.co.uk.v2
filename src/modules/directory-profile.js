import { createPublicDirectoryClient, directoryConfig, fetchPublicProfile, publicImageUrl } from './directory-api.js';
import { renderPublicRateCards } from './rate-cards.js';
import { renderBookingHours } from './booking-hours.js';
import { fetchGalleryPhotos, renderProfileGallery, renderGalleryPreview } from './profile-gallery.js';
import { renderRichText } from './profile-rich-text.js';

function initProfileTabs(hasGallery) {
  const nav = document.querySelector('[data-public-profile-tabs]');
  const tabs = [...nav.querySelectorAll('[role="tab"]')];
  const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));
  const galleryTab = document.getElementById('profile-tab-gallery');
  galleryTab.hidden = !hasGallery;
  nav.hidden = !hasGallery;
  const activate = index => {
    tabs.forEach((tab, tabIndex) => {
      const selected = tabIndex === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panels[tabIndex].classList.toggle('preview-hidden', !selected);
    });
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(index));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const available = tabs.filter(candidate => !candidate.hidden);
      const currentIndex = available.indexOf(tab);
      const nextIndex = event.key === 'Home' ? 0
        : event.key === 'End' ? available.length - 1
          : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + available.length) % available.length;
      available[nextIndex].focus();
      activate(tabs.indexOf(available[nextIndex]));
    });
  });
  document.querySelector('[data-public-gallery-view-all]').addEventListener('click', () => {
    activate(1);
    galleryTab.focus();
    nav.scrollIntoView({ block: 'start', behavior: 'auto' });
  });
}

export async function initDirectoryProfile(clientOverride) {
  const status = document.querySelector('[data-public-profile-status]');
  const content = document.querySelector('[data-public-profile-content]');
  const slug = new URL(location.href).searchParams.get('slug');
  try {
    const client = clientOverride || createPublicDirectoryClient(directoryConfig());
    const profile = await fetchPublicProfile(client, slug);
    if (!profile) { status.textContent = 'Profile not found.'; return; }
    const fill = (selector, value) => { document.querySelector(selector).textContent = value || ''; };
    fill('[data-public-profile-name]', profile.display_name);
    fill('[data-public-profile-headline]', profile.headline);
    fill('[data-public-profile-role]', { domme: 'Dominant / Domme', sub: 'Submissive', switch: 'Switch' }[profile.role_type] || 'Creator');
    fill('[data-public-profile-username]', `@${profile.sl_username}`);
    renderRichText(document.querySelector('[data-public-profile-tagline]'), profile.tagline);
    fill('[data-public-profile-rate]', profile.starting_rate || 'Contact for rates');
    renderRichText(document.querySelector('[data-public-profile-about]'), profile.about);
    document.querySelector('.public-profile-about-panel').classList.toggle('preview-hidden', !String(profile.about || '').trim());
    fill('[data-public-profile-availability]', `Availability: ${{ available: 'Available', busy: 'Busy', away: 'Away', offline: 'Offline' }[profile.availability] || 'Contact for availability'}`);
    fill('[data-public-profile-availability-note]', profile.availability_note);
    for (const [field, selector] of [['boundaries', '[data-public-profile-boundaries]'], ['booking_instructions', '[data-public-profile-instructions]']]) {
      const text = String(profile[field] || '').trim();
      const section = document.querySelector(selector);
      renderRichText(section.querySelector('[data-profile-protocol-text]'), text);
      section.classList.toggle('preview-hidden', !text);
    }
    document.title = `${profile.display_name} | Control & Chaos`;
    const banner = document.querySelector('[data-public-profile-banner]');
    const bannerUrl = publicImageUrl(profile.banner_image);
    if (bannerUrl) {
      banner.src = bannerUrl;
      banner.alt = `${profile.display_name} banner`;
      banner.classList.remove('preview-hidden');
      banner.addEventListener('error', () => banner.classList.add('preview-hidden'));
    }
    const src = publicImageUrl(profile.avatar_image);
    if (src) {
      const image = document.querySelector('[data-public-profile-avatar]');
      image.src = src;
      image.alt = profile.display_name;
      image.classList.remove('preview-hidden');
      image.addEventListener('error', () => image.classList.add('preview-hidden'));
    }
    for (const tag of Array.isArray(profile.tags) ? profile.tags : []) {
      const badge = document.createElement('span');
      badge.className = 'tag-pill-badge';
      badge.textContent = String(tag);
      document.querySelector('[data-public-profile-tags]').appendChild(badge);
    }
    const rates = document.querySelector('[data-public-profile-rates]');
    renderPublicRateCards(rates, profile.rate_categories || []);
    document.querySelector('[data-public-profile-rate-section]').classList.toggle('preview-hidden', !rates.children.length);
    const hours = document.querySelector('[data-public-profile-hours]');
    renderBookingHours(hours, profile.booking_hours ?? null);
    document.querySelector('[data-public-profile-booking-section]').classList.toggle('preview-hidden', !hours.children.length);
    content.classList.remove('preview-hidden');
    status.textContent = '';
    const previewSection = document.querySelector('[data-public-gallery-preview-section]');
    let photos;
    try {
      photos = await fetchGalleryPhotos(client, profile.id, { publishedOnly: true });
    } catch {
      initProfileTabs(true);
      document.querySelector('[data-public-gallery-status]').textContent = 'Gallery is temporarily unavailable.';
      document.querySelector('[data-public-gallery-preview-status]').textContent = 'Gallery is temporarily unavailable.';
      document.querySelector('[data-public-gallery-view-all]').hidden = true;
      previewSection.classList.remove('preview-hidden');
      return;
    }
    const published = photos.filter(photo => photo.is_published);
    renderProfileGallery(document.getElementById('gallery-library-grid'), document.getElementById('gallery-library-filters'), published);
    renderGalleryPreview(document.querySelector('[data-public-gallery-preview]'), published);
    previewSection.classList.toggle('preview-hidden', !published.length);
    document.getElementById('profile-tab-gallery').textContent = `Gallery (${published.length})`;
    document.querySelector('[data-public-gallery-view-all]').textContent = `View all ${published.length} ${published.length === 1 ? 'photo' : 'photos'}`;
    initProfileTabs(published.length > 0);
  } catch { status.textContent = 'This profile is unavailable. Please try again later.'; }
}
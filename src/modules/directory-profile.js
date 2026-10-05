import { createPublicDirectoryClient, directoryConfig, fetchPublicProfile, publicImageUrl } from './directory-api.js';
import { renderPublicRateCards } from './rate-cards.js';
import { renderBookingHours } from './booking-hours.js';
import { fetchGalleryPhotos, renderProfileGallery } from './profile-gallery.js';

export async function initDirectoryProfile() {
  const status = document.querySelector('[data-public-profile-status]');
  const content = document.querySelector('[data-public-profile-content]');
  const slug = new URL(location.href).searchParams.get('slug');
  try {
    const client = createPublicDirectoryClient(directoryConfig());
    const profile = await fetchPublicProfile(client, slug);
    if (!profile) { status.textContent = 'Profile not found.'; return; }
    const fill = (selector, value) => { document.querySelector(selector).textContent = value || ''; };
    fill('[data-public-profile-name]', profile.display_name);
    fill('[data-public-profile-headline]', profile.headline);
    fill('[data-public-profile-role]', { domme: 'Dominant / Domme', sub: 'Submissive', switch: 'Switch' }[profile.role_type] || 'Creator');
    fill('[data-public-profile-username]', `@${profile.sl_username}`);
    fill('[data-public-profile-tagline]', profile.tagline);
    fill('[data-public-profile-rate]', profile.starting_rate || 'Contact for rates');
    fill('[data-public-profile-about]', profile.about);
    fill('[data-public-profile-availability]', `Availability: ${{ available: 'Available', busy: 'Busy', away: 'Away', offline: 'Offline' }[profile.availability] || 'Contact for availability'}`);
    fill('[data-public-profile-availability-note]', profile.availability_note);
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
    const gallery = document.querySelector('[data-public-profile-gallery]');
    try {
      const photos = await fetchGalleryPhotos(client, profile.id, { publishedOnly: true });
      renderProfileGallery(document.getElementById('gallery-library-grid'), document.getElementById('gallery-library-filters'), photos);
      gallery.classList.toggle('preview-hidden', !photos.length);
    } catch {
      gallery.classList.remove('preview-hidden');
      document.querySelector('[data-public-gallery-status]').textContent = 'Gallery is temporarily unavailable.';
    }
  } catch { status.textContent = 'This profile is unavailable. Please try again later.'; }
}
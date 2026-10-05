import { createPublicDirectoryClient, directoryConfig, fetchPublicProfile, publicImageUrl } from './directory-api.js';
import { renderPublicRateCards } from './rate-cards.js';

export async function initDirectoryProfile() {
  const status = document.querySelector('[data-public-profile-status]');
  const content = document.querySelector('[data-public-profile-content]');
  const slug = new URL(location.href).searchParams.get('slug');
  try {
    const profile = await fetchPublicProfile(createPublicDirectoryClient(directoryConfig()), slug);
    if (!profile) { status.textContent = 'Profile not found.'; return; }
    const fill = (selector, value) => { document.querySelector(selector).textContent = value || ''; };
    fill('[data-public-profile-name]', profile.display_name);
    fill('[data-public-profile-headline]', profile.headline);
    fill('[data-public-profile-role]', { domme: 'Dominant / Domme', sub: 'Submissive', switch: 'Switch' }[profile.role_type] || 'Creator');
    fill('[data-public-profile-username]', `@${profile.sl_username}`);
    fill('[data-public-profile-tagline]', profile.tagline);
    fill('[data-public-profile-rate]', profile.starting_rate || 'Contact for rates');
    fill('[data-public-profile-about]', profile.about);
    document.title = `${profile.display_name} | Control & Chaos`;
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
    content.classList.remove('preview-hidden');
    status.textContent = '';
  } catch { status.textContent = 'This profile is unavailable. Please try again later.'; }
}
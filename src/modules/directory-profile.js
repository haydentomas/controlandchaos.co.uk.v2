import { createCreatorClient } from './auth-api.js';
import { directoryConfig, fetchPublicProfile, publicImageUrl } from './directory-api.js';
import { renderPublicRateCards } from './rate-cards.js';
import { renderBookingHours } from './booking-hours.js';
import { fetchGalleryPhotos, renderProfileGallery, renderGalleryPreview } from './profile-gallery.js';
import { renderRichText } from './profile-rich-text.js';
import { initBookingEnquiry } from './booking-enquiry.js';
import { renderHardwareItems, renderWishlistItems } from './profile-collections.js';
import { renderCreatorBlogFeed } from './creator-blog-feed.js';
import { missingBlogV2Rpc } from './creator-blog-media.js';

function initProfileTabs(hasGallery, hasBlog) {
  const nav = document.querySelector('[data-public-profile-tabs]');
  const tabs = [...nav.querySelectorAll('[role="tab"]')];
  const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));
  const galleryTab = document.getElementById('profile-tab-gallery');
  const blogTab = document.getElementById('profile-tab-blog');
  galleryTab.hidden = !hasGallery;
  blogTab.hidden = !hasBlog;
  nav.hidden = !hasGallery && !hasBlog;
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
  document.querySelector('[data-public-gallery-view-all]')?.addEventListener('click', () => {
    const galleryIndex = tabs.indexOf(galleryTab);
    activate(galleryIndex);
    galleryTab.focus();
    nav.scrollIntoView({ block: 'start', behavior: 'auto' });
  });
}

function renderBoundaryList(container, value) {
  const text = String(value || '').trim();
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const listable = lines.length > 1 && lines.every(line => !/^(#{1,6}\s|>\s|```|\|)/.test(line));
  if (!listable) { renderRichText(container, text); return; }
  const list = document.createElement('ul');
  list.className = 'public-boundaries-list';
  for (const line of lines) {
    const item = document.createElement('li');
    renderRichText(item, line.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, ''));
    list.append(item);
  }
  container.replaceChildren(list);
}

export async function initDirectoryProfile(clientOverride) {
  const status = document.querySelector('[data-public-profile-status]');
  const content = document.querySelector('[data-public-profile-content]');
  const slug = new URL(location.href).searchParams.get('slug');
  try {
    const client = clientOverride || createCreatorClient(directoryConfig());
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
      const content = section.querySelector('[data-profile-protocol-text]');
      if (field === 'boundaries') renderBoundaryList(content, text);
      else renderRichText(content, text);
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
    document.querySelector('[data-public-hardware-title]').textContent = String(profile.hardware_title || 'My Toys').trim() || 'My Toys';
    renderHardwareItems(document.querySelector('[data-public-hardware-items]'), profile.hardware_compat || []);
    document.querySelector('[data-public-profile-hardware]').classList.toggle('preview-hidden', !profile.hardware_compat?.length);
    document.querySelector('[data-public-wishlist-title]').textContent = String(profile.wishlist_title || 'Wishlist & Tributes').trim() || 'Wishlist & Tributes';
    renderWishlistItems(document.querySelector('[data-public-wishlist-items]'), profile.wishlist || []);
    document.querySelector('[data-public-profile-wishlist]').classList.toggle('preview-hidden', !profile.wishlist?.length);
    const summary = document.querySelector('.public-profile-summary');
    summary.classList.toggle('preview-hidden', !String(profile.starting_rate || '').trim() && !String(profile.availability_note || '').trim() && !(Array.isArray(profile.tags) && profile.tags.length));
    const rates = document.querySelector('[data-public-profile-rates]');
    const bookingSection = document.querySelector('[data-public-profile-booking-enquiry]');
    const bookingEnabled = profile.booking_hours !== null;
    bookingSection.classList.toggle('preview-hidden', !bookingEnabled);
    initBookingEnquiry(bookingSection, profile);
    renderPublicRateCards(rates, profile.rate_categories || [], {
      bookingEnabled,
      onSelectionChange: services => {
        bookingSection.querySelector('[name="selected_services"]').value = JSON.stringify(services.map(service => service.id));
        const message = bookingSection.querySelector('[name="message"]');
        if (services.length) {
          const total = services.reduce((sum, service) => sum + service.amount, 0);
          const breakdown = services.map(service => `  \u2022 ${service.name} (${service.category ? `${service.category} \u2014 ` : ''}L${service.amount.toLocaleString('en-US')})`).join('\n');
          message.value = `Hello ${profile.display_name},\n\nI would like to request a booking/session for the following services:\n${breakdown}\n\nEstimated Total: L${total.toLocaleString('en-US')} (~${Math.round(total / 250)})\n\nSession Preferences & Notes:\n[Please specify your scenario, preferences, or timing details here]`;
        } else if (message.value.startsWith(`Hello ${profile.display_name},`)) message.value = '';
      }
    });
    document.querySelector('[data-public-profile-rate-section]').classList.toggle('preview-hidden', !rates.children.length);
    const hours = document.querySelector('[data-public-profile-hours]');
    renderBookingHours(hours, profile.booking_hours ?? null);
    document.querySelector('[data-public-profile-booking-section]').classList.toggle('preview-hidden', !hours.children.length);
    content.classList.remove('preview-hidden');
    status.textContent = '';
    const blogStatus = document.querySelector('[data-public-blog-status]');
    let offer = null;
    try {
      const offerResult = await client.rpc('creator_blog_public_offer', { target_profile: profile.id });
      if (offerResult.error) throw offerResult.error;
      offer = Array.isArray(offerResult.data) ? offerResult.data[0] || null : offerResult.data;
    } catch {
      blogStatus.textContent = 'Creator subscription details are temporarily unavailable.';
    }
    const isVip = offer?.creator_is_vip === true;
    const previewSection = document.querySelector('[data-public-gallery-preview-section]');
    let published = [];
    let hasGallery = false;
    try {
      const photos = await fetchGalleryPhotos(client, profile.id, { publishedOnly: true });
      published = photos.filter(photo => photo.is_published);
      const sidebarPhotos = published.filter(photo => photo.show_in_sidebar !== false);
      if (isVip) renderProfileGallery(document.getElementById('gallery-library-grid'), document.getElementById('gallery-library-filters'), published);
      else {
        document.getElementById('gallery-library-grid').replaceChildren();
        document.getElementById('gallery-library-filters').replaceChildren();
      }
      renderGalleryPreview(document.querySelector('[data-public-gallery-preview]'), sidebarPhotos);
      previewSection.classList.toggle('preview-hidden', !sidebarPhotos.length);
      document.querySelector('[data-public-gallery-preview-title]').textContent = isVip ? 'Gallery' : 'Profile photos';
      document.querySelector('[data-public-gallery-view-all]').hidden = !isVip;
      document.getElementById('profile-tab-gallery').textContent = `Gallery (${published.length})`;
      document.querySelector('[data-public-gallery-view-all]').textContent = `View all ${published.length} ${published.length === 1 ? 'photo' : 'photos'}`;
      hasGallery = isVip && published.length > 0;
    } catch {
      hasGallery = isVip;
      document.querySelector('[data-public-gallery-status]').textContent = 'Gallery is temporarily unavailable.';
      document.querySelector('[data-public-gallery-preview-status]').textContent = 'Gallery is temporarily unavailable.';
      document.querySelector('[data-public-gallery-view-all]').hidden = true;
      previewSection.classList.remove('preview-hidden');
    }
    let hasBlog = false;
    try {
      const initialFeedResult = await client.rpc('creator_blog_feed_v2', { target_profile: profile.id });
      const feedResult = missingBlogV2Rpc(initialFeedResult.error)
        ? await client.rpc('creator_blog_feed', { target_profile: profile.id }) : initialFeedResult;
      if (feedResult.error || !Array.isArray(feedResult.data)) throw new Error('Creator blog is temporarily unavailable.');
      const posts = feedResult.data;
      await renderCreatorBlogFeed(
        document.querySelector('[data-public-blog-feed]'),
        blogStatus,
        client,
        profile,
        offer,
        posts
      );
      hasBlog = posts.length > 0 || (isVip && Number(offer?.monthly_price_linden) > 0);
      document.getElementById('profile-tab-blog').textContent = `Blog (${posts.length})`;
      document.querySelector('[data-public-blog-title]').textContent = `${profile.display_name}'s Blog`;
    } catch {
      blogStatus.textContent = 'Creator blog is temporarily unavailable.';
    }
    initProfileTabs(hasGallery, hasBlog);
  } catch { status.textContent = 'This profile is unavailable. Please try again later.'; }
}
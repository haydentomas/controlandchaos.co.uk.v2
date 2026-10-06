import { createCreatorClient } from './auth-api.js';
import { myDirectorySubscriptions, loadCreatorProfile, saveCreatorProfile, subscriptionLabel } from './creator-profile-api.js';
import { publicImageUrl } from './directory-api.js';
import { initRateCardEditor } from './rate-card-editor.js';
import { initBookingHoursEditor } from './booking-hours.js';
import { initProfileGalleryEditor } from './profile-gallery-editor.js';
import { initProfileCollectionEditor, HARDWARE_FIELDS, WISHLIST_FIELDS, validateHardwareItems, validateWishlistItems, createHardwareItem, createWishlistItem } from './profile-collections.js';
import { fetchGalleryPhotos } from './profile-gallery.js';
import { initRichTextEditor, flushRichTextEditors } from './rich-text-editor.js';

export async function initCreatorEditor(clientOverride) {
  const form = document.querySelector('[data-live-profile-form]');
  const status = document.querySelector('[data-creator-status]');
  const fields = form.querySelector('[data-creator-fields]');
  const picker = form.querySelector('[data-creator-profile]');
  const reload = document.querySelector('[data-creator-reload]');
  const signin = document.querySelector('[data-creator-signin]');
  const textEditors = Object.fromEntries(['tagline', 'about', 'boundaries', 'booking_instructions'].map(name => [name, initRichTextEditor(form.elements[name])]));
  const rateEditor = initRateCardEditor(form.querySelector('[data-rate-editor]'), form.querySelector('[data-rate-add-category]'));
  const bookingEditor = initBookingHoursEditor(form.querySelector('[data-booking-editor]'));
  const galleryEditor = initProfileGalleryEditor(form.querySelector('[data-gallery-editor]'), form.querySelector('[data-gallery-add-photo]'));
  const hardwareEditor = initProfileCollectionEditor(form.querySelector('[data-hardware-editor]'), form.querySelector('[data-hardware-add]'), { kind: 'toys', fields: HARDWARE_FIELDS, validate: validateHardwareItems, createItem: createHardwareItem, limit: 30 });
  const wishlistEditor = initProfileCollectionEditor(form.querySelector('[data-wishlist-editor]'), form.querySelector('[data-wishlist-add]'), { kind: 'wishlist', fields: WISHLIST_FIELDS, validate: validateWishlistItems, createItem: createWishlistItem, limit: 20 });
  let client;
  let generation = 0;
  let saving = false;
  let profile;
  let timer;
  let subscriptions = [];
  const fieldNames = ['display_name', 'role_type', 'headline', 'tagline', 'about', 'avatar_image', 'banner_image', 'starting_rate', 'availability', 'availability_note', 'boundaries', 'booking_instructions', 'booking_email', 'hardware_title', 'wishlist_title'];
  const lock = message => {
    generation++;
    profile = null;
    subscriptions = [];
    fields.disabled = true;
    form.reset();
    for (const editor of Object.values(textEditors)) editor.load('');
    rateEditor.clear();
    bookingEditor.load(null);
    galleryEditor.clear();
    hardwareEditor.clear();
    wishlistEditor.clear();
    picker.replaceChildren();
    form.classList.add('preview-hidden');
    status.textContent = message;
  };
  const preview = (name, selector) => {
    const image = form.querySelector(selector);
    const url = publicImageUrl(form.elements[name].value);
    image.classList.toggle('preview-hidden', !url);
    if (url) image.src = url;
    else image.removeAttribute('src');
  };
  const paint = row => {
    rateEditor.load(row.rate_categories);
    bookingEditor.load(row.booking_hours);
    hardwareEditor.load(row.hardware_compat);
    wishlistEditor.load(row.wishlist);
    profile = row;
    for (const name of fieldNames) form.elements[name].value = row[name] || '';
    for (const [name, editor] of Object.entries(textEditors)) editor.load(row[name]);
    form.elements.tags.value = (row.tags || []).join(', ');
    form.elements.is_published.checked = row.is_published === true;
    form.querySelector('[data-creator-username]').value = row.sl_username;
    form.querySelector('[data-creator-publication]').textContent = !row.is_approved ? 'Publication is restricted.' : row.is_published ? 'Published while your subscription is active.' : 'Draft - not publicly visible.';
    const link = form.querySelector('[data-creator-public]');
    link.classList.toggle('preview-hidden', !(row.is_approved && row.is_published));
    link.href = `/directory-profile.html?slug=${encodeURIComponent(row.slug)}`;
    preview('avatar_image', '[data-creator-avatar-preview]');
    preview('banner_image', '[data-creator-banner-preview]');
  };
  const loadSelected = async () => {
    const active = ++generation;
    fields.disabled = true;
    picker.disabled = true;
    status.textContent = 'Loading profile...';
    try {
      const row = await loadCreatorProfile(client, picker.value);
      const photos = await fetchGalleryPhotos(client, row.id);
      if (active !== generation) return;
      galleryEditor.load(photos);
      paint(row);
      form.querySelector('[data-creator-subscription]').textContent = subscriptionLabel(subscriptions.find(subscription => subscription.profile_id === row.id));
      form.classList.remove('preview-hidden');
      fields.disabled = false;
      status.textContent = 'Profile ready.';
    } catch (error) { if (active === generation) lock(error.message); }
    finally { if (active === generation) picker.disabled = false; }
  };
  const refreshAccess = async () => {
    if (saving) return;
    lock('Checking profile access...');
    const active = generation;
    reload.disabled = true;
    try {
      const { data, error } = await client.auth.getUser();
      if (active !== generation) return;
      signin.classList.toggle('preview-hidden', !!data?.user && !error);
      if (error || !data?.user) { lock('Sign in to access your profile.'); return; }
      const available = await myDirectorySubscriptions(client);
      if (active !== generation) return;
      subscriptions = available.filter(subscription => subscription.is_active === true && subscription.profile_id);
      if (!subscriptions.length) { lock('An active directory subscription and linked profile are required. Renew at the in-world terminal; existing content is retained.'); return; }
      const requested = new URLSearchParams(location.search).get('profile');
      if (requested && !subscriptions.some(subscription => subscription.profile_id === requested)) { lock('This profile is not available to your account. Open your profile from My Account.'); return; }
      for (const subscription of subscriptions) {
        const option = document.createElement('option');
        option.value = subscription.profile_id;
        option.textContent = `${subscriptionLabel(subscription).split(' - ')[0]} (${subscription.avatar_uuid.slice(0, 8)})`;
        picker.append(option);
      }
      picker.value = requested || subscriptions[0].profile_id;
      await loadSelected();
    } catch { if (active === generation) lock('Unable to check profile access. Please try again.'); }
    finally { reload.disabled = false; }
  };
  try { client = clientOverride || createCreatorClient(); } catch { lock('Profile service is unavailable.'); return; }
  const { data: listener } = client.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') { lock('Signed out.'); signin.classList.remove('preview-hidden'); }
    if (event === 'SIGNED_IN') { lock('Checking profile access...'); setTimeout(refreshAccess, 0); }
  });
  reload.addEventListener('click', refreshAccess);
  picker.addEventListener('change', loadSelected);
  for (const [name, selector] of [['avatar_image', '[data-creator-avatar-preview]'], ['banner_image', '[data-creator-banner-preview]']]) form.elements[name].addEventListener('input', () => preview(name, selector));
  for (const image of form.querySelectorAll('.creator-image-preview')) image.addEventListener('error', () => image.classList.add('preview-hidden'));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    flushRichTextEditors(form);
    if (saving || !profile || fields.disabled || !form.reportValidity()) return;
    const active = generation;
    const values = Object.fromEntries(fieldNames.map(name => [name, form.elements[name].value]));
    values.tags = form.elements.tags.value.split(',').map(tag => tag.trim()).filter(Boolean);
    values.is_published = form.elements.is_published.checked;
    let photos;
    try { values.rate_categories = rateEditor.value(); values.booking_hours = bookingEditor.value(); values.hardware_compat = hardwareEditor.value(); values.wishlist = wishlistEditor.value(); }
    catch (error) { status.textContent = error.message; return; }
    saving = true;
    fields.disabled = picker.disabled = reload.disabled = true;
    let uploadBatch;
    let profileSaved = false;
    try {
      uploadBatch = await galleryEditor.uploadPending(profile.id, client.storage, message => { status.textContent = message; });
      photos = galleryEditor.value();
      status.textContent = 'Saving profile...';
      const updated = await saveCreatorProfile(client, profile.id, values, photos);
      profileSaved = true;
      await galleryEditor.commitUploads(client.storage, uploadBatch);
      if (active !== generation) return;
      paint(updated);
      try { galleryEditor.load(await fetchGalleryPhotos(client, profile.id)); } catch {}
      status.textContent = 'Profile saved.';
    } catch (error) {
      if (!profileSaved && uploadBatch) await galleryEditor.rollbackUploads(client.storage, uploadBatch);
      if (active === generation) status.textContent = error.message;
    }
    finally {
      saving = false;
      if (active === generation && profile) fields.disabled = picker.disabled = false;
      reload.disabled = false;
    }
  });
  const checkExpiry = async () => {
    if (!profile || saving) return;
    const active = generation;
    try {
      const available = await myDirectorySubscriptions(client);
      if (active !== generation) return;
      if (!available.some(subscription => subscription.profile_id === profile.id && subscription.is_active === true)) lock('Subscription access expired or was revoked. Your content is retained.');
    } catch { if (active === generation) lock('Unable to confirm subscription access. Refresh access to continue.'); }
  };
  const startTimer = () => { clearInterval(timer); timer = setInterval(checkExpiry, 60000); };
  window.addEventListener('pagehide', event => { clearInterval(timer); if (!event.persisted) listener.subscription.unsubscribe(); });
  window.addEventListener('pageshow', event => { if (event.persisted) { lock('Checking profile access...'); refreshAccess(); startTimer(); } });
  await refreshAccess();
  startTimer();
}
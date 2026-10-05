import { createCreatorClient } from './auth-api.js';
import { myDirectorySubscriptions, loadCreatorProfile, saveCreatorProfile, subscriptionLabel } from './creator-profile-api.js';
import { publicImageUrl } from './directory-api.js';

export async function initCreatorEditor(clientOverride) {
  const form = document.querySelector('[data-live-profile-form]');
  const status = document.querySelector('[data-creator-status]');
  const fields = form.querySelector('[data-creator-fields]');
  const picker = form.querySelector('[data-creator-profile]');
  const reload = document.querySelector('[data-creator-reload]');
  const signin = document.querySelector('[data-creator-signin]');
  let client;
  let generation = 0;
  let saving = false;
  let profile;
  let timer;
  let subscriptions = [];
  const fieldNames = ['display_name', 'role_type', 'headline', 'tagline', 'about', 'avatar_image', 'banner_image', 'starting_rate', 'availability'];
  const lock = message => {
    generation++;
    profile = null;
    subscriptions = [];
    fields.disabled = true;
    form.reset();
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
    profile = row;
    for (const name of fieldNames) form.elements[name].value = row[name] || '';
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
      if (active !== generation) return;
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
    if (saving || !profile || fields.disabled || !form.reportValidity()) return;
    const active = generation;
    const values = Object.fromEntries(fieldNames.map(name => [name, form.elements[name].value]));
    values.tags = form.elements.tags.value.split(',').map(tag => tag.trim()).filter(Boolean);
    values.is_published = form.elements.is_published.checked;
    saving = true;
    fields.disabled = picker.disabled = reload.disabled = true;
    status.textContent = 'Saving profile...';
    try {
      const updated = await saveCreatorProfile(client, profile.id, values);
      if (active !== generation) return;
      paint(updated);
      status.textContent = 'Profile saved.';
    } catch (error) { if (active === generation) status.textContent = error.message; }
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
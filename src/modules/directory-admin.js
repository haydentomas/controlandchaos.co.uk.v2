import { createCreatorClient } from './auth-api.js';

const PROFILE_FIELDS = [
  ['display_name', 'Display name', 'text'],
  ['role_type', 'Role type', 'select', ['domme', 'sub', 'switch']],
  ['headline', 'Headline', 'text'],
  ['tags', 'Tags (comma-separated)', 'tags'],
  ['tagline', 'Tagline', 'textarea'],
  ['about', 'About', 'textarea'],
  ['avatar_image', 'Avatar image URL', 'text'],
  ['banner_image', 'Banner image URL', 'text'],
  ['starting_rate', 'Starting rate', 'text'],
  ['availability', 'Availability', 'select', ['available', 'busy', 'away', 'offline']],
  ['availability_note', 'Availability note', 'textarea'],
  ['boundaries', 'Boundaries', 'textarea'],
  ['booking_instructions', 'How to book', 'textarea'],
  ['rate_categories', 'Rate categories (JSON)', 'json'],
  ['booking_hours', 'Booking hours (JSON)', 'json'],
  ['hardware_title', 'Toys section title', 'text'],
  ['hardware_compat', 'Toys (JSON)', 'json'],
  ['wishlist_title', 'Wishlist section title', 'text'],
  ['wishlist', 'Wishlist (JSON)', 'json'],
  ['creator_blog_monthly_linden', 'Creator monthly price (L$)', 'number'],
  ['creator_blog_benefits', 'Creator pass benefits', 'textarea']
];

const dateLabel = value => {
  if (!value) return 'No expiry';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Expiry unavailable' : date.toLocaleString();
};

function safeText(parent, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text ?? '';
  parent.append(node);
  return node;
}

export async function initDirectoryAdmin(clientOverride) {
  const root = document.querySelector('[data-directory-admin]');
  if (!root) return;
  const gate = root.querySelector('[data-admin-gate]');
  const consolePanel = root.querySelector('[data-admin-console]');
  const status = root.querySelector('[data-admin-status]');
  const listingsPane = root.querySelector('[data-admin-listings-pane]');
  const subscribersPane = root.querySelector('[data-admin-subscribers-pane]');
  const client = clientOverride || createCreatorClient();
  let isAdmin = false;
  let listings = [];
  let subscribers = [];
  let selectedProfile = null;
  let requestGeneration = 0;
  let activeTab = 'listings';

  const showStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('is-error', error);
  };
  const call = async (name, args = {}) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error('Admin request failed. Check access and try again.');
    return data;
  };
  const setAuthorized = allowed => {
    isAdmin = allowed;
    gate.classList.toggle('preview-hidden', allowed);
    consolePanel.classList.toggle('preview-hidden', !allowed);
  };
  const actionButton = (label, callback, danger = false) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = danger ? 'btn btn-danger-quiet' : 'btn btn-secondary';
    button.textContent = label;
    button.addEventListener('click', callback);
    return button;
  };

  const renderListings = () => {
    const list = root.querySelector('[data-admin-listings]');
    list.replaceChildren();
    if (!listings.length) {
      safeText(list, 'p', 'admin-empty', 'No listings match this search.');
      return;
    }
    for (const entry of listings) {
      const profile = entry.profile_data;
      if (!profile?.id) continue;
      const card = document.createElement('article');
      card.className = 'admin-listing-card';
      card.dataset.profileId = profile.id;
      const identity = document.createElement('div');
      identity.className = 'admin-listing-identity';
      if (profile.avatar_image) {
        const image = document.createElement('img');
        image.className = 'admin-listing-avatar';
        image.src = profile.avatar_image;
        image.alt = `${profile.display_name || 'Listing'} avatar`;
        image.addEventListener('error', () => image.remove());
        identity.append(image);
      } else safeText(identity, 'div', 'admin-listing-avatar admin-listing-initials', String(profile.display_name || '?').trim().slice(0, 1).toUpperCase());
      const names = document.createElement('div');
      names.className = 'admin-listing-names';
      safeText(names, 'strong', '', profile.display_name || 'Unnamed listing');
      safeText(names, 'span', '', `@${profile.sl_username || 'unlinked'} · ${profile.slug || profile.id}`);
      if (entry.moderation_state === 'suspended' || entry.moderation_state === 'archived') safeText(names, 'span', '', entry.moderation_state === 'archived' ? 'Archived (recoverable)' : 'Suspended (recoverable)');
      identity.append(names);
      const summary = document.createElement('div');
      summary.className = 'admin-listing-summary';
      const state = safeText(summary, 'span', `admin-state admin-state-${entry.moderation_state}`, entry.moderation_state);
      state.title = entry.moderation_state;
      safeText(summary, 'span', '', `${profile.role_type || 'role unset'} · ${entry.directory_plan_code || 'no directory plan'}`);
      safeText(summary, 'span', '', entry.directory_is_lifetime ? 'Lifetime' : dateLabel(entry.directory_expires_at));
      safeText(summary, 'span', '', `${entry.active_creator_subscribers || 0} active creator subscribers`);
      const actions = document.createElement('div');
      actions.className = 'admin-card-actions';
      actions.append(actionButton('Edit listing', () => editListing(profile)));
      actions.append(actionButton('View', () => window.open(`/directory-profile.html?slug=${encodeURIComponent(profile.slug || '')}`, '_blank', 'noopener')));
      if (entry.moderation_state === 'suspended' || entry.moderation_state === 'archived' || entry.moderation_state === 'unpublished') {
        actions.append(actionButton('Restore', () => changeListingState(profile.id, 'restore')));
      } else {
        if (!profile.is_approved || !profile.is_published || entry.moderation_state !== 'published') actions.append(actionButton('Publish', () => changeListingState(profile.id, 'publish')));
        if (profile.is_published) actions.append(actionButton('Unpublish', () => changeListingState(profile.id, 'unpublish')));
        actions.append(actionButton('Suspend', () => changeListingState(profile.id, 'suspend')));
        actions.append(actionButton('Archive', () => changeListingState(profile.id, 'archive'), true));
      }
      card.append(identity, summary, actions);
      list.append(card);
    }
  };

  const renderSubscribers = () => {
    const list = root.querySelector('[data-admin-subscribers]');
    list.replaceChildren();
    if (!subscribers.length) {
      safeText(list, 'p', 'admin-empty', 'No subscribers match this search.');
      return;
    }
    for (const subscription of subscribers) {
      const card = document.createElement('article');
      card.className = 'admin-subscriber-card';
      const heading = document.createElement('div');
      heading.className = 'admin-subscriber-heading';
      safeText(heading, 'strong', '', subscription.subscriber_username || subscription.subscriber_avatar_uuid);
      safeText(heading, 'span', `admin-state ${subscription.is_active ? 'admin-state-published' : 'admin-state-unpublished'}`, subscription.is_active ? 'active' : subscription.is_suspended ? 'suspended' : 'expired');
      card.append(heading);
      safeText(card, 'p', 'admin-subscriber-target', `${subscription.subscription_type === 'creator' ? 'Creator pass' : 'Directory'} · ${subscription.profile_name || 'Unassigned profile'}${subscription.profile_slug ? ` · ${subscription.profile_slug}` : ''}`);
      safeText(card, 'p', 'admin-subscriber-expiry', subscription.is_lifetime ? 'Lifetime' : dateLabel(subscription.expires_at));
      const actions = document.createElement('div');
      actions.className = 'admin-card-actions';
      if (subscription.subscription_type === 'creator' && subscription.profile_slug) {
        actions.append(actionButton('Open profile', () => window.open(`/directory-profile.html?slug=${encodeURIComponent(subscription.profile_slug)}`, '_blank', 'noopener')));
      }
      if (subscription.is_suspended) actions.append(actionButton('Restore access', () => changeSubscription(subscription, 'restore')));
      else actions.append(actionButton('Suspend access', () => changeSubscription(subscription, 'suspend'), true));
      if (!subscription.is_lifetime) actions.append(actionButton('Extend', () => changeSubscription(subscription, 'extend')));
      card.append(actions);
      list.append(card);
    }
  };

  const refreshListings = async () => {
    const generation = ++requestGeneration;
    showStatus('Loading listings...');
    try {
      const query = root.querySelector('[data-admin-listing-search]').value.trim();
      const data = await call('admin_directory_listings', { search_query: query });
      if (generation !== requestGeneration || !isAdmin) return;
      listings = Array.isArray(data) ? data : [];
      renderListings();
      showStatus(`${listings.length} listings loaded.`);
    } catch (error) { if (generation === requestGeneration) showStatus(error.message, true); }
  };

  const refreshSubscribers = async () => {
    const generation = ++requestGeneration;
    showStatus('Loading subscribers...');
    try {
      const query = root.querySelector('[data-admin-subscriber-search]').value.trim();
      const type = root.querySelector('[data-admin-subscriber-type]').value;
      const data = await call('admin_directory_subscribers', { search_query: query, subscription_type_filter: type });
      if (generation !== requestGeneration || !isAdmin) return;
      subscribers = Array.isArray(data) ? data : [];
      renderSubscribers();
      showStatus(`${subscribers.length} subscriptions loaded.`);
    } catch (error) { if (generation === requestGeneration) showStatus(error.message, true); }
  };

  const changeListingState = async (profileId, action) => {
    const reason = action === 'restore' || action === 'publish' ? '' : window.prompt(`Optional moderation note for ${action}:`, '') ?? null;
    if (reason === null) return;
    if (action === 'archive' && !window.confirm('Archive this listing? It will be hidden, not deleted, and can be restored.')) return;
    try {
      await call('admin_set_listing_state', { target_profile: profileId, action, reason });
      await refreshListings();
    } catch (error) { showStatus(error.message, true); }
  };

  const changeSubscription = async (subscription, action) => {
    let extensionDays = null;
    if (action === 'extend') {
      const value = window.prompt('Extend from now (or current expiry) by how many days? Enter 1–3650.', '30');
      if (value === null) return;
      extensionDays = Number(value);
      if (!Number.isInteger(extensionDays) || extensionDays < 1 || extensionDays > 3650) { showStatus('Enter a whole number from 1 to 3650.', true); return; }
    } else if (!window.confirm(`${action === 'suspend' ? 'Suspend' : 'Restore'} access for ${subscription.subscriber_username}?`)) return;
    try {
      await call('admin_set_subscription_state', {
        subscription_type: subscription.subscription_type,
        subscriber_avatar: subscription.subscriber_avatar_uuid,
        target_profile: subscription.profile_id,
        action,
        extension_days: extensionDays
      });
      await refreshSubscribers();
    } catch (error) { showStatus(error.message, true); }
  };

  const editListing = profile => {
    selectedProfile = profile;
    const form = root.querySelector('[data-admin-edit-form]');
    form.elements.display_name.value = profile.display_name || '';
    form.elements.role_type.value = profile.role_type || 'switch';
    form.elements.tags.value = Array.isArray(profile.tags) ? profile.tags.join(', ') : '';
    form.elements.headline.value = profile.headline || '';
    form.elements.tagline.value = profile.tagline || '';
    form.elements.about.value = profile.about || '';
    form.elements.avatar_image.value = profile.avatar_image || '';
    form.elements.banner_image.value = profile.banner_image || '';
    form.elements.starting_rate.value = profile.starting_rate || '';
    form.elements.availability.value = profile.availability || 'offline';
    form.elements.availability_note.value = profile.availability_note || '';
    form.elements.boundaries.value = profile.boundaries || '';
    form.elements.booking_instructions.value = profile.booking_instructions || '';
    form.elements.rate_categories.value = JSON.stringify(profile.rate_categories || [], null, 2);
    form.elements.booking_hours.value = JSON.stringify(profile.booking_hours, null, 2);
    form.elements.hardware_title.value = profile.hardware_title || 'My Toys';
    form.elements.hardware_compat.value = JSON.stringify(profile.hardware_compat || [], null, 2);
    form.elements.wishlist_title.value = profile.wishlist_title || 'Wishlist & Tributes';
    form.elements.wishlist.value = JSON.stringify(profile.wishlist || [], null, 2);
    form.elements.creator_blog_monthly_linden.value = profile.creator_blog_monthly_linden || 0;
    form.elements.creator_blog_benefits.value = profile.creator_blog_benefits || '';
    form.elements.is_featured.checked = profile.is_featured === true;
    root.querySelector('[data-admin-edit-title]').textContent = `Edit ${profile.display_name}`;
    root.querySelector('[data-admin-edit-dialog]').showModal();
  };

  const authorize = async () => {
    try {
      const { data: sessionData } = await client.auth.getSession();
      const { data: userData, error } = sessionData?.session ? await client.auth.getUser() : { data: {}, error: null };
      if (error || !userData?.user) {
        setAuthorized(false);
        showStatus('Sign in with the ControlandChaos V2 account to continue.', true);
        return;
      }
      const allowed = await call('my_directory_admin_access');
      if (allowed !== true) {
        setAuthorized(false);
        showStatus('This signed-in V2 account is not authorized as a directory superadmin.', true);
        return;
      }
      setAuthorized(true);
      showStatus(`Signed in as ${userData.user.email || 'verified superadmin'}.`);
      await refreshListings();
    } catch (error) {
      setAuthorized(false);
      showStatus(error.message || 'Admin authorization failed.', true);
    }
  };

  root.querySelectorAll('[data-admin-tab]').forEach(button => button.addEventListener('click', () => {
    activeTab = button.dataset.adminTab;
    root.querySelectorAll('[data-admin-tab]').forEach(tab => tab.setAttribute('aria-selected', String(tab === button)));
    listingsPane.classList.toggle('preview-hidden', activeTab !== 'listings');
    subscribersPane.classList.toggle('preview-hidden', activeTab !== 'subscribers');
    if (activeTab === 'subscribers') refreshSubscribers();
  }));
  root.querySelector('[data-admin-listing-refresh]').addEventListener('click', refreshListings);
  root.querySelector('[data-admin-listing-search]').addEventListener('keydown', event => { if (event.key === 'Enter') refreshListings(); });
  root.querySelector('[data-admin-subscriber-refresh]').addEventListener('click', refreshSubscribers);
  root.querySelector('[data-admin-subscriber-search]').addEventListener('keydown', event => { if (event.key === 'Enter') refreshSubscribers(); });
  root.querySelector('[data-admin-subscriber-type]').addEventListener('change', refreshSubscribers);
  root.querySelectorAll('[data-admin-edit-cancel]').forEach(button => button.addEventListener('click', () => root.querySelector('[data-admin-edit-dialog]').close()));
  root.querySelector('[data-admin-edit-form]').addEventListener('submit', async event => {
    event.preventDefault();
    if (!selectedProfile) return;
    const form = event.currentTarget;
    const changes = Object.fromEntries(PROFILE_FIELDS.filter(([, , type]) => !['json', 'tags'].includes(type)).map(([name]) => [name, form.elements[name].value]));
    changes.tags = form.elements.tags.value.split(',').map(tag => tag.trim()).filter(Boolean);
    changes.is_featured = form.elements.is_featured.checked;
    for (const [name] of PROFILE_FIELDS.filter(([, , type]) => type === 'json')) {
      const text = form.elements[name].value.trim();
      if (!text) { changes[name] = name === 'booking_hours' ? null : []; continue; }
      try { changes[name] = JSON.parse(text); }
      catch { showStatus(`${name.replaceAll('_', ' ')} must be valid JSON.`, true); form.elements[name].focus(); return; }
    }
    if (!window.confirm(`Save changes to ${selectedProfile.display_name}?`)) return;
    try {
      await call('admin_update_directory_profile', { target_profile: selectedProfile.id, profile_changes: changes });
      root.querySelector('[data-admin-edit-dialog]').close();
      selectedProfile = null;
      await refreshListings();
    } catch (error) { showStatus(error.message, true); }
  });
  client.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') { requestGeneration++; setAuthorized(false); showStatus('Sign in with the ControlandChaos V2 account to continue.'); }
    if (event === 'SIGNED_IN') authorize();
  });
  root.querySelector('[data-admin-signin]').addEventListener('click', () => { window.location.href = '/auth.html'; });
  root.querySelector('[data-admin-signout]').addEventListener('click', async () => {
    await client.auth.signOut();
    setAuthorized(false);
    showStatus('Signed out.');
  });
  await authorize();
}

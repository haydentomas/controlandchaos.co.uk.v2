import { myCreatorBlogSubscriptions, myDirectorySubscriptions, subscriptionLabel } from './creator-profile-api.js';
import { publicImageUrl } from './directory-api.js';

export function initAccountDirectory(client) {
  const panel = document.querySelector('[data-account-directory]');
  const status = panel.querySelector('[data-subscription-status]');
  const list = panel.querySelector('[data-subscription-list]');
  let generation = 0;
  const clear = () => { list.replaceChildren(); status.textContent = ''; };
  client.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') { generation++; clear(); } });
  return async user => {
    const active = ++generation;
    clear();
    if (!user) return;
    status.textContent = 'Checking subscription...';
    try {
      const subscriptions = await myDirectorySubscriptions(client);
      if (active !== generation) return;
      status.textContent = subscriptions.length ? '' : 'No directory subscription. Subscribe at the in-world terminal using your linked avatar.';
      for (const subscription of subscriptions) {
        const row = document.createElement('div');
        row.className = 'account-subscription-row';
        const label = document.createElement('p');
        label.textContent = subscriptionLabel(subscription);
        row.append(label);
        if (subscription.is_active === true && subscription.profile_id) {
          const link = document.createElement('a');
          link.className = 'btn btn-gold';
          link.textContent = 'Edit profile';
          const url = new URL('/directory-editor', location.origin);
          url.searchParams.set('profile', subscription.profile_id);
          link.href = `${url.pathname}${url.search}`;
          row.append(link);
        } else {
          const notice = document.createElement('p');
          notice.className = 'text-muted';
          notice.textContent = subscription.is_active ? 'Profile assignment is pending.' : 'Paid editing is unavailable. Your profile content is retained.';
          row.append(notice);
        }
        list.append(row);
      }
    } catch { if (active === generation) status.textContent = 'Unable to check subscription access. Refresh your account to try again.'; }
  };
}

export function initAccountCreatorSubscriptions(client) {
  const panel = document.querySelector('[data-account-creator-subscriptions]');
  const status = panel.querySelector('[data-creator-subscription-status]');
  const list = panel.querySelector('[data-creator-subscription-list]');
  let generation = 0;
  const clear = () => { list.replaceChildren(); status.textContent = ''; };
  client.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') { generation++; clear(); } });
  return async user => {
    const active = ++generation;
    clear();
    if (!user) return;
    status.textContent = 'Checking creator subscriptions...';
    try {
      const subscriptions = await myCreatorBlogSubscriptions(client);
      if (active !== generation) return;
      status.textContent = subscriptions.length ? '' : 'No creator subscriptions are linked to this account.';
      const profileIds = [...new Set(subscriptions.map(subscription => subscription.creator_profile_id).filter(Boolean))];
      const profileImages = new Map();
      if (profileIds.length) {
        try {
          const { data, error } = await client.from('directory_profiles').select('id,avatar_image').in('id', profileIds);
          if (!error && Array.isArray(data)) {
            for (const profile of data) profileImages.set(profile.id, publicImageUrl(profile.avatar_image));
          }
        } catch { /* Profile images are optional; initials remain available. */ }
      }
      if (active !== generation) return;
      for (const subscription of subscriptions) {
        const row = document.createElement('div');
        row.className = 'account-creator-subscription-card';
        const avatar = document.createElement('div');
        avatar.className = 'account-creator-avatar';
        const initials = document.createElement('span');
        initials.textContent = String(subscription.creator_name || '?').trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join('').toUpperCase();
        avatar.append(initials);
        const imageUrl = profileImages.get(subscription.creator_profile_id);
        if (imageUrl) {
          const image = document.createElement('img');
          image.src = imageUrl;
          image.alt = `${subscription.creator_name} profile`;
          image.addEventListener('error', () => image.remove());
          avatar.append(image);
        }
        const content = document.createElement('div');
        content.className = 'account-creator-card-content';
        const name = document.createElement('strong');
        name.textContent = subscription.creator_name;
        const state = document.createElement('span');
        state.className = `account-creator-card-status${subscription.is_active ? '' : ' is-inactive'}`;
        state.textContent = subscription.is_active ? 'Active' : 'Inactive';
        const expiry = new Date(subscription.expires_at);
        const expiryLabel = Number.isNaN(expiry.getTime()) ? 'expiry unavailable' : `expires ${expiry.toLocaleString()}`;
        const expiryText = document.createElement('span');
        expiryText.className = 'account-creator-card-expiry';
        expiryText.textContent = expiryLabel;
        content.append(name, state, expiryText);
        const link = document.createElement('a');
        link.className = subscription.is_active ? 'btn btn-gold' : 'btn btn-secondary';
        link.textContent = 'Open profile & blog';
        link.setAttribute('aria-label', `Open ${subscription.creator_name}'s creator blog and profile`);
        const query = new URLSearchParams({ slug: subscription.creator_slug });
        link.href = `/directory-profile?${query}`;
        row.append(avatar, content, link);
        list.append(row);
      }
    } catch { if (active === generation) status.textContent = 'Unable to check creator subscriptions. Refresh your account to try again.'; }
  };
}
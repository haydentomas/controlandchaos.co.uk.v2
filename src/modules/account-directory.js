import { myDirectorySubscriptions, subscriptionLabel } from './creator-profile-api.js';

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
          const url = new URL('/directory-editor.html', location.origin);
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
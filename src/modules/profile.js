export function initProfile() {
  const whiteLabel = document.documentElement.dataset.template.includes('white-label');
  const profilePage = tab => tab === 'ratecard' ? `/profile${whiteLabel ? '-white-label' : ''}` : `/profile-${tab}${whiteLabel ? '-white-label' : ''}`;
  for (const tab of ['ratecard', 'blog', 'feed', 'gallery']) {
    document.getElementById(`tab-btn-${tab}`)?.addEventListener('click', () => {
      location.href = profilePage(tab) + '#profile-tabs-nav';
    });
  }
}
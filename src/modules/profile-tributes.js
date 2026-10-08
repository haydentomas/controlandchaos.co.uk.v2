import { createElement, Gift, Trophy, Copy, X, RefreshCw, ExternalLink } from 'lucide';

const money = value => `L$${Number(value || 0).toLocaleString('en-US')}`;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function node(tag, className = '', text = '') {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function iconButton(icon, label) {
  const button = node('button', 'tribute-icon-button');
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.append(createElement(icon, { width: 18, height: 18, 'aria-hidden': 'true' }));
  return button;
}

function dialog(title, id) {
  const element = node('dialog', 'tribute-dialog');
  element.setAttribute('aria-labelledby', id);
  const header = node('header', 'tribute-dialog-heading');
  const heading = node('h2', '', title);
  heading.id = id;
  const close = iconButton(X, 'Close');
  header.append(heading, close);
  element.append(header);
  close.onclick = () => element.close();
  element.onclick = event => { if (event.target === element) element.close(); };
  return element;
}

export function renderProfileTributes(root, profile, summary) {
  root.replaceChildren();
  root.hidden = false;
  const header = node('header', 'tribute-heading');
  const heading = node('h2', 'public-profile-section-title', 'Tributes');
  const leaderboard = iconButton(Trophy, 'Tribute leaderboard');
  leaderboard.dataset.tributeLeaderboard = '';
  const refresh = iconButton(RefreshCw, 'Refresh tribute totals');
  refresh.dataset.tributeRefresh = '';
  header.append(heading, leaderboard, refresh);
  const total = node('strong', 'tribute-total');
  total.dataset.tributeTotal = '';
  const count = node('span', 'tribute-count');
  const goalTitle = node('p', 'tribute-goal-title');
  const progress = node('progress', 'tribute-progress');
  progress.setAttribute('aria-label', 'Tribute goal progress');
  const goalStatus = node('p', 'tribute-goal-status');
  const tribute = node('button', 'btn btn-gold tribute-action', 'Tribute in Second Life');
  tribute.type = 'button';
  tribute.dataset.tributeOpen = '';
  tribute.prepend(createElement(Gift, { width: 18, height: 18, 'aria-hidden': 'true' }));
  const caption = node('p', 'tribute-caption', 'Tributes paid in-world appear here after confirmation.');
  const status = node('p', 'tribute-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const paymentDialog = dialog(`Tribute to ${profile.display_name}`, 'tribute-payment-title');
  paymentDialog.dataset.tributePaymentDialog = '';
  paymentDialog.append(node('p', 'tribute-dialog-intro', 'A gift in Linden dollars, sent directly to this creator. No website login required.'));
  const steps = node('ol', 'tribute-steps');
  for (const text of ['Copy the creator UUID below.', 'Open the terminal in SL and choose Tribute.', 'Paste the UUID, choose name visibility and amount, then pay.']) steps.append(node('li', '', text));
  paymentDialog.append(steps);
  const uuidRow = node('div', 'tribute-uuid-row');
  const recipient = node('code', '');
  recipient.dataset.tributeUuid = '';
  const copy = iconButton(Copy, 'Copy creator UUID');
  copy.dataset.tributeCopy = '';
  uuidRow.append(recipient, copy);
  const copyStatus = node('p', 'tribute-status');
  copyStatus.setAttribute('role', 'status');
  const teleport = node('a', 'btn btn-gold tribute-action', 'Open tribute terminal in SL');
  teleport.dataset.tributeTeleport = '';
  teleport.target = '_blank';
  teleport.rel = 'noopener';
  teleport.prepend(createElement(ExternalLink, { width: 18, height: 18, 'aria-hidden': 'true' }));
  const terminalStatus = node('p', 'tribute-status');
  paymentDialog.append(uuidRow, copyStatus, teleport, terminalStatus, node('p', 'tribute-caption', 'Tributes do not unlock subscriber content. Choose Anonymous at the terminal to keep your name off the leaderboard.'));

  const rankingDialog = dialog('Tribute leaderboard', 'tribute-ranking-title');
  rankingDialog.dataset.tributeRankingDialog = '';
  const biggest = node('p', 'tribute-biggest');
  const list = node('ol', 'tribute-leaders');
  const empty = node('p', 'tribute-dialog-intro', 'The first named tribute takes the lead.');
  rankingDialog.append(node('span', 'tribute-eyebrow', 'All-time supporters'), biggest, list, empty,
    node('p', 'tribute-caption', 'Only tributes shared with a public name appear in these rankings. Anonymous tributes still count toward the total.'));
  root.append(header, total, count, goalTitle, progress, goalStatus, tribute, caption, status, paymentDialog, rankingDialog);
  tribute.onclick = () => { copyStatus.textContent = ''; paymentDialog.showModal(); };
  leaderboard.onclick = () => rankingDialog.showModal();
  let current = summary;
  copy.onclick = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(current.creator_avatar_uuid);
      copyStatus.textContent = 'Creator UUID copied.';
    } catch { copyStatus.textContent = 'Select and copy the creator UUID above.'; }
  };
  const update = data => {
    current = data;
    total.textContent = money(data.total_linden);
    count.textContent = `${Number(data.count || 0).toLocaleString('en-US')} ${Number(data.count) === 1 ? 'tribute' : 'tributes'} received`;
    const goal = Number(data.goal_linden || 0);
    const received = Number(data.total_linden || 0);
    goalTitle.hidden = progress.hidden = goalStatus.hidden = goal <= 0;
    goalTitle.textContent = data.goal_title || 'Tribute goal';
    progress.max = Math.max(1, goal);
    progress.value = Math.min(received, Math.max(1, goal));
    progress.setAttribute('aria-valuetext', `${money(received)} of ${money(goal)}`);
    goalStatus.textContent = received >= goal ? `${money(goal)} goal reached` : `${money(Math.max(0, goal - received))} to ${money(goal)} goal`;
    root.classList.toggle('tribute-goal-complete', goal > 0 && received >= goal);
    recipient.textContent = data.creator_avatar_uuid || 'Creator UUID unavailable';
    copy.disabled = !uuidPattern.test(data.creator_avatar_uuid || '');
    tribute.disabled = copy.disabled;
    const terminal = String(data.terminal_slurl || '');
    const validTerminal = /^secondlife:\/\/[^\s]+$/.test(terminal);
    teleport.hidden = !validTerminal;
    teleport.href = validTerminal ? terminal : '#';
    terminalStatus.hidden = validTerminal;
    terminalStatus.textContent = validTerminal ? '' : 'The tribute terminal location is not configured yet.';
    list.replaceChildren(...(data.leaders || []).slice(0, 10).map((leader, index) => {
      const item = node('li', '');
      item.append(node('span', 'tribute-rank', String(index + 1)), node('span', 'tribute-leader-name', leader.name), node('strong', '', money(leader.total_linden)));
      return item;
    }));
    empty.hidden = list.children.length > 0;
    biggest.hidden = !data.biggest;
    biggest.textContent = data.biggest ? `Biggest public tribute: ${money(data.biggest.amount_linden)} from ${data.biggest.name}` : '';
    status.textContent = '';
  };
  update(summary);
  return { update, refresh, status, close() { if (paymentDialog.open) paymentDialog.close(); if (rankingDialog.open) rankingDialog.close(); } };
}

export async function initProfileTributes(root, client, profile) {
  if (!root || typeof window === 'undefined') return;
  let view;
  let loading = false;
  let timer;
  let stopped = false;
  const refresh = async () => {
    if (loading || stopped) return;
    loading = true;
    if (view) view.refresh.disabled = true;
    try {
      const { data, error } = await client.rpc('tribute_public_summary', { target_profile: profile.id });
      if (stopped) return;
      if (error) throw error;
      if (!data) { view?.close(); root.hidden = true; return; }
      root.hidden = false;
      if (view) view.update(data);
      else { view = renderProfileTributes(root, profile, data); view.refresh.onclick = refresh; }
    } catch { if (view) view.status.textContent = 'Tribute totals are temporarily unavailable.'; }
    finally { loading = false; if (view) view.refresh.disabled = false; }
  };
  const start = () => { stopped = false; clearInterval(timer); timer = setInterval(() => { if (!document.hidden) refresh(); }, 30000); };
  window.addEventListener('focus', refresh);
  window.addEventListener('pagehide', event => {
    stopped = true;
    clearInterval(timer);
    view?.close();
    if (!event.persisted) window.removeEventListener('focus', refresh);
  });
  window.addEventListener('pageshow', event => { if (event.persisted) { start(); refresh(); } });
  await refresh();
  start();
}

export function initTributeSettings(root) {
  const fields = root.querySelector('fieldset');
  const enabled = root.querySelector('[data-tribute-enabled]');
  const goal = root.querySelector('[data-tribute-goal]');
  const title = root.querySelector('[data-tribute-goal-title]');
  const save = root.querySelector('[data-tribute-save]');
  const status = root.querySelector('[data-tribute-settings-status]');
  let client;
  let profileId;
  let generation = 0;
  const clear = () => { generation++; profileId = null; fields.disabled = true; enabled.checked = false; goal.value = '0'; title.value = ''; status.textContent = ''; };
  save.onclick = async () => {
    if (!profileId || fields.disabled || !goal.reportValidity() || !title.reportValidity()) return;
    const active = generation;
    fields.disabled = true;
    status.textContent = 'Saving tribute settings...';
    try {
      const { error, data } = await client.rpc('tribute_save_settings', { target_profile: profileId, enabled: enabled.checked, goal_linden: Number(goal.value), goal_title: title.value });
      if (error || data !== true) throw new Error('Save failed');
      if (active === generation) status.textContent = 'Tribute settings saved.';
    } catch { if (active === generation) status.textContent = 'Tribute settings were not saved. Please try again.'; }
    finally { if (active === generation && profileId) fields.disabled = false; }
  };
  clear();
  return {
    clear,
    async load(nextClient, id) {
      clear();
      const active = generation;
      client = nextClient;
      try {
        const { data, error } = await client.rpc('tribute_owner_settings', { target_profile: id });
        if (active !== generation) return;
        if (error || !data) throw new Error('Unavailable');
        profileId = id;
        enabled.checked = data.enabled === true;
        goal.value = String(data.goal_linden || 0);
        title.value = data.goal_title || '';
        fields.disabled = false;
      } catch { if (active === generation) status.textContent = 'Tribute settings are unavailable. Migration 20 must be installed.'; }
    }
  };
}
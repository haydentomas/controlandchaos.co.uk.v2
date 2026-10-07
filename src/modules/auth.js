import { accountLinkMessage, accountRequestMessage, authenticate, callbackState, createCreatorClient, exchangeAuthCallback, exchangeTerminalLogin, setWebPassword } from './auth-api.js';
import { initAvatarVerification } from './avatar-verification.js';
import { initAccountCreatorSubscriptions, initAccountDirectory } from './account-directory.js';

export async function initAuth(providedClient, passwordVerifierFactory) {
  const status = document.querySelector('[data-account-status]');
  const container = document.querySelector('[data-account-form-container]');
  const sessionPanel = document.querySelector('[data-account-session]');
  const form = document.querySelector('[data-live-auth-form]');
  const email = form.elements.email;
  const password = form.elements.password;
  const confirmation = form.elements.confirmation;
  const submit = document.querySelector('[data-account-submit]');
  const signout = document.querySelector('[data-account-signout]');
  const changePassword = document.querySelector('[data-account-change-password]');
  const cancelPassword = document.querySelector('[data-account-cancel-password]');
  const tabs = [...document.querySelectorAll('[data-account-mode]')];
  let mode = 'signin';
  let recovery = false;
  let editingPassword = false;
  let busy = false;
  let client;
  let refreshDirectory;
  let refreshCreatorSubscriptions;
  let refreshGeneration = 0;
  const message = value => { status.textContent = value; };
  const setBusy = value => {
    busy = value;
    form.setAttribute('aria-busy', String(value));
    for (const control of [...tabs, submit, signout, changePassword, cancelPassword, email, password, confirmation]) control.disabled = value;
  };
  const showMode = value => {
    mode = value;
    const needsPassword = mode !== 'reset';
    const needsConfirmation = mode === 'signup' || mode === 'update';
    document.querySelector('[data-account-email-field]').classList.toggle('preview-hidden', mode === 'update');
    document.querySelector('[data-account-password-field]').classList.toggle('preview-hidden', !needsPassword);
    document.querySelector('[data-account-confirm-field]').classList.toggle('preview-hidden', !needsConfirmation);
    document.querySelector('[data-account-tabs]').classList.toggle('preview-hidden', mode === 'update');
    document.querySelector('[data-account-recovery-title]').classList.toggle('preview-hidden', mode !== 'update');
    cancelPassword.classList.toggle('preview-hidden', mode !== 'update' || recovery);
    email.required = mode !== 'update';
    password.required = needsPassword;
    confirmation.required = needsConfirmation;
    password.minLength = needsConfirmation ? 12 : 1;
    password.autocomplete = needsConfirmation ? 'new-password' : 'current-password';
    password.value = confirmation.value = '';
    submit.textContent = { signin: 'Sign in', signup: 'Create account', reset: 'Send reset email', update: 'Update password' }[mode];
    for (const tab of tabs) {
      const selected = tab.dataset.accountMode === mode;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      tab.classList.toggle('btn-gold', selected);
      tab.classList.toggle('btn-secondary', !selected);
    }
    const panel = document.getElementById('account-panel');
    if (mode === 'update') { panel.removeAttribute('role'); panel.removeAttribute('aria-labelledby'); }
    else { panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `account-tab-${mode}`); }
  };
  const refresh = async () => {
    const active = ++refreshGeneration;
    const { data: stored } = await client.auth.getSession();
    const { data, error } = stored?.session ? await client.auth.getUser() : { data: {}, error: null };
    if (active !== refreshGeneration) return;
    const user = error ? null : data.user;
    sessionPanel.classList.toggle('preview-hidden', !user);
    document.querySelector('[data-account-email]').textContent = user?.email || '';
    container.classList.toggle('preview-hidden', !!user && !recovery && !editingPassword);
    if (recovery && user && mode !== 'update') showMode('update');
    if (!user && mode === 'update') { recovery = false; editingPassword = false; showMode('signin'); }
    await Promise.all([refreshDirectory(user), refreshCreatorSubscriptions(user)]);
    if (user && active === refreshGeneration) document.querySelector('[data-avatar-refresh]').click();
  };
  const callback = callbackState(location.href);
  if (location.search || location.hash) history.replaceState(null, '', callback.cleanUrl);
  try { client = providedClient || createCreatorClient(); } catch { message('Account service is unavailable. Please try again later.'); return; }
  initAvatarVerification(client);
  refreshDirectory = initAccountDirectory(client);
  refreshCreatorSubscriptions = initAccountCreatorSubscriptions(client);
  const subscriptionRefresh = document.querySelector('[data-subscription-refresh]');
  subscriptionRefresh.addEventListener('click', async () => {
    subscriptionRefresh.disabled = true;
    try { await refresh(); } catch { message('Unable to refresh your account. Please try again.'); }
    finally { subscriptionRefresh.disabled = false; }
  });
  const { data: listener } = client.auth.onAuthStateChange(event => {
    if (event === 'PASSWORD_RECOVERY') recovery = true;
    if (event === 'SIGNED_OUT') { recovery = false; editingPassword = false; password.value = confirmation.value = ''; refreshGeneration++; }
    if (!busy) setTimeout(() => refresh().catch(() => message('Unable to check your account. Please try again.')), 0);
  });
  window.addEventListener('pagehide', event => { if (!event.persisted) listener.subscription.unsubscribe(); });
  window.addEventListener('pageshow', event => {
    if (event.persisted) refresh().catch(() => message('Unable to check your account. Please try again.'));
  });
  window.addEventListener('hashchange', () => {
    const next = callbackState(location.href);
    if (next.terminalToken || next.terminalSetup) location.reload();
  });

  for (const tab of tabs) {
    tab.addEventListener('click', () => { if (!busy) { showMode(tab.dataset.accountMode); message(''); } });
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || busy) return;
      event.preventDefault();
      const position = tabs.indexOf(tab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (position + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].click();
      tabs[next].focus();
    });
  }
  changePassword.addEventListener('click', () => {
    if (busy) return;
    editingPassword = true;
    showMode('update');
    container.classList.remove('preview-hidden');
    message('Set a web password for the account email shown above. Opening a reset email or a terminal login does not itself change your password.');
    password.focus();
  });
  cancelPassword.addEventListener('click', () => {
    if (busy) return;
    editingPassword = false;
    showMode('signin');
    container.classList.add('preview-hidden');
    message('');
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    const action = mode;
    if ((action === 'signup' || action === 'update') && password.value !== confirmation.value) { message('The passwords do not match.'); confirmation.focus(); return; }
    if (action === 'update' && !recovery && !editingPassword) { message('Sign in or open a valid password reset link first.'); return; }
    setBusy(true);
    message('Please wait...');
    try {
      if (action === 'update') {
        try {
          const accountEmail = await setWebPassword(client, { password: password.value, confirmation: confirmation.value }, passwordVerifierFactory);
          if (recovery) {
            const { error: signOutError } = await client.auth.signOut({ scope: 'local' });
            if (signOutError) { message('Password updated and web sign-in verified, but sign-out failed. Keep this session open.'); return; }
          }
          recovery = false;
          editingPassword = false;
          showMode('signin');
          message(`Password updated and web sign-in verified for ${accountEmail}. Use your new password to sign in.`);
        } catch (error) {
          message(error.message);
        }
        await refresh();
        return;
      }
      const { error } = await authenticate(client, { mode: action, email: email.value, password: password.value, confirmation: confirmation.value, locationUrl: location.href });
      if (error) {
        message(accountRequestMessage(error));
        return;
      }
      if (action === 'signup') message('Check your email to confirm your account. Open the link in this same browser.');
      if (action === 'reset') message('If this address can receive a reset email, it will arrive shortly. Open the link in this same browser.');
      if (action === 'signin') message('Signed in.');
      form.reset();
      await refresh();
    } catch { message('Unable to complete this request. Please try again later.'); }
    finally { password.value = confirmation.value = ''; setBusy(false); }
  });
  signout.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw error;
      recovery = false;
      showMode('signin');
      await refresh();
      message('Signed out.');
    } catch { message('Unable to sign out. Please try again.'); }
    finally { setBusy(false); }
  });
  try {
    if (callback.terminalToken) {
      setBusy(true);
      try {
        const { error } = await exchangeTerminalLogin(client, callback.terminalToken);
        message(error ? 'Terminal link could not be completed. Request a fresh link from My Account on the terminal.' : 'Signed in from Second Life.');
      } catch { message('Terminal link expired or could not be completed. Request a fresh link from My Account on the terminal.'); }
    } else if (callback.terminalSetup) {
      showMode('signup');
      message('Create your account, confirm your email, then link your avatar using the terminal. Existing accounts can sign in instead.');
    } else if (callback.error || callback.unsupportedToken) message(accountLinkMessage(callback));
    else if (callback.code) {
      setBusy(true);
      const { error } = await exchangeAuthCallback(client, callback);
      message(error ? accountLinkMessage(callback) : 'Account link confirmed.');
    } else message('');
    await refresh();
  } catch { message('Unable to check your account. Please try again.'); }
  finally { setBusy(false); }
}
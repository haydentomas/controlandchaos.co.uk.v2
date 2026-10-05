import { accountLinkMessage, accountRequestMessage, authenticate, callbackState, createCreatorClient, exchangeAuthCallback } from './auth-api.js';
import { initAvatarVerification } from './avatar-verification.js';

export async function initAuth() {
  const status = document.querySelector('[data-account-status]');
  const container = document.querySelector('[data-account-form-container]');
  const sessionPanel = document.querySelector('[data-account-session]');
  const form = document.querySelector('[data-live-auth-form]');
  const email = form.elements.email;
  const password = form.elements.password;
  const confirmation = form.elements.confirmation;
  const submit = document.querySelector('[data-account-submit]');
  const signout = document.querySelector('[data-account-signout]');
  const tabs = [...document.querySelectorAll('[data-account-mode]')];
  let mode = 'signin';
  let recovery = false;
  let busy = false;
  let client;
  const message = value => { status.textContent = value; };
  const setBusy = value => {
    busy = value;
    form.setAttribute('aria-busy', String(value));
    for (const control of [...tabs, submit, signout]) control.disabled = value;
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
    const { data: stored } = await client.auth.getSession();
    const { data, error } = stored?.session ? await client.auth.getUser() : { data: {}, error: null };
    const user = error ? null : data.user;
    sessionPanel.classList.toggle('preview-hidden', !user);
    document.querySelector('[data-account-email]').textContent = user?.email || '';
    container.classList.toggle('preview-hidden', !!user && !recovery);
    if (recovery && user && mode !== 'update') showMode('update');
    if (!user && mode === 'update') { recovery = false; showMode('signin'); }
  };
  const callback = callbackState(location.href);
  if (location.search || location.hash) history.replaceState(null, '', callback.cleanUrl);
  try { client = createCreatorClient(); } catch { message('Account service is unavailable. Please try again later.'); return; }
  initAvatarVerification(client);
  const { data: listener } = client.auth.onAuthStateChange(event => {
    if (event === 'PASSWORD_RECOVERY') recovery = true;
    if (event === 'SIGNED_OUT') recovery = false;
    if (!busy) setTimeout(() => refresh().catch(() => message('Unable to check your account. Please try again.')), 0);
  });
  window.addEventListener('pagehide', event => { if (!event.persisted) listener.subscription.unsubscribe(); });
  window.addEventListener('pageshow', event => {
    if (event.persisted) refresh().catch(() => message('Unable to check your account. Please try again.'));
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
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    const action = mode;
    if ((action === 'signup' || action === 'update') && password.value !== confirmation.value) { message('The passwords do not match.'); confirmation.focus(); return; }
    if (action === 'update' && !recovery) { message('Open a valid password reset link first.'); return; }
    setBusy(true);
    message('Please wait...');
    try {
      const { error } = await authenticate(client, { mode: action, email: email.value, password: password.value, confirmation: confirmation.value, locationUrl: location.href });
      if (error) {
        message(accountRequestMessage(error));
        return;
      }
      if (action === 'signup') message('Check your email to confirm your account. Open the link in this same browser.');
      if (action === 'reset') message('If this address can receive a reset email, it will arrive shortly. Open the link in this same browser.');
      if (action === 'signin') message('Signed in.');
      if (action === 'update') {
        recovery = false;
        await client.auth.signOut({ scope: 'local' });
        showMode('signin');
        message('Password updated. Sign in with your new password.');
      }
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
    if (callback.error || callback.unsupportedToken) message(accountLinkMessage(callback));
    else if (callback.code) {
      setBusy(true);
      const { error } = await exchangeAuthCallback(client, callback);
      message(error ? accountLinkMessage(callback) : 'Account link confirmed.');
    } else message('');
    await refresh();
  } catch { message('Unable to check your account. Please try again.'); }
  finally { setBusy(false); }
}
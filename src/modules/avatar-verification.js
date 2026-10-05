export async function requestAvatarChallenge(client) {
  const { data, error } = await client.rpc('request_avatar_verification');
  if (error || !data?.[0]?.challenge_code) throw new Error('Unable to create verification code. Wait a minute and try again.');
  return data[0];
}

export async function verifiedAvatars(client) {
  const { data, error } = await client.rpc('my_verified_avatars');
  if (error || !Array.isArray(data)) throw new Error('Avatar verification is not configured yet.');
  return data;
}

export function initAvatarVerification(client) {
  const panel = document.querySelector('[data-avatar-verification]');
  const status = panel.querySelector('[data-avatar-status]');
  const code = panel.querySelector('[data-avatar-code]');
  const request = panel.querySelector('[data-avatar-request]');
  const refresh = panel.querySelector('[data-avatar-refresh]');
  let generation = 0;
  const clear = () => { code.textContent = ''; code.classList.add('preview-hidden'); };
  client.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') { generation++; clear(); status.textContent = ''; } });
  request.addEventListener('click', async () => {
    const active = generation;
    request.disabled = true;
    clear();
    try {
      const challenge = await requestAvatarChallenge(client);
      if (active !== generation) return;
      code.textContent = challenge.challenge_code;
      code.classList.remove('preview-hidden');
      status.textContent = `Enter this code at the V2 verification kiosk before ${new Date(challenge.expires_at).toLocaleTimeString()}.`;
    } catch (error) { if (active === generation) status.textContent = error.message; }
    finally { request.disabled = false; }
  });
  refresh.addEventListener('click', async () => {
    const active = generation;
    refresh.disabled = true;
    try {
      const avatars = await verifiedAvatars(client);
      if (active !== generation) return;
      status.textContent = avatars.length ? `Verified avatar: ${avatars.map(avatar => avatar.sl_username || avatar.avatar_uuid).join(', ')}` : 'No verified avatar linked yet.';
      if (avatars.length) clear();
    } catch (error) { if (active === generation) status.textContent = error.message; }
    finally { refresh.disabled = false; }
  });
}
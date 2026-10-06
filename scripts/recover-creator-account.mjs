import { createClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';

const projectUrl = 'https://fqzcaragavsutdkswsnm.supabase.co';
const authOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

export async function recoverCreatorAccount(environment, clientFactory = createClient) {
  const email = environment.CC_RECOVERY_EMAIL?.trim().toLowerCase();
  const userId = environment.CC_RECOVERY_USER_ID?.trim();
  const password = environment.CC_RECOVERY_PASSWORD;
  if (environment.SUPABASE_URL !== projectUrl) throw new Error('Recovery refused: use the approved V2 project only.');
  if (!environment.SUPABASE_SECRET_KEY?.startsWith('sb_secret_')) throw new Error('Recovery refused: a V2 secret key is required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '') || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(userId || '')) {
    throw new Error('Recovery refused: enter the account email and its UUID from Supabase Authentication > Users.');
  }
  if (typeof password !== 'string' || password.length < 12) throw new Error('Recovery refused: use a password of at least 12 characters.');

  const admin = clientFactory(projectUrl, environment.SUPABASE_SECRET_KEY, authOptions);
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user) throw new Error('Account lookup failed. Use the UID from Authentication > Users, not an avatar/profile UUID; also check the project and key. No password was changed.');
  if (data.user.id !== userId || data.user.email?.toLowerCase() !== email) {
    throw new Error('Recovery refused: the UUID does not match the supplied email. No password was changed.');
  }
  if (!data.user.email_confirmed_at) throw new Error('Recovery refused: this account needs email confirmation. No password was changed.');
  if (data.user.banned_until && Date.parse(data.user.banned_until) > Date.now()) {
    throw new Error('Recovery refused: this account is banned. No password was changed.');
  }
  const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password });
  if (updateError) throw new Error('Password update failed. Check Supabase Auth logs and password policy; do not assume the password changed.');

  const verifier = clientFactory(projectUrl, environment.SUPABASE_SECRET_KEY, authOptions);
  const { data: signedIn, error: signInError } = await verifier.auth.signInWithPassword({ email, password });
  if (signInError || !signedIn?.session || signedIn.user?.id !== userId) {
    throw new Error('Password was updated, but normal password sign-in could not be verified. Check Supabase Auth logs; do not rerun blindly.');
  }
  const { error: signOutError } = await verifier.auth.signOut({ scope: 'local' });
  if (signOutError) throw new Error('Password sign-in succeeded, but cleanup of the verification session failed. Other browser sessions were not deliberately signed out.');
  return 'Password updated and normal password sign-in verified. Use the new password on the V2 site. No email was sent and no profile permissions were changed.';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(await recoverCreatorAccount(process.env));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.CC_RECOVERY_PASSWORD;
  }
}

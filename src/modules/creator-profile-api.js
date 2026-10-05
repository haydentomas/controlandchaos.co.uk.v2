export const CREATOR_PROFILE_COLUMNS = 'id,slug,display_name,sl_username,role_type,headline,tagline,about,avatar_image,banner_image,starting_rate,availability,tags,is_published,is_approved';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const limits = { display_name: 100, headline: 160, tagline: 1000, about: 20000, starting_rate: 100 };
const editable = new Set([...Object.keys(limits), 'role_type', 'avatar_image', 'banner_image', 'availability', 'tags', 'is_published']);

export async function myDirectorySubscriptions(client) {
  const { data, error } = await client.rpc('my_directory_subscriptions');
  if (error || !Array.isArray(data)) throw new Error('Unable to check subscription access.');
  return data;
}

export function profileChanges(values) {
  if (!values || typeof values !== 'object' || Object.keys(values).some(name => !editable.has(name))) throw new Error('Invalid profile fields.');
  const changes = {};
  for (const [name, maximum] of Object.entries(limits)) {
    const value = values[name];
    if (typeof value !== 'string' || value.length > maximum || (name === 'display_name' && !value.trim())) throw new Error(`Check ${name.replaceAll('_', ' ')}.`);
    changes[name] = value.trim();
  }
  if (!['domme', 'sub', 'switch'].includes(values.role_type) || !['available', 'busy', 'away', 'offline'].includes(values.availability) || typeof values.is_published !== 'boolean') throw new Error('Invalid profile settings.');
  for (const name of ['avatar_image', 'banner_image']) {
    const value = values[name];
    if (typeof value !== 'string' || value.length > 2048 || (value && !/^(\/[^/]|https?:\/\/)[^\s]+$/.test(value))) throw new Error('Use a valid image URL or site image path.');
    changes[name] = value;
  }
  if (!Array.isArray(values.tags) || values.tags.length > 20 || values.tags.some(tag => typeof tag !== 'string' || !tag.trim()) || new TextEncoder().encode(values.tags.join('|')).length > 2000) throw new Error('Use up to 20 non-empty tags.');
  return { ...changes, role_type: values.role_type, availability: values.availability, is_published: values.is_published, tags: [...new Set(values.tags.map(tag => tag.trim()))] };
}

async function requireOwnedSubscription(client, profileId) {
  if (!uuid.test(profileId || '')) throw new Error('Invalid profile.');
  const subscriptions = await myDirectorySubscriptions(client);
  if (!subscriptions.some(subscription => subscription.profile_id === profileId && subscription.is_active === true)) throw new Error('An active subscription is required to edit this profile.');
}

export async function loadCreatorProfile(client, profileId) {
  await requireOwnedSubscription(client, profileId);
  const { data, error } = await client.from('directory_profiles').select(CREATOR_PROFILE_COLUMNS).eq('id', profileId).maybeSingle();
  if (error || !data) throw new Error('Profile unavailable or access has expired.');
  return data;
}

export async function saveCreatorProfile(client, profileId, values) {
  const changes = profileChanges(values);
  await requireOwnedSubscription(client, profileId);
  const { data, error } = await client.from('directory_profiles').update(changes).eq('id', profileId).select(CREATOR_PROFILE_COLUMNS).maybeSingle();
  if (error || !data) throw new Error('Profile was not saved. Check your subscription and field values.');
  return data;
}

export function subscriptionLabel(subscription) {
  const plan = { basic_monthly: 'Basic Monthly', basic_lifetime: 'Basic Lifetime', vip_monthly: 'VIP Monthly', vip_lifetime: 'VIP Lifetime' }[subscription.plan_code] || 'Directory subscription';
  const expiry = new Date(subscription.expires_at);
  const duration = subscription.is_lifetime ? 'Lifetime' : Number.isNaN(expiry.getTime()) ? 'Expiry unavailable' : `Expires ${expiry.toLocaleString()}`;
  return `${plan} - ${subscription.is_active ? 'Active' : 'Inactive'} - ${duration}`;
}
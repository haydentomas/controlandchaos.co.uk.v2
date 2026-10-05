import { createClient } from '@supabase/supabase-js';

export const DIRECTORY_PAGE_SIZE = 12;
export const PUBLIC_PROFILE_COLUMNS = 'id,slug,display_name,sl_username,role_type,headline,tagline,about,avatar_image,banner_image,starting_rate,availability,tags,is_featured';

export function directoryConfig(environment = {
  VITE_SUPABASE_URL: import.meta.env?.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY
}) {
  const url = String(environment.VITE_SUPABASE_URL || '').trim();
  const publishableKey = String(environment.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!url || !publishableKey) throw new Error('Directory database is not configured.');
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.supabase.co') || !publishableKey.startsWith('sb_publishable_')) throw new Error('Use the Supabase project URL and publishable key.');
  return { url: endpoint.origin, publishableKey };
}

export function createPublicDirectoryClient(config, fetchImplementation) {
  return createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(fetchImplementation ? { global: { fetch: fetchImplementation } } : {})
  });
}

export async function fetchDirectory(client, { page = 0, search = '', role = 'all', tag = '', signal } = {}) {
  if (!Number.isInteger(page) || page < 0 || page > 100000 || !['all', 'domme', 'sub', 'switch'].includes(role) || !['', 'FinDom', 'RLV', 'VIP'].includes(tag)) throw new Error('Invalid directory filters.');
  let request = client.from('directory_profiles').select(PUBLIC_PROFILE_COLUMNS, { count: 'exact' })
    .eq('is_approved', true).eq('is_published', true)
    .order('is_featured', { ascending: false }).order('display_name', { ascending: true }).order('id', { ascending: true });
  const query = String(search).trim().slice(0, 120);
  if (query) {
    const escaped = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[%_]/g, '\\$&');
    const pattern = `"%${escaped}%"`;
    request = request.or(['display_name', 'sl_username', 'headline', 'tagline'].map(column => `${column}.ilike.${pattern}`).join(','));
  }
  if (role !== 'all') request = request.eq('role_type', role);
  if (tag) request = request.contains('tags', [tag]);
  request = request.range(page * DIRECTORY_PAGE_SIZE, (page + 1) * DIRECTORY_PAGE_SIZE - 1);
  if (signal) request = request.abortSignal(signal);
  const { data, count, error } = await request;
  if (error) throw new Error('Directory request failed.');
  if (!Array.isArray(data) || !Number.isInteger(count)) throw new Error('Invalid directory response.');
  return { profiles: data, total: count };
}

export async function fetchPublicProfile(client, slug) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '') || slug.length > 80) return null;
  const { data, error } = await client.from('directory_profiles').select(PUBLIC_PROFILE_COLUMNS)
    .eq('is_approved', true).eq('is_published', true).eq('slug', slug).maybeSingle();
  if (error) throw new Error('Profile request failed.');
  return data;
}

export function publicImageUrl(value) {
  if (!value || String(value).startsWith('//')) return '';
  try {
    const url = new URL(value, 'https://controlandchaos.co.uk');
    return ['https:', 'http:'].includes(url.protocol) ? String(value) : '';
  } catch { return ''; }
}
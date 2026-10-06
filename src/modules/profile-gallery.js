export const GALLERY_PHOTO_LIMIT = 100;
export const GALLERY_COLUMNS = 'id,title,category,description,image_url,is_published,show_in_sidebar,sort_order';
const LEGACY_GALLERY_COLUMNS = 'id,title,category,description,image_url,is_published,sort_order';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export function galleryImageUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\s\\]/.test(value) || value.startsWith('//') || !/^(\/[^/]|https:\/\/)/.test(value)) return '';
  try {
    const url = new URL(value, 'https://controlandchaosv2.netlify.app');
    return url.protocol === 'https:' && !url.username && !url.password ? value : '';
  } catch { return ''; }
}

export function validateGalleryPhotos(photos) {
  if (!Array.isArray(photos) || photos.length > GALLERY_PHOTO_LIMIT) throw new Error('Use up to 100 gallery photos.');
  const identifiers = new Set();
  return photos.map(photo => {
    if (!photo || Array.isArray(photo) || typeof photo !== 'object' || Object.keys(photo).some(name => !['id','title','category','description','image_url','is_published','show_in_sidebar'].includes(name))) throw new Error('Invalid gallery fields.');
    if (!uuid.test(photo.id || '') || identifiers.has(photo.id)) throw new Error('Invalid or duplicate photo identifier.');
    identifiers.add(photo.id);
    for (const [field, maximum] of [['title',100],['category',100],['description',2000]]) {
      if (typeof photo[field] !== 'string' || photo[field].length > maximum || (field === 'title' && !photo[field].trim())) throw new Error('Check photo titles, categories and descriptions.');
    }
    if (!galleryImageUrl(photo.image_url) || typeof photo.is_published !== 'boolean' || (photo.show_in_sidebar !== undefined && typeof photo.show_in_sidebar !== 'boolean')) throw new Error('Use a valid HTTPS image URL or site image path.');
    const result = { id: photo.id, title: photo.title.trim(), category: photo.category.trim(), description: photo.description.trim(), image_url: photo.image_url, is_published: photo.is_published };
    if (photo.show_in_sidebar !== undefined) result.show_in_sidebar = photo.show_in_sidebar;
    return result;
  });
}

export async function fetchGalleryPhotos(client, profileId, { publishedOnly = false } = {}) {
  if (!uuid.test(profileId || '')) throw new Error('Invalid gallery profile.');
  const query = columns => {
    let request = client.from('directory_gallery_photos').select(columns).eq('profile_id', profileId).order('sort_order').order('id');
    if (publishedOnly) request = request.eq('is_published', true);
    return request;
  };
  let { data, error } = await query(GALLERY_COLUMNS);
  const errorText = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
  if (error && errorText.includes('show_in_sidebar')) ({ data, error } = await query(LEGACY_GALLERY_COLUMNS));
  if (error || !Array.isArray(data)) throw new Error('Gallery could not be loaded.');
  return validateGalleryPhotos(data.map(({ sort_order, ...photo }) => photo));
}

export function renderProfileGallery(container, filters, photos) {
  const visible = validateGalleryPhotos(photos).filter(photo => photo.is_published);
  filters.replaceChildren();
  for (const category of ['', ...new Set(visible.map(photo => photo.category).filter(Boolean))]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-secondary btn-sm';
    button.dataset.photoFilter = category;
    button.textContent = category || 'All Photos';
    button.setAttribute('aria-pressed', String(!category));
    filters.append(button);
  }
  renderGalleryTiles(container, visible);
}

export function renderGalleryPreview(container, photos) {
  const visible = validateGalleryPhotos(photos).filter(photo => photo.is_published && photo.show_in_sidebar !== false);
  renderGalleryTiles(container, visible.slice(0, 4));
}

function renderGalleryTiles(container, photos) {
  container.replaceChildren();
  for (const photo of photos) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'public-gallery-tile';
    tile.setAttribute('aria-label', `View photo: ${photo.title}`);
    Object.assign(tile.dataset, { photo: photo.image_url, photoTitle: photo.title, photoCategory: photo.category, photoDescription: photo.description });
    const image = document.createElement('img');
    image.src = photo.image_url;
    image.alt = photo.title;
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    const title = document.createElement('span');
    title.textContent = photo.title;
    image.addEventListener('error', () => { image.hidden = true; title.textContent = `${photo.title} - image unavailable`; });
    tile.append(image, title);
    container.append(tile);
  }
}
export const GALLERY_PHOTO_LIMIT = 20;
export const GALLERY_BUCKET = 'directory-gallery';
export const GALLERY_COLUMNS = 'id,title,category,description,image_url,storage_path,is_published,show_in_sidebar,sort_order';
const SIDEBAR_GALLERY_COLUMNS = 'id,title,category,description,image_url,is_published,show_in_sidebar,sort_order';
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
  if (!Array.isArray(photos) || photos.length > GALLERY_PHOTO_LIMIT) throw new Error(`Use up to ${GALLERY_PHOTO_LIMIT} gallery photos.`);
  const identifiers = new Set();
  return photos.map(photo => {
    if (!photo || Array.isArray(photo) || typeof photo !== 'object' || Object.keys(photo).some(name => !['id','title','category','description','image_url','storage_path','is_published','show_in_sidebar'].includes(name))) throw new Error('Invalid gallery fields.');
    if (!uuid.test(photo.id || '') || identifiers.has(photo.id)) throw new Error('Invalid or duplicate photo identifier.');
    identifiers.add(photo.id);
    for (const [field, maximum] of [['title',100],['category',100],['description',2000]]) {
      if (typeof photo[field] !== 'string' || photo[field].length > maximum || (field === 'title' && !photo[field].trim())) throw new Error('Check photo titles, categories and descriptions.');
    }
    const storagePath = photo.storage_path || '';
    const pathParts = storagePath.split('/');
    const validStoragePath = pathParts.length === 3
      && uuid.test(pathParts[0])
      && uuid.test(pathParts[1])
      && uuid.test(pathParts[2].replace(/[.]webp$/i, ''))
      && pathParts[1].toLowerCase() === photo.id.toLowerCase()
      && /[.]webp$/i.test(pathParts[2]);
    if ((storagePath && (!validStoragePath || (photo.image_url && !galleryImageUrl(photo.image_url))))
      || (!storagePath && !galleryImageUrl(photo.image_url))
      || typeof photo.is_published !== 'boolean'
      || (photo.show_in_sidebar !== undefined && typeof photo.show_in_sidebar !== 'boolean')) throw new Error('Use a valid image URL or optimized gallery upload.');
    const result = { id: photo.id, title: photo.title.trim(), category: photo.category.trim(), description: photo.description.trim(), image_url: photo.image_url || '', is_published: photo.is_published };
    if (storagePath) result.storage_path = storagePath;
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
  let result = await query(GALLERY_COLUMNS);
  for (const columns of [SIDEBAR_GALLERY_COLUMNS, LEGACY_GALLERY_COLUMNS]) {
    if (!result.error) break;
    const errorText = `${result.error.message || ''} ${result.error.details || ''} ${result.error.hint || ''}`;
    if (!['storage_path', 'show_in_sidebar'].some(column => errorText.includes(column))) break;
    result = await query(columns);
  }
  let { data, error } = result;
  if (error || !Array.isArray(data)) throw new Error('Gallery could not be loaded.');
  const photos = validateGalleryPhotos(data.map(({ sort_order, ...photo }) => photo));
  return Promise.all(photos.map(async photo => {
    if (!photo.storage_path) return photo;
    if (!client.storage) throw new Error('Gallery images could not be signed.');
    const { data: signed, error: signingError } = await client.storage.from(GALLERY_BUCKET).createSignedUrl(photo.storage_path, 3600);
    if (signingError || !signed?.signedUrl) throw new Error('Gallery images could not be signed.');
    return { ...photo, image_url: signed.signedUrl };
  }));
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
import { validateGalleryPhotos, galleryImageUrl, GALLERY_PHOTO_LIMIT, GALLERY_BUCKET } from './profile-gallery.js';
import { optimizeGalleryUpload, validateGalleryUpload } from './gallery-image-upload.js';
import { initRichTextEditor, flushRichTextEditors } from './rich-text-editor.js';

export function initProfileGalleryEditor(container, addPhoto, { optimizeImage = optimizeGalleryUpload } = {}) {
  let photos = [];
  let textEditors = [];
  let savedStoragePaths = new Set();
  let expandedPhotoId = null;
  const create = (tag, className = '') => { const node = document.createElement(tag); node.className = className; return node; };
  const button = (label, name, action, disabled = false) => {
    const control = create('button', 'btn btn-secondary btn-sm');
    control.type = 'button';
    control.textContent = label;
    control.title = name;
    control.setAttribute('aria-label', name);
    control.disabled = disabled;
    control.addEventListener('click', () => { if (!container.closest('fieldset')?.disabled) action(); });
    return control;
  };
  const previewDialog = create('dialog', 'gallery-photo-preview-dialog');
  previewDialog.setAttribute('aria-labelledby', 'gallery-photo-preview-title');
  const previewDialogHeader = create('div', 'gallery-photo-preview-header');
  const previewDialogTitle = create('h2', 'account-subheading');
  previewDialogTitle.id = 'gallery-photo-preview-title';
  const previewDialogClose = create('button', 'btn btn-secondary btn-sm');
  previewDialogClose.type = 'button';
  previewDialogClose.textContent = 'Close';
  previewDialogClose.setAttribute('aria-label', 'Close photo preview');
  const previewDialogImage = create('img', 'gallery-photo-preview-image');
  previewDialogHeader.append(previewDialogTitle, previewDialogClose);
  previewDialog.append(previewDialogHeader, previewDialogImage);
  container.after(previewDialog);
  const closePreview = () => {
    if (typeof previewDialog.close === 'function' && previewDialog.open) previewDialog.close();
    else previewDialog.removeAttribute('open');
  };
  previewDialogClose.addEventListener('click', closePreview);
  previewDialog.addEventListener('click', event => { if (event.target === previewDialog) closePreview(); });
  const showPreview = (url, title) => {
    if (!url) return;
    previewDialogTitle.textContent = title || 'Photo preview';
    previewDialogImage.src = url;
    previewDialogImage.alt = title || 'Full-size photo preview';
    if (typeof previewDialog.showModal === 'function') previewDialog.showModal();
    else previewDialog.setAttribute('open', '');
  };
  const paint = () => {
    flushRichTextEditors(container);
    for (const editor of textEditors) editor.destroy();
    textEditors = [];
    container.replaceChildren();
    addPhoto.disabled = photos.length >= GALLERY_PHOTO_LIMIT;
    const count = container.closest('#creator-gallery')?.querySelector('[data-gallery-count]');
    if (count) count.textContent = `${photos.length} / ${GALLERY_PHOTO_LIMIT} photos`;
    if (!photos.length) { const empty = create('p', 'text-muted'); empty.textContent = 'No gallery photos yet.'; container.append(empty); }
    photos.forEach((photo, index) => {
      const row = create('section', 'profile-gallery-editor-item');
      row.dataset.galleryEditorPhoto = photo.id;
      const expanded = photo.id === expandedPhotoId;
      const header = create('div', 'gallery-photo-header');
      const details = create('div', 'gallery-photo-details');
      details.id = `photo-${photo.id}-details`;
      details.hidden = !expanded;
      const toggle = create('button', 'gallery-photo-toggle');
      toggle.type = 'button';
      toggle.id = `photo-${photo.id}-toggle`;
      toggle.dataset.galleryPhotoToggle = '';
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.setAttribute('aria-controls', details.id);
      const thumbnail = create('img', 'gallery-photo-thumbnail');
      thumbnail.alt = '';
      thumbnail.loading = 'lazy';
      thumbnail.referrerPolicy = 'no-referrer';
      const placeholder = create('span', 'gallery-photo-thumbnail-placeholder');
      placeholder.textContent = 'Photo';
      const summaryCopy = create('span', 'gallery-photo-summary-copy');
      const summaryTitle = create('span', 'gallery-photo-summary-title');
      const summaryMeta = create('span', 'gallery-photo-summary-meta');
      summaryCopy.append(summaryTitle, summaryMeta);
      const toggleText = create('span', 'gallery-photo-toggle-text');
      toggleText.textContent = expanded ? 'Close' : 'Edit';
      toggle.append(summaryCopy, toggleText);
      const thumbnailButton = create('button', 'gallery-photo-thumbnail-button');
      thumbnailButton.type = 'button';
      thumbnailButton.title = 'View full-size photo';
      thumbnailButton.append(thumbnail, placeholder);
      const updateSummary = () => {
        summaryTitle.textContent = photo.title || `Untitled photo ${index + 1}`;
        summaryMeta.textContent = [`Photo ${index + 1}`, photo.is_published ? 'Published' : 'Draft', photo.show_in_sidebar === false ? 'Gallery only' : 'Sidebar preview'].join(' | ');
        toggle.setAttribute('aria-label', `${expanded ? 'Close' : 'Edit'} photo ${index + 1}: ${photo.title || 'Untitled'}`);
        const url = photo.previewObjectUrl || galleryImageUrl(photo.image_url);
        thumbnail.hidden = !url;
        placeholder.hidden = !!url;
        thumbnailButton.disabled = !url;
        thumbnailButton.setAttribute('aria-label', `View full-size photo: ${photo.title || `Photo ${index + 1}`}`);
        if (url) thumbnail.src = url;
        else thumbnail.removeAttribute('src');
      };
      updateSummary();
      thumbnailButton.addEventListener('click', () => showPreview(photo.previewObjectUrl || galleryImageUrl(photo.image_url), photo.title || `Photo ${index + 1}`));
      toggle.addEventListener('click', () => {
        expandedPhotoId = expanded ? null : photo.id;
        paint();
        document.getElementById(`photo-${photo.id}-toggle`)?.focus();
      });
      const toolbar = create('div', 'gallery-photo-actions');
      const move = offset => {
        const target = index + offset;
        if (target < 0 || target >= photos.length) return;
        photos.splice(index, 1);
        photos.splice(target, 0, photo);
        paint();
        document.getElementById(`photo-${photo.id}-title`)?.focus();
      };
      toolbar.append(button('\u2191', 'Move photo up', () => move(-1), index === 0), button('\u2193', 'Move photo down', () => move(1), index === photos.length - 1), button('Remove photo', 'Remove photo', () => { if (photo.previewObjectUrl) URL.revokeObjectURL(photo.previewObjectUrl); if (expandedPhotoId === photo.id) expandedPhotoId = null; photos.splice(index, 1); paint(); }));
      header.append(thumbnailButton, toggle, toolbar);
      row.append(header, details);
      container.append(row);
      const image = create('img', 'creator-image-preview preview-hidden');
      image.alt = photo.title || 'Photo preview';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      const imageStatus = create('p', 'text-muted');
      const preview = () => {
        const url = photo.previewObjectUrl || galleryImageUrl(photo.image_url);
        imageStatus.textContent = '';
        image.classList.toggle('preview-hidden', !url);
        if (url) image.src = url;
        else image.removeAttribute('src');
        updateSummary();
      };
      image.addEventListener('error', () => { image.classList.add('preview-hidden'); imageStatus.textContent = 'Image could not be loaded.'; });
      const previewButton = create('button', 'gallery-photo-preview-button');
      previewButton.type = 'button';
      previewButton.setAttribute('aria-label', `View full-size photo: ${photo.title || 'Untitled photo'}`);
      previewButton.title = 'View full-size photo';
      previewButton.append(image);
      previewButton.addEventListener('click', () => {
        if (!image.src || image.classList.contains('preview-hidden')) return;
        showPreview(image.src, photo.title || `Photo ${index + 1}`);
      });
      const grid = create('div', 'form-grid-2');
      for (const [name, labelText, maximum] of [['title','Photo title',100],['category','Category tag',100],['image_url','Image URL (optional)',2048],['description','Photo description',2000]]) {
        const group = create('div');
        const label = create('label', 'form-label');
        const input = create(name === 'description' ? 'textarea' : 'input', name === 'description' ? 'form-textarea' : 'form-input');
        input.id = `photo-${photo.id}-${name}`;
        input.value = name === 'image_url' && photo.storage_path ? '' : photo[name];
        input.maxLength = maximum;
        input.required = name === 'title' && expanded;
        label.htmlFor = input.id;
        label.textContent = labelText;
        if (name === 'description') input.rows = 3;
        else input.type = 'text';
        input.addEventListener('input', () => {
          photo[name] = input.value;
          if (name === 'title') updateSummary();
          if (name === 'image_url' && input.value.trim()) {
            photo.storage_path = '';
            photo.pendingFile = null;
            if (photo.previewObjectUrl) URL.revokeObjectURL(photo.previewObjectUrl);
            photo.previewObjectUrl = '';
          }
          if (name === 'image_url') preview();
        });
        group.append(label, input);
        grid.append(group);
        if (name === 'description' && expanded) textEditors.push(initRichTextEditor(input));
      }
      const uploadGroup = create('div');
      const uploadLabel = create('label', 'form-label');
      const uploadInput = create('input', 'form-input');
      uploadInput.id = `photo-${photo.id}-upload`;
      uploadInput.type = 'file';
      uploadInput.accept = 'image/jpeg,image/png,image/webp';
      uploadLabel.htmlFor = uploadInput.id;
      uploadLabel.textContent = 'Choose a photo to upload';
      const uploadNote = create('p', 'text-muted');
        uploadNote.textContent = photo.pendingFile ? `${photo.pendingFile.name} is ready; it will be optimized when you save.` : photo.storage_path ? 'Private optimized WebP upload. Choose another file to replace it.' : 'JPEG, PNG or WebP; up to 10 MB. Optimized to WebP when you save.';
      uploadInput.addEventListener('change', () => {
        const file = uploadInput.files?.[0];
        if (!file) return;
        try {
          validateGalleryUpload(file);
          photo.pendingFile = file;
          photo.image_url = '';
          if (!photo.title.trim()) {
            photo.title = file.name.replace(/\.[^.]+$/, '').slice(0, 100);
            const title = document.getElementById(`photo-${photo.id}-title`);
            if (title) title.value = photo.title;
            updateSummary();
          }
          if (photo.previewObjectUrl) URL.revokeObjectURL(photo.previewObjectUrl);
          photo.previewObjectUrl = URL.createObjectURL(file);
          image.alt = photo.title || file.name || 'Photo preview';
          preview();
          uploadNote.textContent = 'Photo ready. It will be optimized and uploaded when you save the profile.';
        } catch (error) {
          uploadInput.value = '';
          uploadNote.textContent = error.message;
        }
      });
      uploadGroup.append(uploadLabel, uploadInput, uploadNote);
      const publication = create('label', 'profile-feature-switch');
      const published = create('input');
      published.type = 'checkbox';
      published.checked = photo.is_published;
      published.addEventListener('change', () => { photo.is_published = published.checked; updateSummary(); });
      const text = create('span');
      text.textContent = 'Publish photo';
      publication.append(published, text);
      const sidebarChoice = create('label', 'profile-feature-switch');
      const showInSidebar = create('input');
      showInSidebar.type = 'checkbox';
      showInSidebar.checked = photo.show_in_sidebar !== false;
      showInSidebar.addEventListener('change', () => { photo.show_in_sidebar = showInSidebar.checked; updateSummary(); });
      const sidebarText = create('span');
      sidebarText.textContent = 'Show in sidebar preview';
      sidebarChoice.append(showInSidebar, sidebarText);
      details.append(uploadGroup, grid, previewButton, imageStatus, publication, sidebarChoice);
      preview();
    });
  };
  addPhoto.addEventListener('click', () => {
    if (container.closest('fieldset')?.disabled || photos.length >= GALLERY_PHOTO_LIMIT) return;
    const photo = { id: crypto.randomUUID(), title: '', category: '', description: '', image_url: '', is_published: false, show_in_sidebar: true };
    photos.push(photo);
    expandedPhotoId = photo.id;
    paint();
    document.getElementById(`photo-${photo.id}-upload`)?.focus();
  });
  return {
    load(value) {
      for (const photo of photos) if (photo.previewObjectUrl) URL.revokeObjectURL(photo.previewObjectUrl);
      photos = validateGalleryPhotos(value);
      expandedPhotoId = null;
      savedStoragePaths = new Set(photos.map(photo => photo.storage_path).filter(Boolean));
      paint();
    },
    clear() { for (const photo of photos) if (photo.previewObjectUrl) URL.revokeObjectURL(photo.previewObjectUrl); photos = []; expandedPhotoId = null; savedStoragePaths.clear(); paint(); },
    value() {
      flushRichTextEditors(container);
      return validateGalleryPhotos(photos.map(photo => {
        const value = { ...photo };
        delete value.pendingFile;
        delete value.previewObjectUrl;
        if (value.storage_path) value.image_url = '';
        return value;
      }));
    },
    async uploadPending(profileId, storage, onProgress = () => {}) {
      if (photos.some(photo => !photo.title.trim())) throw new Error('Add a title to each gallery photo before saving.');
      const pending = photos.filter(photo => photo.pendingFile);
      if (!pending.length) return { uploaded: [], obsolete: [...savedStoragePaths] };
      if (!storage?.from) throw new Error('Photo storage is unavailable. Try again later.');
      const uploaded = [];
      try {
        for (const [index, photo] of pending.entries()) {
          onProgress(`Optimizing photo ${index + 1} of ${pending.length}...`);
          const blob = await optimizeImage(photo.pendingFile);
          if (blob.type !== 'image/webp' || blob.size > 2 * 1024 * 1024) throw new Error('Optimized photo must be WebP and no larger than 2 MB.');
          const storagePath = `${profileId}/${photo.id}/${crypto.randomUUID()}.webp`;
          onProgress(`Uploading photo ${index + 1} of ${pending.length}...`);
          const { error } = await storage.from(GALLERY_BUCKET).upload(storagePath, blob, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
          if (error) throw new Error('A photo could not be uploaded. Check your connection and try again.');
          uploaded.push({ photo, storagePath, blob, previousPath: photo.storage_path || '', previousUrl: photo.image_url || '', previousPreviewUrl: photo.previewObjectUrl || '' });
        }
        for (const item of uploaded) {
          item.photo.storage_path = item.storagePath;
          item.photo.image_url = '';
        }
        return { uploaded, obsolete: [...savedStoragePaths] };
      } catch (error) {
        if (uploaded.length) await storage.from(GALLERY_BUCKET).remove(uploaded.map(item => item.storagePath)).catch(() => {});
        throw error;
      }
    },
    async rollbackUploads(storage, batch) {
      if (!batch?.uploaded?.length) return;
      await storage.from(GALLERY_BUCKET).remove(batch.uploaded.map(item => item.storagePath)).catch(() => {});
      for (const item of batch.uploaded) {
        item.photo.storage_path = item.previousPath;
        item.photo.image_url = item.previousUrl;
        if (item.photo.previewObjectUrl && item.photo.previewObjectUrl !== item.previousPreviewUrl) URL.revokeObjectURL(item.photo.previewObjectUrl);
        item.photo.previewObjectUrl = item.previousPreviewUrl;
      }
      paint();
    },
    async commitUploads(storage, batch) {
      const active = new Set(photos.map(photo => photo.storage_path).filter(Boolean));
      for (const photo of photos) photo.pendingFile = null;
      const obsolete = (batch?.obsolete || []).filter(path => !active.has(path));
      if (obsolete.length) await storage.from(GALLERY_BUCKET).remove(obsolete).catch(() => {});
      savedStoragePaths = active;
    }
  };
}

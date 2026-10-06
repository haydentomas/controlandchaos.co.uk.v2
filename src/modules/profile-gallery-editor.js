import { validateGalleryPhotos, galleryImageUrl, GALLERY_PHOTO_LIMIT } from './profile-gallery.js';
import { initRichTextEditor, flushRichTextEditors } from './rich-text-editor.js';

export function initProfileGalleryEditor(container, addPhoto) {
  let photos = [];
  let textEditors = [];
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
  const paint = () => {
    for (const editor of textEditors) editor.destroy();
    textEditors = [];
    container.replaceChildren();
    addPhoto.disabled = photos.length >= GALLERY_PHOTO_LIMIT;
    if (!photos.length) { const empty = create('p', 'text-muted'); empty.textContent = 'No gallery photos yet.'; container.append(empty); }
    photos.forEach((photo, index) => {
      const row = create('section', 'profile-gallery-editor-item');
      row.dataset.galleryEditorPhoto = photo.id;
      const toolbar = create('div', 'creator-editor-toolbar');
      const heading = create('h3', 'account-subheading');
      heading.textContent = `Photo ${index + 1}`;
      const move = offset => {
        const target = index + offset;
        if (target < 0 || target >= photos.length) return;
        photos.splice(index, 1);
        photos.splice(target, 0, photo);
        paint();
        document.getElementById(`photo-${photo.id}-title`)?.focus();
      };
      toolbar.append(heading, button('\u2191', 'Move photo up', () => move(-1), index === 0), button('\u2193', 'Move photo down', () => move(1), index === photos.length - 1), button('Remove photo', 'Remove photo', () => { photos.splice(index, 1); paint(); }));
      row.append(toolbar);
      container.append(row);
      const image = create('img', 'creator-image-preview preview-hidden');
      image.alt = photo.title || 'Photo preview';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      const imageStatus = create('p', 'text-muted');
      const preview = () => {
        const url = galleryImageUrl(photo.image_url);
        imageStatus.textContent = '';
        image.classList.toggle('preview-hidden', !url);
        if (url) image.src = url;
        else image.removeAttribute('src');
      };
      image.addEventListener('error', () => { image.classList.add('preview-hidden'); imageStatus.textContent = 'Image could not be loaded.'; });
      const grid = create('div', 'form-grid-2');
      row.append(grid);
      for (const [name, labelText, maximum] of [['title','Photo title',100],['category','Category tag',100],['image_url','Image URL',2048],['description','Photo description',2000]]) {
        const group = create('div');
        const label = create('label', 'form-label');
        const input = create(name === 'description' ? 'textarea' : 'input', name === 'description' ? 'form-textarea' : 'form-input');
        input.id = `photo-${photo.id}-${name}`;
        input.value = photo[name];
        input.maxLength = maximum;
        input.required = name === 'title' || name === 'image_url';
        label.htmlFor = input.id;
        label.textContent = labelText;
        if (name === 'description') input.rows = 3;
        else input.type = 'text';
        input.addEventListener('input', () => { photo[name] = input.value; if (name === 'image_url') preview(); });
        group.append(label, input);
        grid.append(group);
        if (name === 'description') textEditors.push(initRichTextEditor(input));
      }
      const publication = create('label', 'profile-feature-switch');
      const published = create('input');
      published.type = 'checkbox';
      published.checked = photo.is_published;
      published.addEventListener('change', () => { photo.is_published = published.checked; });
      const text = create('span');
      text.textContent = 'Publish photo';
      publication.append(published, text);
      const sidebarChoice = create('label', 'profile-feature-switch');
      const showInSidebar = create('input');
      showInSidebar.type = 'checkbox';
      showInSidebar.checked = photo.show_in_sidebar !== false;
      showInSidebar.addEventListener('change', () => { photo.show_in_sidebar = showInSidebar.checked; });
      const sidebarText = create('span');
      sidebarText.textContent = 'Show in sidebar preview';
      sidebarChoice.append(showInSidebar, sidebarText);
      row.append(grid, image, imageStatus, publication, sidebarChoice);
      preview();
      container.append(row);
    });
  };
  addPhoto.addEventListener('click', () => {
    if (container.closest('fieldset')?.disabled || photos.length >= GALLERY_PHOTO_LIMIT) return;
    photos.push({ id: crypto.randomUUID(), title: '', category: '', description: '', image_url: '', is_published: false, show_in_sidebar: true });
    paint();
    document.getElementById(`photo-${photos.at(-1).id}-title`)?.focus();
  });
  return {
    load(value) { photos = validateGalleryPhotos(value); paint(); },
    clear() { photos = []; paint(); },
    value() { flushRichTextEditors(container); return validateGalleryPhotos(photos); }
  };
}
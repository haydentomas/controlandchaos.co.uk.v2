import { renderRichText } from './profile-rich-text.js';

export function initGallery() {
  let galleryPhotos = [];
  let photoIndex = 0;
  let previousFocus;
  const lightbox = document.getElementById('gallery-lightbox');
  const lightboxImage = document.getElementById('lightbox-image');
  const imageStatus = document.createElement('p');
  imageStatus.className = 'gallery-lightbox-description';
  imageStatus.setAttribute('role', 'status');
  lightbox?.querySelector('.lightbox-content')?.append(imageStatus);
  lightboxImage?.addEventListener('error', () => {
    lightboxImage.classList.add('preview-hidden');
    imageStatus.textContent = 'Image could not be loaded.';
  });
  const showPhoto = () => {
    const photo = galleryPhotos[photoIndex];
    if (!photo || !lightbox) return;
    const image = document.getElementById('lightbox-image');
    image.classList.remove('preview-hidden');
    imageStatus.textContent = '';
    image.src = photo.dataset.photo;
    image.alt = photo.dataset.photoTitle;
    document.getElementById('lightbox-caption').textContent = [photo.dataset.photoTitle, photo.dataset.photoCategory].filter(Boolean).join(' / ');
    const description = document.getElementById('lightbox-description');
    if (document.documentElement.dataset.template === 'directory-profile') renderRichText(description, photo.dataset.photoDescription);
    else description.textContent = photo.dataset.photoDescription;
    document.getElementById('lightbox-counter').textContent = `${photoIndex + 1} / ${galleryPhotos.length}`;
    for (const id of ['lightbox-previous', 'lightbox-next']) document.getElementById(id).hidden = galleryPhotos.length < 2;
    lightbox.classList.add('active');
    document.body.classList.add('preview-scroll-lock');
  };
  const closePhoto = () => {
    lightbox?.classList.remove('active');
    document.body.classList.remove('preview-scroll-lock');
    previousFocus?.focus({ preventScroll: true });
  };
  const stepPhoto = direction => {
    if (galleryPhotos.length) {
      photoIndex = (photoIndex + direction + galleryPhotos.length) % galleryPhotos.length;
      showPhoto();
    }
  };
  document.addEventListener('click', event => {
    const tile = event.target.closest('[data-photo]');
    if (!tile || !lightbox) return;
    galleryPhotos = [...tile.parentElement.querySelectorAll('[data-photo]')].filter(photo => !photo.classList.contains('preview-hidden'));
    photoIndex = galleryPhotos.indexOf(tile);
    previousFocus = tile;
    showPhoto();
    document.getElementById('lightbox-close')?.focus({ preventScroll: true });
  });
  document.getElementById('lightbox-close')?.addEventListener('click', closePhoto);
  document.getElementById('lightbox-previous')?.addEventListener('click', () => stepPhoto(-1));
  document.getElementById('lightbox-next')?.addEventListener('click', () => stepPhoto(1));
  lightbox?.addEventListener('click', event => { if (event.target === lightbox) closePhoto(); });
  document.addEventListener('click', event => {
    const button = event.target.closest('#gallery-library-filters button');
    if (!button) return;
    const category = button.dataset.photoFilter ?? button.textContent.trim();
    const all = button.hasAttribute('data-photo-filter') ? category === '' : category === 'All Photos';
    for (const item of document.querySelectorAll('#gallery-library-filters button')) item.setAttribute('aria-pressed', String(item === button));
    for (const tile of document.querySelectorAll('#gallery-library-grid [data-photo]')) tile.classList.toggle('preview-hidden', !all && tile.dataset.photoCategory !== category);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closePhoto();
    if (lightbox?.classList.contains('active') && event.key === 'ArrowLeft') { event.preventDefault(); stepPhoto(-1); }
    if (lightbox?.classList.contains('active') && event.key === 'ArrowRight') { event.preventDefault(); stepPhoto(1); }
    if (lightbox?.classList.contains('active') && event.key === 'Tab') {
      const controls = [...lightbox.querySelectorAll('button, a[href]')].filter(control => !control.hidden);
      const index = controls.indexOf(document.activeElement);
      event.preventDefault();
      controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
    }
  });
}
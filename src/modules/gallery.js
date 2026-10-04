export function initGallery() {
  let galleryPhotos = [];
  let photoIndex = 0;
  let previousFocus;
  const lightbox = document.getElementById('gallery-lightbox');
  const showPhoto = () => {
    const photo = galleryPhotos[photoIndex];
    if (!photo || !lightbox) return;
    const image = document.getElementById('lightbox-image');
    image.src = photo.dataset.photo;
    image.alt = photo.dataset.photoTitle;
    document.getElementById('lightbox-caption').textContent = [photo.dataset.photoTitle, photo.dataset.photoCategory].filter(Boolean).join(' / ');
    document.getElementById('lightbox-description').textContent = photo.dataset.photoDescription;
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
  for (const tile of document.querySelectorAll('[data-photo]')) tile.addEventListener('click', () => {
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
  for (const button of document.querySelectorAll('#gallery-library-filters button')) button.addEventListener('click', () => {
    const category = button.textContent.trim();
    for (const item of document.querySelectorAll('#gallery-library-filters button')) item.setAttribute('aria-pressed', String(item === button));
    for (const tile of document.querySelectorAll('#gallery-library-grid [data-photo]')) tile.classList.toggle('preview-hidden', category !== 'All Photos' && tile.dataset.photoCategory !== category);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closePhoto();
    if (lightbox?.classList.contains('active') && event.key === 'ArrowLeft') { event.preventDefault(); stepPhoto(-1); }
    if (lightbox?.classList.contains('active') && event.key === 'ArrowRight') { event.preventDefault(); stepPhoto(1); }
  });
}
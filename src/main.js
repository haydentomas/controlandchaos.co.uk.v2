import './templates.css';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const page = document.documentElement.dataset.template || 'index';
const whiteLabel = page.includes('white-label');
const profilePage = tab => tab === 'ratecard' ? `/profile${whiteLabel ? '-white-label' : ''}.html` : `/profile-${tab}${whiteLabel ? '-white-label' : ''}.html`;

for (const tab of ['ratecard', 'blog', 'feed', 'gallery']) {
	document.getElementById(`tab-btn-${tab}`)?.addEventListener('click', () => { location.href = profilePage(tab) + '#profile-tabs-nav'; });
}

const toggle = document.getElementById('nav-toggle');
const drawer = document.getElementById('mobile-nav-drawer');
function closeNavigation() {
	toggle?.classList.remove('open'); drawer?.classList.remove('open'); toggle?.setAttribute('aria-expanded', 'false');
}
toggle?.addEventListener('click', () => {
	const open = !drawer.classList.contains('open');
	drawer.classList.toggle('open', open); toggle.classList.toggle('open', open); toggle.setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', event => { if (drawer?.classList.contains('open') && !drawer.contains(event.target) && !toggle.contains(event.target)) closeNavigation(); });

for (const button of document.querySelectorAll('[data-editor-tab]')) button.addEventListener('click', () => {
	for (const pane of document.querySelectorAll('.tab-content')) pane.classList.toggle('active', pane.id === button.dataset.editorTab);
	for (const item of document.querySelectorAll('[data-editor-tab]')) item.classList.toggle('active', item === button);
});
for (const button of document.querySelectorAll('[data-open-editor]')) button.addEventListener('click', () => {
	const kind = button.dataset.openEditor;
	const panel = document.getElementById(`${kind}-post-modal`);
	const prefix = kind === 'blog' ? 'modal-blog' : 'modal-post';
	for (const field of ['title', 'content', 'tag']) { const input = document.getElementById(`${prefix}-${field}`); if (input) input.value = button.dataset[`draft${field[0].toUpperCase() + field.slice(1)}`] || ''; }
	panel?.classList.add('open'); panel?.scrollIntoView({ block: 'start', behavior: 'smooth' });
});
for (const button of document.querySelectorAll('[data-close-editor]')) button.addEventListener('click', () => document.getElementById(`${button.dataset.closeEditor}-post-modal`)?.classList.remove('open'));

function previewStatus(message = 'Preview only - nothing was published.') {
	let status = document.getElementById('v2-preview-status');
	if (!status) { status = document.createElement('div'); status.id = 'v2-preview-status'; status.className = 'tw:fixed tw:bottom-6 tw:left-1/2 tw:z-[10000] tw:-translate-x-1/2 tw:rounded-md tw:border tw:border-antique tw:bg-obsidian tw:px-5 tw:py-3 tw:text-sm tw:text-champagne tw:shadow-lg'; status.setAttribute('role', 'status'); document.body.appendChild(status); }
	status.textContent = message;
}
for (const form of document.querySelectorAll('form')) form.addEventListener('submit', event => { event.preventDefault(); previewStatus(); });
for (const button of document.querySelectorAll('[data-preview-action]')) button.addEventListener('click', () => previewStatus());

const markdownInput = document.getElementById('modal-blog-content');
const markdownPreview = document.getElementById('modal-blog-preview-rendered');
function updateMarkdownPreview() {
	if (markdownInput && markdownPreview) markdownPreview.innerHTML = DOMPurify.sanitize(marked.parse(markdownInput.value));
}
for (const button of document.querySelectorAll('[data-content-mode]')) button.addEventListener('click', () => {
	const preview = button.dataset.contentMode === 'preview';
	updateMarkdownPreview();
	markdownInput?.classList.toggle('preview-hidden', preview);
	markdownPreview?.classList.toggle('preview-open', preview);
	for (const tab of document.querySelectorAll('[data-content-mode]')) { tab.classList.toggle('active', tab === button); tab.setAttribute('aria-pressed', String(tab === button)); }
});
for (const button of document.querySelectorAll('[data-markdown]')) button.addEventListener('click', () => {
	if (!markdownInput) return;
	const top = markdownInput.scrollTop;
	const start = markdownInput.selectionStart;
	const end = markdownInput.selectionEnd;
	const selected = markdownInput.value.slice(start, end) || 'Text';
	const wrappers = { bold: ['**', '**'], italic: ['*', '*'], h2: ['\n## ', '\n'], list: ['\n- ', ''], link: ['[', '](https://example.com)'], quote: ['\n> ', '\n'], divider: ['\n\n---\n', ''] };
	const [before, after] = wrappers[button.dataset.markdown] || ['', ''];
	markdownInput.setRangeText(before + selected + after, start, end, 'select'); markdownInput.focus({ preventScroll: true }); markdownInput.scrollTop = top; updateMarkdownPreview();
});

let galleryPhotos = [];
let photoIndex = 0;
let previousFocus;
const lightbox = document.getElementById('gallery-lightbox');
function showPhoto() {
	const photo = galleryPhotos[photoIndex];
	if (!photo || !lightbox) return;
	const image = document.getElementById('lightbox-image'); image.src = photo.dataset.photo; image.alt = photo.dataset.photoTitle;
	document.getElementById('lightbox-caption').textContent = [photo.dataset.photoTitle, photo.dataset.photoCategory].filter(Boolean).join(' / ');
	document.getElementById('lightbox-description').textContent = photo.dataset.photoDescription;
	document.getElementById('lightbox-counter').textContent = `${photoIndex + 1} / ${galleryPhotos.length}`;
	for (const id of ['lightbox-previous', 'lightbox-next']) document.getElementById(id).hidden = galleryPhotos.length < 2;
	lightbox.classList.add('active'); document.body.classList.add('preview-scroll-lock');
}
function closePhoto() { lightbox?.classList.remove('active'); document.body.classList.remove('preview-scroll-lock'); previousFocus?.focus({ preventScroll: true }); }
function stepPhoto(direction) { if (galleryPhotos.length) { photoIndex = (photoIndex + direction + galleryPhotos.length) % galleryPhotos.length; showPhoto(); } }
for (const tile of document.querySelectorAll('[data-photo]')) tile.addEventListener('click', () => {
	galleryPhotos = [...tile.parentElement.querySelectorAll('[data-photo]')].filter(photo => !photo.classList.contains('preview-hidden'));
	photoIndex = galleryPhotos.indexOf(tile); previousFocus = tile; showPhoto(); document.getElementById('lightbox-close')?.focus({ preventScroll: true });
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
	if (event.key === 'Escape') { closePhoto(); closeNavigation(); }
	if (lightbox?.classList.contains('active') && event.key === 'ArrowLeft') { event.preventDefault(); stepPhoto(-1); }
	if (lightbox?.classList.contains('active') && event.key === 'ArrowRight') { event.preventDefault(); stepPhoto(1); }
});

const canvas = document.getElementById('hero-canvas');
if (canvas && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
	const context = canvas.getContext('2d');
	const particles = Array.from({ length: 45 }, () => ({ x: Math.random(), y: Math.random(), size: Math.random() * 2 + 0.6, speed: Math.random() * 0.0004 + 0.0001 }));
	const resize = () => { canvas.width = canvas.parentElement.clientWidth; canvas.height = canvas.parentElement.clientHeight; };
	resize(); window.addEventListener('resize', resize);
	const animate = () => {
		context.clearRect(0, 0, canvas.width, canvas.height); context.fillStyle = '#d8c290';
		for (const particle of particles) { particle.y -= particle.speed; if (particle.y < 0) particle.y = 1; context.globalAlpha = 0.35; context.beginPath(); context.arc(particle.x * canvas.width, particle.y * canvas.height, particle.size, 0, Math.PI * 2); context.fill(); }
		requestAnimationFrame(animate);
	};
	animate();
}

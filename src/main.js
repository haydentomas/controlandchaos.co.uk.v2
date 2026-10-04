import './templates.css';
import { initNavigation } from './modules/navigation.js';
import { initHero } from './modules/hero.js';

const page = document.documentElement.dataset.template || 'index';
initNavigation();
initHero();

if (page.startsWith('profile')) import('./modules/profile.js').then(module => module.initProfile());
if (document.getElementById('gallery-lightbox')) import('./modules/gallery.js').then(module => module.initGallery());
if (page === 'directory-editor') import('./modules/editor.js').then(module => module.initEditor());
if (document.querySelector('form, [data-preview-action]')) import('./modules/preview-actions.js').then(module => module.initPreviewActions());

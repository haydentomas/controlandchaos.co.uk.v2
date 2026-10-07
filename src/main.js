import './templates.css';
import { initNavigation } from './modules/navigation.js';
import { initHero } from './modules/hero.js';

const page = document.documentElement.dataset.template || 'index';
initNavigation();
initHero();
if (page === 'directory') import('./modules/directory.js').then(module => module.initDirectory());
if (page === 'directory-profile') import('./modules/directory-profile.js').then(module => module.initDirectoryProfile());
if (page === 'auth') import('./modules/auth.js').then(module => module.initAuth());
if (page === 'directory-admin') import('./modules/directory-admin.js').then(module => module.initDirectoryAdmin());
if (page === 'directory-admin') import('./modules/directory-admin.js').then(module => module.initDirectoryAdmin());

if (page.startsWith('profile')) import('./modules/profile.js').then(module => module.initProfile());
if (document.getElementById('gallery-lightbox')) import('./modules/gallery.js').then(module => module.initGallery());
if (page === 'directory-editor') import('./modules/creator-editor.js').then(module => module.initCreatorEditor());
if (page === 'events') import('./modules/events.js').then(module => module.initEvents());
if (page === 'blog' || page.startsWith('blog-')) import('./modules/blog.js').then(module => module.initBlog());
if (!['auth', 'directory-editor'].includes(page) && document.querySelector('form:not([data-live-auth-form]):not([data-live-booking-form]), [data-preview-action]')) import('./modules/preview-actions.js').then(module => module.initPreviewActions());

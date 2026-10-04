import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { parseHTML } from 'linkedom';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import selectorParser from 'postcss-selector-parser';

const root = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.resolve(root, '../main');
const require = createRequire(import.meta.url);
const { toPublicProfile } = require('../../main/netlify/functions/lib/profile-public.cjs');
const appSource = await fs.readFile(path.join(sourceRoot, 'app.js'), 'utf8');
const navigation = JSON.parse(await fs.readFile(path.join(sourceRoot, 'settings/navigation.json'), 'utf8'));
const footer = JSON.parse(await fs.readFile(path.join(sourceRoot, 'settings/footer.json'), 'utf8'));
const sourceProfile = toPublicProfile(JSON.parse(await fs.readFile(path.join(sourceRoot, 'directory/profiles/alek-zane.json'), 'utf8')));
const profile = { ...sourceProfile, is_vip: true, plan: 'vip', published: true, expires_at: null, feature_visibility: {} };
const routes = [
  ['index', 'index.html'], ['products', 'products/index.html'], ['xp-system', 'xp-system/index.html'],
  ['guides', 'guides/index.html'], ['blog', 'blog/index.html'], ['events', 'events/index.html'], ['contact', 'contact/index.html'],
  ['directory', 'directory/index.html'], ['get-listed', 'directory/get-listed/index.html'],
  ['checkout', 'directory/checkout/index.html'], ['directory-admin', 'directory/admin/index.html'],
  ['directory-editor', 'directory/edit/index.html'],
  ['profile', 'directory/profile.html', 'ratecard'], ['profile-blog', 'directory/profile.html', 'blog'],
  ['profile-feed', 'directory/profile.html', 'feed'], ['profile-gallery', 'directory/profile.html', 'gallery'],
  ['profile-post', 'directory/profile.html', 'article'], ['profile-white-label', 'directory/profile.html', 'white-label'],
  ['profile-post-white-label', 'directory/profile.html', 'white-label-article'],
  ['profile-blog-white-label', 'directory/profile.html', 'white-label-blog'],
  ['profile-feed-white-label', 'directory/profile.html', 'white-label-feed'],
  ['profile-gallery-white-label', 'directory/profile.html', 'white-label-gallery'],
  ...['vow-collar', 'pocket-pig', 'footkiss', 'tribute-jars', 'xp-titlers', 'template'].map(slug => [`guide-${slug}`, `guides/${slug}/index.html`]),
  ...['vow-launch', 'cage-break-xp', 'profile-picks', 'patch-v2-1'].map(slug => [`blog-${slug}`, `blog/${slug}/index.html`])
];
const styleRules = new Map();
const componentNames = new Map();
const localStyles = [];
const assets = new Set(['/favicon.svg', '/images/logo.png']);
const failures = [];

function assetUrl(value, base) {
  if (!value || /^(?:https?:|data:|blob:|secondlife:|mailto:|tel:|#)/i.test(value)) return value;
  const url = new URL(value, base);
  if (url.pathname.startsWith('/images/') || url.pathname.startsWith('/assets/') || url.pathname === '/favicon.svg') {
    assets.add(url.pathname);
    return url.pathname + url.search + url.hash;
  }
  return value;
}

function normalizeCssAssets(css, base) {
  const parsed = postcss.parse(css);
  parsed.walkDecls(declaration => {
    if (!declaration.value.trim()) { declaration.remove(); return; }
    const value = valueParser(declaration.value);
    value.walk(node => {
      if (node.type === 'function' && node.value === 'url' && node.nodes[0]) node.nodes[0].value = assetUrl(node.nodes[0].value, base);
    });
    declaration.value = value.toString();
  });
  return parsed;
}

function utilityValue(value) {
  const parsed = valueParser(value);
  parsed.walk(node => {
    if (node.type === 'space') node.value = '_';
    else if (node.type === 'word' || node.type === 'string') node.value = node.value.replace(/_/g, '\\_').replace(/\s/g, '_');
    if (node.type === 'string') node.quote = "'";
    if (node.type === 'div') { node.before = node.before.replace(/\s/g, '_'); node.after = node.after.replace(/\s/g, '_'); }
  });
  return parsed.toString();
}

function tailwindRules(parsed) {
  parsed.walkRules(rule => {
    if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
    for (const node of [...rule.nodes]) {
      if (node.type !== 'decl' || node.prop.startsWith('--') || node.important || /[\[\]{};]/.test(node.value)) continue;
      node.replaceWith(postcss.atRule({ name: 'apply', params: `tw:[${node.prop}:${utilityValue(node.value)}]` }));
    }
  });
  return parsed.toString();
}

function scopeStyles(css, name, base) {
  const parsed = normalizeCssAssets(css, base);
  parsed.walkRules(rule => {
    if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
    rule.selectors = rule.selectors.map(selector => selector === ':root' || selector === 'html'
      ? `html[data-template="${name}"]` : `:where(html[data-template="${name}"]) ${selector}`);
  });
  return tailwindRules(parsed);
}

function normalizeStyles(document, base) {
  for (const element of document.querySelectorAll('[style]')) {
    const css = normalizeCssAssets(`.inline-style { ${element.getAttribute('style')} }`, base);
    const declarations = css.first.nodes.filter(node => node.type === 'decl');
    if (element.tagName === 'P' && element.closest('.article-content')) {
      const page = document.documentElement.dataset.template;
      css.first.selector = `.article-content p`;
      styleRules.set(`${page}-article-paragraphs`, scopeStyles(css.toString(), page, base));
    } else {
      const properties = declarations.map(node => node.prop);
      const conflict = ['background', 'margin', 'padding', 'border', 'font', 'flex'].some(property => properties.includes(property) && properties.some(value => value.startsWith(property + '-')));
      const complex = conflict || declarations.some(node => node.prop.startsWith('--') || node.important || /[\[\]{};]/.test(node.value));
      if (complex) {
        const page = document.documentElement.dataset.template;
        const existing = element.id || [...element.classList].find(value => !value.startsWith('tw:')) || `${page}-${element.tagName.toLowerCase()}`;
        const stem = existing.replace(/[^a-zA-Z0-9-]/g, '-').replace(/^-+|-+$/g, '') + '-presentation';
        const signature = css.toString();
        let variants = componentNames.get(stem);
        if (!variants) { variants = new Map(); componentNames.set(stem, variants); }
        if (!variants.has(signature)) variants.set(signature, variants.size ? `${stem}-${variants.size + 1}` : stem);
        const name = variants.get(signature);
        css.first.selector = `.${name}`;
        styleRules.set(name, tailwindRules(css));
        element.classList.add(name);
      } else {
        for (const declaration of declarations) element.classList.add(`tw:[${declaration.prop}:${utilityValue(declaration.value)}]`);
      }
    }
    element.removeAttribute('style');
  }
}

function removeUnusedIds(document) {
  const retained = new Set([
    'nav-toggle', 'mobile-nav-drawer', 'hero-canvas', 'v2-page-canvas', 'profile-tabs-nav', 'v2-preview-status',
    'gallery-lightbox', 'lightbox-image', 'lightbox-caption', 'lightbox-description', 'lightbox-counter',
    'lightbox-close', 'lightbox-previous', 'lightbox-next', 'gallery-library-grid', 'gallery-library-filters', 'gallery-manager-card'
  ]);
  for (const tab of ['ratecard', 'blog', 'feed', 'gallery']) retained.add(`tab-btn-${tab}`);
  for (const element of document.querySelectorAll('[for], [aria-labelledby], [aria-describedby], [aria-controls], [data-editor-tab], [data-open-editor], [data-close-editor], a[href]')) {
    for (const attribute of ['for', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'data-editor-tab']) {
      for (const id of (element.getAttribute(attribute) || '').split(/\s+/).filter(Boolean)) retained.add(id);
    }
    for (const attribute of ['data-open-editor', 'data-close-editor']) {
      const kind = element.getAttribute(attribute);
      if (kind) retained.add(`${kind}-post-modal`);
    }
    const href = element.getAttribute('href') || '';
    if (href.includes('#')) {
      const fragment = decodeURIComponent(href.substring(href.indexOf('#') + 1));
      if (fragment) retained.add(fragment);
    }
  }
  const removed = new Map();
  for (const element of document.querySelectorAll('[id]')) {
    if (!element.getAttribute('id')?.trim()) { element.removeAttribute('id'); continue; }
    if (retained.has(element.id) || /^modal-(?:blog|post)-/.test(element.id)) continue;
    const id = element.id;
    removed.set(id, element);
    element.removeAttribute('id');
  }
  return removed;
}

function rewritePresentationIds(css, removed, onlyChanged = false) {
  const parsed = postcss.parse(css);
  parsed.walkRules(rule => {
    if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
    const originalSelector = rule.selector;
    rule.selector = selectorParser(selectors => selectors.walkIds(node => {
      const element = removed.get(node.value);
      if (!element) return;
      const name = node.value;
      element.classList.add(name);
      node.replaceWith(selectorParser.className({ value: name }));
    })).processSync(rule.selector);
    if (onlyChanged && rule.selector === originalSelector) rule.remove();
  });
  if (onlyChanged) parsed.walkAtRules(rule => {
    if (/keyframes$/i.test(rule.name) || rule.name === 'font-face' || rule.name === 'import' || !rule.nodes?.length) rule.remove();
  });
  return parsed.toString();
}

function previewLink(href, base, pageName) {
  if (!href || /^(?:mailto:|tel:|secondlife:|data:|#)/i.test(href)) return href;
  const url = new URL(href, base);
  if (/^https?:/i.test(href) && !['controlandchaos.co.uk', 'www.controlandchaos.co.uk', 'controlandchaos.com', 'www.controlandchaos.com'].includes(url.hostname)) return href;
  if (url.pathname.startsWith('/images/') || url.pathname.startsWith('/assets/')) return assetUrl(href, base);
  const clean = url.pathname.replace(/index\.html$/, '').replace(/\/$/, '') || '/';
  if (clean === '/') {
    if (pageName.includes('white-label') && pageName.startsWith('profile')) {
      const tab = url.searchParams.get('tab') || 'ratecard';
      return (tab === 'ratecard' ? '/profile-white-label.html' : `/profile-${tab}-white-label.html`) + url.hash;
    }
    return '/index.html' + url.hash;
  }
  if (clean.startsWith('/profile/')) {
    if (clean.includes('/blog/')) return pageName.includes('white-label') ? '/profile-post-white-label.html' : '/profile-post.html';
    const tab = url.searchParams.get('tab');
    if (pageName.includes('white-label')) return (['blog', 'feed', 'gallery'].includes(tab) ? `/profile-${tab}-white-label.html` : '/profile-white-label.html') + url.hash;
    return `/profile${['blog', 'feed', 'gallery'].includes(tab) ? '-' + tab : ''}.html` + url.hash;
  }
  if (clean === '/directory/profile.html' || clean === '/profile') return '/profile.html';
  if (clean === '/blog/post.html') return '/blog-vow-launch.html';
  const route = routes.find(([, file]) => '/' + file.replace(/index\.html$/, '').replace(/\/$/, '') === clean);
  return route ? `/${route[0]}.html${url.hash}` : '/index.html';
}

async function runtime(document, originalPath, variant) {
  const callbacks = [];
  const classes = new Map();
  const base = `https://template.local/${originalPath}`;
  const pendingReads = new Set();
  const readFixture = async input => {
    const url = new URL(String(input), base);
    if (url.pathname.startsWith('/.netlify/')) return { ok: true, json: async () => ({ success: true, allowed: true, is_admin: true, profile, profiles: { [profile.id]: profile }, subscriptions: {}, statuses: {}, items: [] }) };
    if (url.pathname === '/directory/profiles/alek-zane.json') return { ok: true, json: async () => profile };
    try {
      const data = JSON.parse(await fs.readFile(path.join(sourceRoot, url.pathname.replace(/^\//, '')), 'utf8'));
      return { ok: true, json: async () => data, text: async () => JSON.stringify(data) };
    } catch { return { ok: false, json: async () => null }; }
  };
  const fetchFixture = input => {
    const operation = readFixture(input);
    pendingReads.add(operation);
    operation.finally(() => pendingReads.delete(operation));
    return operation;
  };
  const settle = async () => {
    for (let turn = 0; turn < 12; turn++) {
      if (pendingReads.size) await Promise.allSettled([...pendingReads]);
      await Promise.resolve();
    }
  };
  const storage = new Map();
  for (const select of document.querySelectorAll('select')) {
    Object.defineProperty(select, 'value', {
      configurable: true,
      get() { return this.querySelector('option[selected]')?.getAttribute('value') || this.querySelector('option')?.getAttribute('value') || ''; },
      set(value) { for (const option of this.querySelectorAll('option')) { if (option.getAttribute('value') === String(value)) option.setAttribute('selected', ''); else option.removeAttribute('selected'); } }
    });
  }
  const location = new URL(base);
  if (originalPath === 'directory/profile.html') location.href = 'https://template.local/profile/alek-zane/';
  if (variant.includes('article')) location.pathname = '/profile/alek-zane/blog/' + (profile.blog_posts?.[0]?.slug || 'entry') + '/';
  const window = { location, fetch: fetchFixture, innerWidth: 1440, scrollY: 0, scrollX: 0, addEventListener() {}, matchMedia: () => ({ matches: true }), history: { replaceState() {} }, netlifyIdentity: null };
  document.addEventListener = (event, callback) => { if (event === 'DOMContentLoaded') callbacks.push(callback); };
  document.defaultView.HTMLElement.prototype.focus = function() {};
  document.defaultView.HTMLElement.prototype.scrollIntoView = function() {};
  for (const canvas of document.querySelectorAll('canvas')) canvas.getContext = () => ({ clearRect() {}, save() {}, restore() {}, beginPath() {}, arc() {}, fill() {} });
  const context = vm.createContext({
    document, window, location, URL, URLSearchParams, console, HTMLElement: class {},
    customElements: { get: name => classes.get(name), define: (name, value) => classes.set(name, value) },
    performance: { now: () => 0 }, fetch: fetchFixture, setTimeout() {}, clearTimeout() {}, requestAnimationFrame() {},
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    navigator: { clipboard: { writeText: async () => {} } }, alert() {}, confirm: () => false, prompt: () => null
  });
  for (const name of ['switchProfileTab', 'openSubscribeModal', 'closeSubscribeModal']) Object.defineProperty(context, name, { configurable: true, get: () => window[name] });
  vm.runInContext(appSource, context);
  for (const [tag, data] of [['site-navbar', navigation], ['site-footer', footer]]) {
    const element = document.querySelector(tag);
    const component = classes.get(tag);
    if (element && component) component.prototype.render.call(element, data);
  }
  for (const script of document.querySelectorAll('script:not([src])')) {
    if (/json/.test(script.getAttribute('type') || '')) continue;
    try { vm.runInContext(script.textContent, context); } catch (error) { failures.push(`${originalPath}: ${error.message}`); }
  }
  if (originalPath === 'directory/edit/index.html') {
    vm.runInContext('isAdminMode = true; authUUID = "visual-preview"; authToken = "visual-preview"; currentProfile = fixture;', Object.assign(context, { fixture: profile }));
    context.initializePostEditors();
    context.populateForm(profile);
    document.getElementById('access-gate').style.display = 'none';
    document.getElementById('auth-banner').style.display = 'block';
    document.getElementById('editor-container').style.display = 'grid';
  } else {
    for (const callback of callbacks) {
      try { await callback(); } catch (error) { failures.push(`${originalPath}: ${error.message}`); }
    }
  }
  await settle();
  return { context, base, settle };
}

async function capture(name, originalPath, variant = '') {
  const original = await fs.readFile(path.join(sourceRoot, originalPath), 'utf8');
  const { document } = parseHTML(original);
  const { context, base, settle } = await runtime(document, originalPath, variant);
  if (variant && context.window.currentProfile) {
    if (variant.startsWith('white-label')) {
      const marker = document.createElement('meta'); marker.setAttribute('name', 'cc-profile-id'); marker.setAttribute('content', profile.id); document.head.appendChild(marker);
      document.body.classList.add('is-whitelabel-custom-domain');
      const style = document.createElement('style');
      style.textContent = 'site-navbar,.footer-grid{display:none!important}.footer{padding:0!important}.footer-bottom{display:block!important;margin:0!important;padding:24px 0!important;text-align:center}#profile-hero-header{padding-top:50px!important}.profile-article-page{padding:60px 0!important}';
      document.head.appendChild(style);
    }
    if (variant.includes('article')) context.renderDynamicArticleView(profile, profile.blog_posts?.[0] || { title: 'Journal Entry', content: 'A public journal entry.' }, profile.blog_posts || []);
    else context.window.switchProfileTab(variant.startsWith('white-label') ? variant.replace('white-label-', '').replace('white-label', 'ratecard') : variant);
  }
  await settle();
  for (const element of document.querySelectorAll('script')) element.remove();
  for (const element of document.querySelectorAll('*')) {
    const click = element.getAttribute('onclick') || '';
    const tab = click.match(/^switchTab\(['"]([^'"]+)['"]\)/);
    if (tab) element.setAttribute('data-editor-tab', tab[1]);
    const markdown = click.match(/^insertBlogMarkdown\(['"]([^'"]+)['"]\)/);
    if (markdown) element.setAttribute('data-markdown', markdown[1]);
    if (click.startsWith('switchBlogContentMode')) element.setAttribute('data-content-mode', click.includes('preview') ? 'preview' : 'write');
    if (click.startsWith('openCreateBlogPostModal') || click.startsWith('openEditBlogPostModal')) element.setAttribute('data-open-editor', 'blog');
    if (click.startsWith('openCreatePostModal') || click.startsWith('openEditPostModal')) element.setAttribute('data-open-editor', 'feed');
    const editIndex = click.match(/^openEdit(?:Blog)?PostModal\((\d+)\)/);
    if (editIndex) {
      const post = (element.getAttribute('data-open-editor') === 'blog' ? profile.blog_posts : profile.posts)?.[Number(editIndex[1])];
      if (post) {
        element.setAttribute('data-draft-title', post.title || '');
        element.setAttribute('data-draft-content', post.content || '');
        element.setAttribute('data-draft-tag', post.tag || '');
      }
    }
    if (click.startsWith('closeBlogPostModal')) element.setAttribute('data-close-editor', 'blog');
    if (click.startsWith('closePostModal')) element.setAttribute('data-close-editor', 'feed');
    if (click.startsWith('save') || click.startsWith('login') || click.startsWith('remove') || click.startsWith('discard')) element.setAttribute('data-preview-action', 'true');
    for (const attribute of [...element.attributes]) if (attribute.name.startsWith('on')) element.removeAttribute(attribute.name);
    for (const attribute of ['src', 'poster']) if (element.hasAttribute(attribute)) element.setAttribute(attribute, assetUrl(element.getAttribute(attribute), base));
    if (element.tagName === 'A') element.setAttribute('href', previewLink(element.getAttribute('href'), base, name));
    if (element.tagName === 'FORM') { element.removeAttribute('action'); element.removeAttribute('data-netlify'); element.removeAttribute('method'); }
  }
  for (const tile of document.querySelectorAll('.gallery-thumb-card, .gallery-library-tile')) {
    const image = tile.querySelector('img');
    if (!image) continue;
    const photo = profile.gallery?.find(item => item.image === image.getAttribute('src'));
    tile.setAttribute('data-photo', image.getAttribute('src'));
    tile.setAttribute('data-photo-title', photo?.title || image.getAttribute('alt') || 'Photo');
    tile.setAttribute('data-photo-category', photo?.category || '');
    tile.setAttribute('data-photo-description', photo?.description || photo?.desc || '');
  }
  for (const element of document.querySelectorAll('input[type="hidden"]')) element.remove();
  for (const input of document.querySelectorAll('input[type="password"], input[id*="token"], input[name*="token"]')) input.setAttribute('value', '');
  for (const link of document.querySelectorAll('link[rel="icon"]')) link.setAttribute('href', '/favicon.svg');
  document.documentElement.classList.remove('site-loading', 'site-revealed');
  document.documentElement.removeAttribute('aria-busy');
  document.documentElement.setAttribute('data-template', name);
  const robots = document.createElement('meta'); robots.name = 'robots'; robots.content = 'noindex,nofollow'; document.head.appendChild(robots);
  const reference = parseHTML(document.toString()).document;
  for (const link of reference.querySelectorAll('link[rel="stylesheet"]')) if (!/^https?:/.test(link.getAttribute('href'))) link.setAttribute('href', '/reference/main.css');
  await fs.mkdir(path.join(root, 'public/reference'), { recursive: true });
  await fs.writeFile(path.join(root, 'public/reference', `${name}.html`), reference.toString());
  const removedIds = removeUnusedIds(document);
  for (const style of document.querySelectorAll('style')) { localStyles.push(scopeStyles(rewritePresentationIds(style.textContent, removedIds), name, base)); style.remove(); }
  const baseStyles = rewritePresentationIds(await fs.readFile(path.join(sourceRoot, 'styles.css'), 'utf8'), removedIds, true);
  localStyles.push(scopeStyles(baseStyles, name, base));
  for (const link of document.querySelectorAll('link[rel="stylesheet"]')) if (!/^https?:/.test(link.getAttribute('href'))) link.remove();
  normalizeStyles(document, base);
  for (const element of document.querySelectorAll('[onclick], [style]')) throw new Error(`Unsafe snapshot attribute on ${name}: ${element.tagName}#${element.id} ${element.getAttribute('style')}`);
  const script = document.createElement('script'); script.type = 'module'; script.src = '/src/main.js'; document.body.appendChild(script);
  await fs.writeFile(path.join(root, `${name}.html`), document.toString());
}

const selection = process.argv.includes('--home-only') ? routes.slice(0, 1) : routes;
for (const route of selection) { await capture(...route); console.log(`Captured ${route[0]}.html`); }
const portalCss = tailwindRules(normalizeCssAssets(await fs.readFile(path.join(sourceRoot, 'styles.css'), 'utf8'), 'https://template.local/styles.css'));
await fs.copyFile(path.join(sourceRoot, 'styles.css'), path.join(root, 'public/reference/main.css'));
await fs.writeFile(path.join(root, 'src/portal.css'), `@layer components {\n${portalCss}\n${localStyles.join('\n')}\n}\n@layer utilities {\n${[...styleRules.values()].join('\n')}\n}`);
for (const asset of assets) {
  const source = path.join(sourceRoot, decodeURIComponent(asset.replace(/^\//, '')));
  const destination = path.join(root, 'public', decodeURIComponent(asset.replace(/^\//, '')));
  try { await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.copyFile(source, destination); } catch { console.warn(`Unavailable local asset: ${asset}`); }
}
await fs.writeFile(path.join(root, 'templates.json'), JSON.stringify(selection.map(([name, source, variant]) => ({ page: `${name}.html`, source, variant: variant || 'default' })), null, 2));
if (failures.length) { console.warn(failures.join('\n')); process.exitCode = 1; }
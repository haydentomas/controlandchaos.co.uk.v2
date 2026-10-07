import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import nunjucks from 'nunjucks';
import { loadEvents, loadGuides, loadPosts, validateSiteContent } from './cms-content.mjs';
import { generateCMSPreviews } from './cms-previews.mjs';

export const root = path.resolve(import.meta.dirname, '..');
const templateRoot = path.join(root, 'templates');
const contentRoot = path.join(root, 'content');

export async function loadSite() {
  return validateSiteContent(JSON.parse(await fs.readFile(path.join(contentRoot, 'site.json'), 'utf8')));
}

export function templateEnvironment() {
  return new nunjucks.Environment(new nunjucks.FileSystemLoader(templateRoot, { noCache: true }), {
    autoescape: true,
    throwOnUndefined: true,
    trimBlocks: true,
    lstripBlocks: true
  });
}

export async function pageInventory(posts, guides) {
  posts ??= await loadPosts();
  guides ??= await loadGuides();
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'templates.json'), 'utf8'));
  return [...manifest.filter(item => !item.page.startsWith('blog-') && (!item.page.startsWith('guide-') || item.page === 'guide-template.html')), ...posts.map(post => ({ page: post.page, variant: 'cms-blog' })), ...guides.map(guide => ({ page: guide.page, variant: 'cms-guide' }))];
}

export function staleBlogPages(previous, active) {
  const current = new Set(active);
  return previous.filter(filename => /^blog-[a-z0-9-]+\.html$/.test(filename) && !current.has(filename));
}

export function staleGuidePages(previous, active) {
  const current = new Set(active);
  return previous.filter(filename => /^guide-[a-z0-9-]+\.html$/.test(filename) && filename !== 'guide-template.html' && !current.has(filename));
}

export async function renderPage(filename, { site, creator, events, posts, guides } = {}) {
  if (!/^[a-z0-9-]+\.html$/.test(filename)) throw new Error(`Invalid page name: ${filename}`);
  const name = filename.slice(0, -5);
  site = site ? validateSiteContent(site) : await loadSite();
  if (name === 'blog' || name.startsWith('blog-')) posts ??= await loadPosts();
  if (name === 'guides' || (name.startsWith('guide-') && name !== 'guide-template')) guides ??= await loadGuides();
  if (name.startsWith('guide-') && name !== 'guide-template') {
    const guide = guides.find(item => item.page === filename);
    if (!guide) throw new Error(`Guide is not published: ${filename}`);
    const image = new URL(guide.listing.image, 'https://controlandchaos.co.uk').href;
    const page = {
      template: name, title: `${guide.title} | User Manual`, bodyClass: '', whiteLabel: false,
      links: [{ rel: 'canonical', href: guide.canonical }],
      meta: [
        { name: 'description', content: guide.description }, { property: 'og:type', content: 'article' },
        { property: 'og:title', content: guide.title }, { property: 'og:description', content: guide.description },
        { property: 'og:url', content: guide.canonical }, { property: 'og:image', content: image },
        { name: 'twitter:card', content: 'summary_large_image' }, { name: 'twitter:title', content: guide.title },
        { name: 'twitter:description', content: guide.description }, { name: 'twitter:image', content: image }
      ]
    };
    return templateEnvironment().render('pages/product-manual.njk', { site, page, guide, otherGuides: guides.filter(item => item.id !== guide.id) });
  }
  if (name.startsWith('blog-')) {
    const post = posts.find(item => item.page === filename);
    if (!post) throw new Error(`Post is not published: ${filename}`);
    const image = new URL(post.featured_image || site.logo, 'https://controlandchaos.co.uk').href;
    const page = {
      template: name, title: `${post.title} | Control & Chaos`, bodyClass: '', whiteLabel: false,
      links: [{ rel: 'canonical', href: post.canonical }],
      meta: [
        { name: 'description', content: post.summary }, { property: 'og:type', content: 'article' },
        { property: 'og:title', content: post.title }, { property: 'og:description', content: post.summary },
        { property: 'og:url', content: post.canonical }, { property: 'og:image', content: image },
        { property: 'og:site_name', content: 'Control & Chaos' }, { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: post.title }, { name: 'twitter:description', content: post.summary }, { name: 'twitter:image', content: image }
      ]
    };
    return templateEnvironment().render('pages/site-blog-article.njk', { site, page, post, recentPosts: posts.filter(item => item.id !== post.id).slice(0, 3) });
  }
  const page = JSON.parse(await fs.readFile(path.join(contentRoot, 'pages', `${name}.json`), 'utf8'));
  if (page.hero && !creator) creator = JSON.parse(await fs.readFile(path.join(contentRoot, 'creator-preview.json'), 'utf8'));
  if (name === 'events') events ??= await loadEvents();
  return templateEnvironment().render(`pages/${name}.njk`, { site, page, creator, events, posts, guides });
}

export async function generateTemplates() {
  await generateCMSPreviews();
  const posts = await loadPosts();
  const guides = await loadGuides();
  const manifest = await pageInventory(posts, guides);
  const site = await loadSite();
  const generated = [];
  for (const { page } of manifest) {
    const html = await renderPage(page, { site, posts, guides });
    const output = path.join(root, page);
    const previous = await fs.readFile(output, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    if (html !== previous) await fs.writeFile(output, html);
    generated.push(page);
  }
  const registry = path.join(root, '.generated-blog-pages.json');
  const baseline = JSON.parse(await fs.readFile(path.join(root, 'templates.json'), 'utf8')).map(item => item.page);
  const previous = await fs.readFile(registry, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return baseline; throw error; });
  const active = posts.map(post => post.page);
  for (const filename of staleBlogPages(previous, active)) await fs.rm(path.join(root, filename), { force: true });
  await fs.writeFile(registry, JSON.stringify(active, null, 2) + '\n');
  const guideRegistry = path.join(root, '.generated-guide-pages.json');
  const previousGuides = await fs.readFile(guideRegistry, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return baseline; throw error; });
  const activeGuides = guides.map(guide => guide.page);
  for (const filename of staleGuidePages(previousGuides, activeGuides)) await fs.rm(path.join(root, filename), { force: true });
  await fs.writeFile(guideRegistry, JSON.stringify(activeGuides, null, 2) + '\n');
  return generated;
}

export function templateWatchPlugin() {
  return {
    name: 'v2-template-watch',
    configureServer(server) {
      server.watcher.add([templateRoot, contentRoot]);
      let pending = Promise.resolve();
      const regenerate = filename => {
        if (![templateRoot, contentRoot].some(directory => {
          const relative = path.relative(directory, filename);
          return relative && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
        })) return;
        pending = pending.then(() => generateTemplates()).catch(error => {
          server.config.logger.error(error.stack);
          server.ws.send({ type: 'error', err: { message: error.message, stack: error.stack } });
        });
      };
      for (const event of ['add', 'change', 'unlink']) server.watcher.on(event, regenerate);
      server.httpServer?.once('close', () => {
        for (const event of ['add', 'change', 'unlink']) server.watcher.off(event, regenerate);
      });
    }
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  console.log(`Rendered ${(await generateTemplates()).length} shared-template pages.`);
}
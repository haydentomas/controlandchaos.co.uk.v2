import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import nunjucks from 'nunjucks';

export const root = path.resolve(import.meta.dirname, '..');
const templateRoot = path.join(root, 'templates');
const contentRoot = path.join(root, 'content');

export async function loadSite() {
  return JSON.parse(await fs.readFile(path.join(contentRoot, 'site.json'), 'utf8'));
}

export function templateEnvironment() {
  return new nunjucks.Environment(new nunjucks.FileSystemLoader(templateRoot, { noCache: true }), {
    autoescape: true,
    throwOnUndefined: true,
    trimBlocks: true,
    lstripBlocks: true
  });
}

export async function renderPage(filename, { site, creator } = {}) {
  if (!/^[a-z0-9-]+\.html$/.test(filename)) throw new Error(`Invalid page name: ${filename}`);
  const name = filename.slice(0, -5);
  const page = JSON.parse(await fs.readFile(path.join(contentRoot, 'pages', `${name}.json`), 'utf8'));
  if (page.hero && !creator) creator = JSON.parse(await fs.readFile(path.join(contentRoot, 'creator-preview.json'), 'utf8'));
  return templateEnvironment().render(`pages/${name}.njk`, { site: site ?? await loadSite(), page, creator });
}

export async function generateTemplates() {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'templates.json'), 'utf8'));
  const site = await loadSite();
  const generated = [];
  for (const { page } of manifest) {
    const html = await renderPage(page, { site });
    const output = path.join(root, page);
    const previous = await fs.readFile(output, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    if (html !== previous) await fs.writeFile(output, html);
    generated.push(page);
  }
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
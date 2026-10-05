import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { cp, readdir, rm, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { adminRoutePlugin, pageShellPlugin } from './scripts/page-shell.mjs';
import { generateTemplates, staleBlogPages, staleGuidePages, templateWatchPlugin } from './scripts/render-templates.mjs';

export default defineConfig(async ({ mode }) => {
  const environment = loadEnv(mode, import.meta.dirname, 'VITE_SUPABASE_');
  if (environment.VITE_SUPABASE_PUBLISHABLE_KEY && !environment.VITE_SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_')) throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY must be a publishable key, never a secret key.');
  const pages = await generateTemplates();
  const publicRoot = resolve(import.meta.dirname, 'public');
  const buildRoot = resolve(import.meta.dirname, 'build');
  return {
    plugins: [
      templateWatchPlugin(), adminRoutePlugin(), pageShellPlugin(), tailwindcss(),
      {
        name: 'v2-public-assets',
        async writeBundle(options, bundle) {
          await rm(resolve(buildRoot, 'reference'), { recursive: true, force: true });
          for (const filename of staleBlogPages(await readdir(buildRoot), pages)) await rm(resolve(buildRoot, filename), { force: true });
          for (const filename of staleGuidePages(await readdir(buildRoot), pages)) await rm(resolve(buildRoot, filename), { force: true });
          await cp(publicRoot, buildRoot, { recursive: true, filter: source => relative(publicRoot, source).split(sep)[0] !== 'reference' });
          const stylesheet = Object.values(bundle).find(asset => asset.type === 'asset' && /^assets\/main-.*\.css$/.test(asset.fileName));
          if (!stylesheet) throw new Error('Missing compiled site stylesheet for CMS previews');
          await writeFile(resolve(buildRoot, 'admin/site-preview.css'), stylesheet.source);
        }
      }
    ],
    server: { host: '127.0.0.1' },
    build: {
      outDir: 'build',
      emptyOutDir: false,
      copyPublicDir: false,
      rolldownOptions: {
        input: Object.fromEntries(pages.map(page => [page.replace('.html', ''), resolve(import.meta.dirname, page)]))
      }
    }
  };
});
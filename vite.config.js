import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { cp, rm } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { pageShellPlugin } from './scripts/page-shell.mjs';
import { generateTemplates, templateWatchPlugin } from './scripts/render-templates.mjs';

export default defineConfig(async () => {
  await generateTemplates();
  const manifest = JSON.parse(readFileSync(new URL('./templates.json', import.meta.url), 'utf8'));
  const publicRoot = resolve(import.meta.dirname, 'public');
  const buildRoot = resolve(import.meta.dirname, 'build');
  return {
    plugins: [
      templateWatchPlugin(), pageShellPlugin(), tailwindcss(),
      {
        name: 'v2-public-assets',
        async writeBundle() {
          await rm(resolve(buildRoot, 'reference'), { recursive: true, force: true });
          await cp(publicRoot, buildRoot, { recursive: true, filter: source => relative(publicRoot, source).split(sep)[0] !== 'reference' });
        }
      }
    ],
    server: { host: '127.0.0.1' },
    build: {
      outDir: 'build',
      emptyOutDir: false,
      copyPublicDir: false,
      rolldownOptions: {
        input: Object.fromEntries(manifest.map(({ page }) => [page.replace('.html', ''), resolve(import.meta.dirname, page)]))
      }
    }
  };
});
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pageShellPlugin } from './scripts/page-shell.mjs';

export default defineConfig({
  plugins: [pageShellPlugin(), tailwindcss()],
  server: { host: '127.0.0.1' },
  build: {
    outDir: 'build',
    emptyOutDir: false,
    rolldownOptions: {
      input: Object.fromEntries(readdirSync(import.meta.dirname).filter(file => file.endsWith('.html')).map(file => [file.replace('.html', ''), resolve(import.meta.dirname, file)]))
    }
  }
});
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pageShellTags, pageShellPlugin } from './page-shell.mjs';

test('page shell paints a dark canvas and loads CSS before document content', () => {
  const tags = pageShellTags();
  const canvas = tags.find(tag => tag.attrs?.id === 'v2-page-canvas');
  assert.equal(canvas.injectTo, 'head-prepend');
  assert.match(canvas.children, /background:#12100e/);
  assert.match(canvas.children, /color-scheme:dark/);
  assert.ok(tags.some(tag => tag.tag === 'link' && tag.attrs.href === '/src/templates.css' && tag.attrs.rel === 'stylesheet'));
  assert.equal(pageShellPlugin().transformIndexHtml.order, 'pre');
  assert.ok(!tags.some(tag => tag.tag === 'script'));
});

test('page fades use native navigation and respect reduced motion', async () => {
  const css = await fs.readFile(new URL('../src/templates.css', import.meta.url), 'utf8');
  assert.match(css, /@view-transition\s*\{\s*navigation:\s*auto/);
  assert.match(css, /::view-transition-old\(root\)/);
  assert.match(css, /::view-transition-new\(root\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /animation:\s*none !important/);
});
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { renderRichText, richTextLink, richTextSummary, visualMarkdownSupported } from '../src/modules/profile-rich-text.js';
import { initRichTextEditor } from '../src/modules/rich-text-editor.js';

test('Markdown produces semantic paragraphs, lists, formatting and preserved soft breaks', () => {
  const { document } = parseHTML('<div id="text"></div>');
  const container = document.getElementById('text');
  renderRichText(container, 'First line\nSecond line\n\n**Bold** and *italic*.\n\n- One\n- Two\n\n1. First\n2. Second\n\n> Quote\n\n## Heading');
  assert.equal(container.querySelectorAll(':scope > p').length, 2);
  assert.equal(container.querySelectorAll('br').length, 1);
  assert.equal(container.querySelector('strong').textContent, 'Bold');
  assert.equal(container.querySelector('em').textContent, 'italic');
  assert.equal(container.querySelectorAll('ul > li').length, 2);
  assert.equal(container.querySelectorAll('ol > li').length, 2);
  assert.equal(container.querySelector('blockquote').textContent, 'Quote');
  assert.equal(container.querySelector('h3').textContent, 'Heading');
  renderRichText(container, 'Fish &amp; chips, &#60;safe&#62; and `&amp;`.');
  assert.equal(container.querySelector('p').textContent, 'Fish & chips, <safe> and &amp;.');
  renderRichText(container, '&#38;amp;');
  assert.equal(container.textContent, '&amp;');
  renderRichText(container, '');
  assert.equal(container.children.length, 0);
});

test('untrusted HTML is literal text, images are not embedded and links cannot execute code', () => {
  const { document } = parseHTML('<div id="text"></div>');
  const container = document.getElementById('text');
  renderRichText(container, '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[Unsafe](javascript:alert(1)) [Safe](https://example.com) ![Alt text](https://example.com/image.jpg)');
  assert.equal(container.querySelectorAll('script,img,iframe,style').length, 0);
  assert.match(container.textContent, /<script>alert\(1\)<\/script>/);
  assert.match(container.textContent, /Alt text/);
  assert.equal(container.querySelectorAll('a').length, 1);
  assert.equal(container.querySelector('a').getAttribute('href'), 'https://example.com');
  assert.match(container.querySelector('a').getAttribute('rel'), /noreferrer/);
  for (const value of ['javascript:alert(1)', 'data:text/html,test', '//unsafe.test', '/\\unsafe.test', 'https://user:password@example.com', 'java\nscript:test', 'https://example.com/\u0000']) assert.equal(richTextLink(value), '');
  for (const value of ['https://example.com', 'http://example.com', 'mailto:test@example.com', '/directory.html', '#section']) assert.equal(richTextLink(value), value);
});

test('card summaries remove Markdown syntax and unsupported visual syntax stays in source mode', () => {
  const { document } = parseHTML('<div></div>');
  assert.equal(richTextSummary('**Hello**\n\n- One\n- Two', document), 'Hello One Two');
  assert.equal(visualMarkdownSupported('Paragraph\n\n**Bold**\n\n- One\n- Two\n\n> Quote'), true);
  for (const source of ['<b>HTML</b>', '![Photo](https://example.com/a.jpg)', '|A|B|\n|-|-|\n|1|2|', '- [x] Done']) assert.equal(visualMarkdownSupported(source), false);
});

test('editor initialization and loading retain exact Markdown without modifying stored content', () => {
  const { document } = parseHTML('<label for="text">About</label><textarea id="text" maxlength="4000"></textarea>');
  const input = document.getElementById('text');
  const original = 'Paragraph\n\n- First\n- Second';
  input.value = original;
  const editor = initRichTextEditor(input);
  assert.equal(initRichTextEditor(input), editor);
  assert.equal(document.querySelectorAll('.rich-text-editor').length, 1);
  assert.equal(input.value, original);
  document.querySelector('[data-mode="preview"]').click();
  assert.equal(document.querySelectorAll('.rich-text-preview li').length, 2);
  editor.load('Updated\n\nSecond paragraph');
  assert.equal(document.querySelectorAll('.rich-text-preview p').length, 2);
  assert.equal(input.value, 'Updated\n\nSecond paragraph');
  editor.load('');
  assert.equal(document.querySelector('.rich-text-preview').textContent, '');
  editor.destroy();
});

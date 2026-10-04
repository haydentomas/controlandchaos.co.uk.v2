import { marked } from 'marked';
import DOMPurify from 'dompurify';

export function initEditor() {
  for (const button of document.querySelectorAll('[data-editor-tab]')) button.addEventListener('click', () => {
    for (const pane of document.querySelectorAll('.tab-content')) pane.classList.toggle('active', pane.id === button.dataset.editorTab);
    for (const item of document.querySelectorAll('[data-editor-tab]')) item.classList.toggle('active', item === button);
  });
  for (const button of document.querySelectorAll('[data-open-editor]')) button.addEventListener('click', () => {
    const kind = button.dataset.openEditor;
    const panel = document.getElementById(`${kind}-post-modal`);
    const prefix = kind === 'blog' ? 'modal-blog' : 'modal-post';
    for (const field of ['title', 'content', 'tag']) {
      const input = document.getElementById(`${prefix}-${field}`);
      if (input) input.value = button.dataset[`draft${field[0].toUpperCase() + field.slice(1)}`] || '';
    }
    panel?.classList.add('open');
    panel?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  for (const button of document.querySelectorAll('[data-close-editor]')) button.addEventListener('click', () => document.getElementById(`${button.dataset.closeEditor}-post-modal`)?.classList.remove('open'));

  const markdownInput = document.getElementById('modal-blog-content');
  const markdownPreview = document.getElementById('modal-blog-preview-rendered');
  const updateMarkdownPreview = () => {
    if (markdownInput && markdownPreview) markdownPreview.innerHTML = DOMPurify.sanitize(marked.parse(markdownInput.value));
  };
  for (const button of document.querySelectorAll('[data-content-mode]')) button.addEventListener('click', () => {
    const preview = button.dataset.contentMode === 'preview';
    updateMarkdownPreview();
    markdownInput?.classList.toggle('preview-hidden', preview);
    markdownPreview?.classList.toggle('preview-open', preview);
    for (const tab of document.querySelectorAll('[data-content-mode]')) {
      tab.classList.toggle('active', tab === button);
      tab.setAttribute('aria-pressed', String(tab === button));
    }
  });
  for (const button of document.querySelectorAll('[data-markdown]')) button.addEventListener('click', () => {
    if (!markdownInput) return;
    const top = markdownInput.scrollTop;
    const start = markdownInput.selectionStart;
    const end = markdownInput.selectionEnd;
    const selected = markdownInput.value.slice(start, end) || 'Text';
    const wrappers = { bold: ['**', '**'], italic: ['*', '*'], h2: ['\n## ', '\n'], list: ['\n- ', ''], link: ['[', '](https://example.com)'], quote: ['\n> ', '\n'], divider: ['\n\n---\n', ''] };
    const [before, after] = wrappers[button.dataset.markdown] || ['', ''];
    markdownInput.setRangeText(before + selected + after, start, end, 'select');
    markdownInput.focus({ preventScroll: true });
    markdownInput.scrollTop = top;
    updateMarkdownPreview();
  });
}
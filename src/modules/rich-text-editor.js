import { renderRichText, richTextLink, visualMarkdownSupported } from './profile-rich-text.js';

const instances = new WeakMap();
let nextId = 0;

export function initRichTextEditor(input) {
  if (instances.has(input)) return instances.get(input);
  if (!input.id) input.id = `rich-text-${++nextId}`;
  const doc = input.ownerDocument;
  const create = (tag, className = '') => { const element = doc.createElement(tag); element.className = className; return element; };
  const wrapper = create('div', 'rich-text-editor');
  const toolbar = create('div', 'rich-text-toolbar');
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', 'Text formatting');
  const modes = create('div', 'rich-text-modes');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Editing mode');
  const visual = create('div', 'rich-text-visual preview-hidden');
  const preview = create('div', 'rich-text-preview preview-hidden');
  const status = create('p', 'rich-text-status text-muted');
  status.setAttribute('role', 'status');
  const help = create('p', 'text-muted rich-text-help');
  help.textContent = 'Visual formatting or Markdown source. Blank lines create paragraphs. HTML and embedded images are not enabled.';
  input.before(wrapper);
  wrapper.append(modes, toolbar, input, visual, preview, status, help);
  input.dataset.richTextSource = '';
  let mode = 'markdown';
  let editor;
  let visualSource;
  let opening = false;
  let message = '';
  const controls = [];
  let history = [input.value];
  let historyIndex = 0;
  const label = doc.querySelector(`label[for="${input.id}"]`);
  if (label && !label.id) label.id = `${input.id}-label`;
  const disabled = () => input.matches(':disabled');
  const updateStatus = () => {
    const limit = Number(input.getAttribute('maxlength'));
    const tooLong = limit > 0 && input.value.length > limit;
    status.textContent = message || `${input.value.length}${limit > 0 ? ` / ${limit}` : ''} characters${tooLong ? ' - shorten this text before saving.' : ''}`;
    input.setCustomValidity?.(tooLong ? `Text must be at most ${limit} characters.` : '');
    visual.setAttribute('aria-invalid', String(tooLong));
  };
  const syncDisabled = () => {
    const locked = disabled();
    for (const control of controls) control.disabled = locked || opening;
    if (editor && editor.isEditable === locked) editor.setEditable(!locked, false);
    visual.setAttribute('aria-disabled', String(locked));
  };
  const changed = () => {
    message = '';
    updateStatus();
    input.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
  };
  const setMode = next => {
    mode = next;
    linkPanel?.classList.add('preview-hidden');
    input.classList.toggle('preview-hidden', next !== 'markdown');
    visual.classList.toggle('preview-hidden', next !== 'visual');
    preview.classList.toggle('preview-hidden', next !== 'preview');
    toolbar.classList.toggle('preview-hidden', next === 'preview');
    for (const control of modes.children) control.setAttribute('aria-pressed', String(control.dataset.mode === next));
    wrapper.dataset.mode = next;
    if (next === 'preview') renderRichText(preview, input.value);
    updateStatus();
  };
  const button = (parent, title, action) => {
    const control = create('button', 'btn btn-secondary btn-sm');
    control.type = 'button';
    control.textContent = title;
    control.setAttribute('aria-label', title);
    control.addEventListener('click', () => { if (!disabled() && !opening) action(); });
    parent.append(control);
    controls.push(control);
    return control;
  };
  const openVisual = async () => {
    if (!visualMarkdownSupported(input.value)) {
      message = 'Keep Markdown mode for tables, task lists, images, raw HTML or headings deeper than level 3. Your source has not been changed.';
      updateStatus();
      return;
    }
    opening = true;
    const previousFocus = doc.activeElement;
    const openingSource = input.value;
    syncDisabled();
    try {
      if (editor && visualSource !== input.value) {
        editor.destroy();
        editor = undefined;
      }
      if (!editor) {
        const [{ Editor }, { default: StarterKit }, { Markdown }] = await Promise.all([
          import('@tiptap/core'), import('@tiptap/starter-kit'), import('@tiptap/markdown')
        ]);
        if (!wrapper.isConnected || disabled()) return;
        if (input.value !== openingSource) {
          message = 'Text changed while Visual was loading. Your source is retained; select Visual again when ready.';
          return;
        }
        editor = new Editor({
          element: visual,
          extensions: [
            StarterKit.configure({ underline: false, trailingNode: false, heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: false, isAllowedUri: url => !!richTextLink(url) } }),
            Markdown.configure({ markedOptions: { gfm: true, breaks: true } })
          ],
          content: input.value,
          contentType: 'markdown',
          editorProps: {
            attributes: { class: 'rich-text-content', role: 'textbox', 'aria-multiline': 'true', ...(label ? { 'aria-labelledby': label.id } : { 'aria-label': 'Formatted text' }) },
            handlePaste: (view, event) => {
              const value = event.clipboardData?.getData('text/plain');
              if (!value) {
                message = 'Paste plain text here; clipboard images and rich-only content are not enabled.';
                updateStatus();
                return true;
              }
              view.dispatch(view.state.tr.insertText(value));
              return true;
            },
            handleDrop: (_view, event) => {
              event.preventDefault();
              message = 'Drag-and-drop is not enabled here. Paste plain text or use the formatting toolbar.';
              updateStatus();
              return true;
            }
          },
          onUpdate: () => {
            input.value = editor.getMarkdown();
            visualSource = input.value;
            changed();
          }
        });
      }
      visualSource = input.value;
      message = '';
      setMode('visual');
      if (doc.activeElement === previousFocus) editor.view.focus();
    } catch {
      message = 'Visual editor could not be loaded. Your text is retained; use Markdown mode or retry Visual.';
      setMode('markdown');
    } finally {
      opening = false;
      syncDisabled();
      updateStatus();
    }
  };
  for (const [name, title] of [['visual', 'Visual'], ['markdown', 'Markdown'], ['preview', 'Preview']]) {
    const control = button(modes, title, () => {
      if (name === 'visual') void openVisual();
      else { message = ''; setMode(name); if (name === 'markdown') input.focus(); }
    });
    control.dataset.mode = name;
  }
  const insert = (prefix, suffix = '', line = false) => {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const from = line ? input.value.lastIndexOf('\n', start - 1) + 1 : start;
    const selected = input.value.slice(from, end);
    const replacement = line ? selected.split('\n').map(text => prefix + text).join('\n') : prefix + (selected || 'Text') + suffix;
    const limit = Number(input.getAttribute('maxlength'));
    if (limit > 0 && input.value.length - (end - from) + replacement.length > limit) {
      message = `Formatting would exceed ${limit} characters. Shorten the text first.`;
      updateStatus();
      return;
    }
    input.setRangeText(replacement, from, end, 'select');
    input.focus();
    changed();
  };
  for (const [title, command, prefix, suffix, line] of [
    ['Bold', 'toggleBold', '**', '**'], ['Italic', 'toggleItalic', '*', '*'],
    ['Heading', 'toggleHeading', '## ', '', true], ['Bullet list', 'toggleBulletList', '- ', '', true],
    ['Numbered list', 'toggleOrderedList', '1. ', '', true], ['Quote', 'toggleBlockquote', '> ', '', true]
  ]) button(toolbar, title, () => {
    if (mode === 'visual') editor.chain().focus()[command](...(command === 'toggleHeading' ? [{ level: 2 }] : [])).run();
    else insert(prefix, suffix, line);
  });
  const linkPanel = create('div', 'rich-text-link-panel preview-hidden');
  const url = create('input', 'form-input');
  url.type = 'text';
  url.inputMode = 'url';
  url.setAttribute('aria-label', 'Link URL');
  url.placeholder = 'https://example.com';
  const linkStatus = create('p', 'text-muted');
  linkStatus.setAttribute('role', 'status');
  linkPanel.append(url, linkStatus);
  toolbar.after(linkPanel);
  let selection;
  button(toolbar, 'Link', () => {
    selection = mode === 'visual' ? { ...editor.state.selection.toJSON() } : { from: input.selectionStart, to: input.selectionEnd };
    linkPanel.classList.remove('preview-hidden');
    url.value = '';
    linkStatus.textContent = '';
    url.focus();
  });
  button(linkPanel, 'Apply link', () => {
    const href = richTextLink(url.value.trim());
    if (!href) { linkStatus.textContent = 'Use a valid HTTP(S), mailto, site-relative or anchor link.'; return; }
    if (mode === 'visual') editor.chain().focus().setTextSelection(selection).setLink({ href }).run();
    else {
      input.setSelectionRange(selection.from, selection.to);
      insert('[', `](${href.replaceAll('(', '%28').replaceAll(')', '%29')})`);
    }
    linkPanel.classList.add('preview-hidden');
  });
  button(linkPanel, 'Cancel link', () => { linkPanel.classList.add('preview-hidden'); });
  button(toolbar, 'Remove link', () => {
    if (mode === 'visual') editor.chain().focus().unsetLink().run();
    else { message = 'In Markdown, remove the surrounding [text](URL) syntax to remove a link.'; updateStatus(); }
  });
  button(toolbar, 'Undo', () => {
    if (mode === 'visual') editor.chain().focus().undo().run();
    else if (historyIndex > 0) {
      input.value = history[--historyIndex];
      changed();
    }
  });
  button(toolbar, 'Redo', () => {
    if (mode === 'visual') editor.chain().focus().redo().run();
    else if (historyIndex < history.length - 1) {
      input.value = history[++historyIndex];
      changed();
    }
  });
  input.addEventListener('input', () => {
    if (history[historyIndex] !== input.value) {
      history = [...history.slice(0, historyIndex + 1), input.value].slice(-100);
      historyIndex = history.length - 1;
    }
    message = '';
    updateStatus();
  });
  input.addEventListener('invalid', event => {
    if (mode !== 'markdown') { event.preventDefault(); setMode('markdown'); input.focus(); }
  });
  const Observer = doc.defaultView.MutationObserver;
  const observer = new Observer(syncDisabled);
  observer.observe(input, { attributes: true, attributeFilter: ['disabled'] });
  for (let ancestor = wrapper.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.tagName === 'FIELDSET') observer.observe(ancestor, { attributes: true, attributeFilter: ['disabled'] });
  }
  const api = {
    load(value) {
      input.value = value || '';
      history = [input.value];
      historyIndex = 0;
      editor?.destroy();
      editor = undefined;
      if (mode === 'visual') setMode('markdown');
      if (mode === 'preview') renderRichText(preview, input.value);
      message = '';
      updateStatus();
      syncDisabled();
    },
    focus() { if (mode === 'visual') editor.view.focus(); else { setMode('markdown'); input.focus(); } },
    destroy() { editor?.destroy(); observer.disconnect(); instances.delete(input); }
  };
  instances.set(input, api);
  label?.addEventListener('click', event => {
    if (mode !== 'markdown') { event.preventDefault(); api.focus(); }
  });
  setMode('markdown');
  syncDisabled();
  return api;
}

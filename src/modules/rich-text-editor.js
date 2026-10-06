import { richTextLink, visualMarkdownSupported } from './profile-rich-text.js';

const instances = new WeakMap();
let nextId = 0;
let editorModule;

export function flushRichTextEditors(container) {
  for (const input of container.querySelectorAll('[data-rich-text-source]')) instances.get(input)?.flush();
}

function loadEditor() {
  editorModule ||= Promise.all([
    import('@toast-ui/editor'),
    import('@toast-ui/editor/dist/toastui-editor.css'),
    import('@toast-ui/editor/dist/theme/toastui-editor-dark.css'),
    import('../standard-editor.css'),
    import('dompurify')
  ]).catch(error => { editorModule = undefined; throw error; });
  return editorModule;
}

export function initRichTextEditor(input, { height = '300px', minHeight = '220px' } = {}) {
  if (instances.has(input)) return instances.get(input);
  if (!input.id) input.id = `rich-text-${++nextId}`;
  const doc = input.ownerDocument;
  const create = (tag, className = '') => { const element = doc.createElement(tag); element.className = className; return element; };
  const wrapper = create('div', 'rich-text-editor');
  const host = create('div', 'standard-text-editor preview-hidden');
  const status = create('p', 'rich-text-status text-muted');
  status.setAttribute('role', 'status');
  const retry = create('button', 'rich-text-retry preview-hidden');
  retry.type = 'button';
  retry.textContent = 'Retry editor';
  const help = create('p', 'text-muted rich-text-help');
  help.textContent = 'Use the toolbar and link dialog, or switch to Markdown below the editor. Formatting counts toward the character limit. HTML and embedded images are not enabled.';
  input.before(wrapper);
  wrapper.append(host, input, status, retry, help);
  input.dataset.richTextSource = '';
  const label = doc.querySelector(`label[for="${input.id}"]`);
  if (label && !label.id) label.id = `${input.id}-label`;
  let editor;
  let opening = false;
  let destroyed = false;
  let syncing = false;
  let renderedMarkdown;
  let message = '';
  const disabled = () => input.matches(':disabled');
  const updateStatus = () => {
    const limit = Number(input.getAttribute('maxlength'));
    const tooLong = limit > 0 && input.value.length > limit;
    status.textContent = message || `${input.value.length}${limit > 0 ? ` / ${limit}` : ''} characters${tooLong ? ' - shorten this text before saving.' : ''}`;
    input.setCustomValidity?.(tooLong ? `Text must be at most ${limit} characters.` : '');
    host.setAttribute('aria-invalid', String(tooLong));
  };
  const syncDisabled = () => {
    const locked = disabled();
    host.inert = locked;
    host.setAttribute('aria-disabled', String(locked));
    for (const surface of host.querySelectorAll('.ProseMirror')) surface.setAttribute('contenteditable', String(!locked));
    retry.disabled = locked || opening;
    if (!locked && !editor && !opening && !destroyed && !message && typeof doc.defaultView.getSelection === 'function') void open();
  };
  const flush = () => {
    if (syncing || !editor || disabled()) return;
    const value = editor.getMarkdown();
    if (value === renderedMarkdown) return;
    renderedMarkdown = value;
    input.value = value;
    message = '';
    updateStatus();
    input.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
  };
  const open = async () => {
    if (opening || editor || destroyed || disabled()) return;
    opening = true;
    retry.disabled = true;
    try {
      const [{ default: Editor }, , , , { default: DOMPurify }] = await loadEditor();
      if (destroyed || !wrapper.isConnected || disabled()) return;
      syncing = true;
      editor = new Editor({
        el: host,
        theme: 'dark',
        height,
        minHeight,
        initialEditType: visualMarkdownSupported(input.value) ? 'wysiwyg' : 'markdown',
        initialValue: input.value,
        previewStyle: 'tab',
        autofocus: false,
        usageStatistics: false,
        extendedAutolinks: false,
        toolbarItems: [['heading', 'bold', 'italic', 'strike'], ['hr', 'quote'], ['ul', 'ol'], ['link'], ['code', 'codeblock']],
        linkAttributes: { rel: 'nofollow noopener noreferrer' },
        customHTMLRenderer: {
          htmlInline: node => ({ type: 'text', content: node.literal }),
          htmlBlock: node => [
            { type: 'openTag', tagName: 'div', outerNewLine: true },
            { type: 'text', content: node.literal },
            { type: 'closeTag', tagName: 'div', outerNewLine: true }
          ],
          image: (node, context) => {
            context.skipChildren();
            return { type: 'text', content: context.getChildrenText(node) };
          },
          softbreak: () => ({ type: 'openTag', tagName: 'br', selfClose: true })
        },
        customHTMLSanitizer: html => {
          const fragment = DOMPurify.sanitize(html, {
            RETURN_DOM_FRAGMENT: true,
            ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 's', 'del', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div'],
            ALLOWED_ATTR: ['href', 'rel', 'start', 'class', 'data-nodeid']
          });
          for (const link of fragment.querySelectorAll('a')) {
            if (!richTextLink(link.getAttribute('href'))) link.removeAttribute('href');
          }
          const container = doc.createElement('div');
          container.append(fragment);
          return container.innerHTML;
        },
        hooks: {
          addImageBlobHook: () => { message = 'Embedded images are not enabled in profile text. Use the Gallery image URL fields.'; updateStatus(); return false; }
        },
        events: {
          change: type => {
            if (syncing || !editor || disabled()) return;
            if ((type === 'markdown') !== editor.isMarkdownMode()) return;
            flush();
          }
        }
      });
      renderedMarkdown = editor.getMarkdown();
      const changeMode = editor.changeMode.bind(editor);
      editor.changeMode = (mode, withoutFocus) => {
        if (!syncing) flush();
        if (!syncing && mode === 'wysiwyg' && !visualMarkdownSupported(input.value)) {
          message = 'Keep Markdown mode for tables, task lists, images, raw HTML or headings deeper than level 3. Your source has not been changed.';
          updateStatus();
          return;
        }
        const wasSyncing = syncing;
        syncing = true;
        try {
          changeMode(mode, withoutFocus);
          if (mode === 'markdown') editor.setMarkdown(input.value, false);
          renderedMarkdown = editor.getMarkdown();
        }
        finally { syncing = wasSyncing; }
        message = '';
        updateStatus();
        syncDisabled();
      };
      for (const surface of host.querySelectorAll('.ProseMirror')) {
        surface.setAttribute('role', 'textbox');
        surface.setAttribute('aria-multiline', 'true');
        if (label) surface.setAttribute('aria-labelledby', label.id);
        else surface.setAttribute('aria-label', 'Formatted text');
      }
      input.classList.add('preview-hidden');
      host.classList.remove('preview-hidden');
      retry.classList.add('preview-hidden');
      message = '';
    } catch {
      editor?.destroy();
      editor = undefined;
      host.replaceChildren();
      host.classList.add('preview-hidden');
      input.classList.remove('preview-hidden');
      retry.classList.remove('preview-hidden');
      message = 'The editor could not be loaded. Your text is retained; edit Markdown here or retry.';
    } finally {
      syncing = false;
      opening = false;
      updateStatus();
      syncDisabled();
    }
  };
  host.addEventListener('click', event => {
    const mode = event.target.closest('.toastui-editor-mode-switch .tab-item');
    if (mode && editor) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!disabled()) editor.changeMode(mode.textContent === 'Markdown' ? 'markdown' : 'wysiwyg');
      return;
    }
    const button = event.target.closest('.toastui-editor-ok-button');
    const popup = button?.closest('.toastui-editor-popup');
    const url = popup?.querySelector('input[data-standard-link="url"], input[id="toastuiLinkUrlInput"]');
    if (url && !richTextLink(url.value.trim())) {
      event.preventDefault();
      event.stopImmediatePropagation();
      url.setAttribute('aria-invalid', 'true');
      message = 'Use a valid HTTP(S), mailto, site-relative or anchor link.';
      updateStatus();
      url.focus();
    } else if (url) {
      url.value = url.value.trim();
      url.removeAttribute('aria-invalid');
    }
  }, true);
  const popupObserver = new doc.defaultView.MutationObserver(() => {
    for (const [name, original] of [['url', 'toastuiLinkUrlInput'], ['text', 'toastuiLinkTextInput']]) {
      const field = host.querySelector(`input[id="${original}"]`);
      if (!field) continue;
      field.id = `${input.id}-${original}`;
      field.dataset.standardLink = name;
      host.querySelector(`label[for="${original}"]`)?.setAttribute('for', field.id);
    }
  });
  popupObserver.observe(host, { childList: true, subtree: true });
  host.addEventListener('keydown', event => {
    if (!event.target.matches('input[data-standard-link]') || !['Enter', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const popup = event.target.closest('.toastui-editor-popup');
    popup?.querySelector(event.key === 'Enter' ? '.toastui-editor-ok-button' : '.toastui-editor-close-button')?.click();
    if (event.key === 'Escape') editor?.focus();
  });
  host.addEventListener('paste', event => {
    if (disabled() || !editor || !editor.isWysiwygMode()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const value = event.clipboardData?.getData('text/plain');
    if (value) editor.insertText(value);
    else { message = 'Paste plain text here; clipboard images and rich-only content are not enabled.'; updateStatus(); }
  }, true);
  host.addEventListener('drop', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    message = 'Drag-and-drop is not enabled here. Paste text or use the formatting toolbar.';
    updateStatus();
  }, true);
  input.addEventListener('input', () => { message = ''; updateStatus(); });
  input.addEventListener('invalid', event => {
    if (editor) { event.preventDefault(); editor.changeMode('markdown'); editor.focus(); }
  });
  retry.addEventListener('click', () => { message = ''; void open(); });
  label?.addEventListener('click', event => {
    if (editor && !disabled()) { event.preventDefault(); editor.focus(); }
  });
  const observer = new doc.defaultView.MutationObserver(syncDisabled);
  observer.observe(input, { attributes: true, attributeFilter: ['disabled'] });
  for (let ancestor = wrapper.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.tagName === 'FIELDSET') observer.observe(ancestor, { attributes: true, attributeFilter: ['disabled'] });
  }
  const api = {
    load(value) {
      input.value = value || '';
      if (editor) {
        editor.destroy();
        editor = undefined;
        host.replaceChildren();
        host.classList.add('preview-hidden');
        input.classList.remove('preview-hidden');
      }
      message = '';
      updateStatus();
      syncDisabled();
    },
    focus() { if (editor) editor.focus(); else input.focus(); },
    flush,
    destroy() { flush(); destroyed = true; editor?.destroy(); observer.disconnect(); popupObserver.disconnect(); instances.delete(input); }
  };
  instances.set(input, api);
  updateStatus();
  syncDisabled();
  return api;
}

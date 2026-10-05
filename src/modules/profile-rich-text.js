import { marked } from 'marked';

export function richTextLink(value) {
  if (typeof value !== 'string' || !value || /[\u0000-\u0020\\]/.test(value) || value.startsWith('//')) return '';
  if (!/^(https?:\/\/|mailto:|\/|#)/i.test(value)) return '';
  try {
    const url = new URL(value, 'https://controlandchaosv2.netlify.app');
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) && !url.username && !url.password ? value : '';
  } catch { return ''; }
}

export function richTextTokens(value) {
  return marked.lexer(value || '', { gfm: true, breaks: true });
}

export function visualMarkdownSupported(value) {
  const supported = tokens => tokens.every(token => {
    if (['html', 'image', 'table'].includes(token.type) || token.task || (token.type === 'heading' && token.depth > 3)) return false;
    return (!token.tokens || supported(token.tokens)) && (!token.items || supported(token.items));
  });
  return supported(richTextTokens(value));
}

export function renderRichText(container, value) {
  const doc = container.ownerDocument;
  // Only a single entity reaches the HTML parser, never user markup.
  const decode = value => value.replace(/&(?:#[0-9]+|#x[a-f0-9]+|[a-z][a-z0-9]+);/gi, entity => {
    const decoder = doc.createElement('span');
    decoder.innerHTML = entity;
    return decoder.textContent;
  });
  const text = (parent, value) => parent.append(doc.createTextNode(value));
  const node = (parent, tag, tokens, value) => {
    const element = doc.createElement(tag);
    if (tokens) append(element, tokens);
    else if (value !== undefined) text(element, value);
    parent.append(element);
    return element;
  };
  const append = (parent, tokens) => {
    for (const token of tokens) {
      switch (token.type) {
        case 'space': case 'def': break;
        case 'paragraph': node(parent, 'p', token.tokens); break;
        case 'heading': node(parent, `h${Math.min(6, token.depth + 1)}`, token.tokens); break;
        case 'strong': node(parent, 'strong', token.tokens); break;
        case 'em': node(parent, 'em', token.tokens); break;
        case 'del': node(parent, 's', token.tokens); break;
        case 'codespan': node(parent, 'code', null, token.text); break;
        case 'code': node(node(parent, 'pre'), 'code', null, token.text); break;
        case 'blockquote': node(parent, 'blockquote', token.tokens); break;
        case 'br': node(parent, 'br'); break;
        case 'hr': node(parent, 'hr'); break;
        case 'list': {
          const list = node(parent, token.ordered ? 'ol' : 'ul');
          if (token.ordered && token.start !== 1) list.setAttribute('start', String(token.start));
          for (const item of token.items) {
            const li = node(list, 'li');
            if (item.task) text(li, item.checked ? '[x] ' : '[ ] ');
            append(li, item.tokens);
          }
          break;
        }
        case 'link': {
          const href = richTextLink(decode(token.href));
          if (!href) append(parent, token.tokens);
          else {
            const link = node(parent, 'a', token.tokens);
            link.setAttribute('href', href);
            link.setAttribute('rel', 'nofollow noopener noreferrer');
          }
          break;
        }
        case 'table': {
          const table = node(parent, 'table');
          const header = node(node(table, 'thead'), 'tr');
          for (const cell of token.header) node(header, 'th', cell.tokens);
          const body = node(table, 'tbody');
          for (const row of token.rows) {
            const tr = node(body, 'tr');
            for (const cell of row) node(tr, 'td', cell.tokens);
          }
          break;
        }
        case 'image': text(parent, decode(token.text)); break;
        case 'html': text(parent, token.raw); break;
        default:
          if (token.tokens) append(parent, token.tokens);
          else text(parent, token.type === 'text' ? decode(token.raw ?? token.text ?? '') : token.text ?? token.raw ?? '');
      }
    }
  };
  container.replaceChildren();
  container.classList.add('rich-text-content');
  append(container, richTextTokens(value));
}

export function richTextSummary(value, doc = document) {
  const container = doc.createElement('div');
  renderRichText(container, value);
  for (const block of container.querySelectorAll('p,li,blockquote,h2,h3,h4,h5,h6,br')) block.append(doc.createTextNode(' '));
  return container.textContent.replace(/\s+/g, ' ').trim();
}

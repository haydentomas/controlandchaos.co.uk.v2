export function pageShellTags() {
  return [
    { tag: 'style', attrs: { id: 'v2-page-canvas' }, children: 'html{background:#12100e;color-scheme:dark}', injectTo: 'head-prepend' },
    { tag: 'meta', attrs: { name: 'theme-color', content: '#12100e' }, injectTo: 'head-prepend' },
    { tag: 'link', attrs: { rel: 'stylesheet', href: '/src/templates.css' }, injectTo: 'head-prepend' }
  ];
}

export function pageShellPlugin() {
  return {
    name: 'v2-page-shell',
    transformIndexHtml: { order: 'pre', handler: () => pageShellTags() }
  };
}
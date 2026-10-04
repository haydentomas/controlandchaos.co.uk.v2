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

export function adminRoutePlugin() {
  return {
    name: 'v2-admin-route',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url, 'http://localhost');
        if (url.pathname === '/admin' || url.pathname === '/admin/') request.url = `/admin/index.html${url.search}`;
        if (url.pathname === '/admin/site-preview.css') request.url = '/src/templates.css?direct';
        next();
      });
    }
  };
}
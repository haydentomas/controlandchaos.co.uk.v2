(() => {
  const environment = new nunjucks.Environment(new nunjucks.PrecompiledLoader(window.nunjucksPrecompiled), { autoescape: true });
  const safeUrl = (value, fallback = '#') => /^(?:\/(?!\/)|https?:\/\/|secondlife:\/\/|blob:)/i.test(String(value || '')) ? String(value) : fallback;
  const draftData = entry => entry.get('data').toJS();
  const render = (template, data) => environment.render(`partials/${template}.njk`, data);
  const markup = html => h('div', { className: 'cms-preview', dangerouslySetInnerHTML: { __html: html } });

  CMS.registerPreviewStyle('/admin/site-preview.css');
  CMS.registerPreviewStyle('/admin/preview.css');
  CMS.registerPreviewStyle('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Outfit:wght@400;500;600;700;800;900&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');

  CMS.registerPreviewTemplate('global', createClass({
    render() {
      const data = draftData(this.props.entry);
      const navigation = data.navigation || {};
      const footer = data.footer || {};
      const cleanLink = link => ({ ...link, url: safeUrl(link.url), newTab: !!link.newTab });
      const site = {
        ...data,
        home: '/index.html',
        logo: safeUrl(data.logo ? this.props.getAsset(data.logo).toString() : '/images/logo.png', '/images/logo.png'),
        navigation: { ...navigation, inworldUrl: safeUrl(navigation.inworldUrl), links: (navigation.links || []).map(cleanLink) },
        footer: { ...footer, columns: (footer.columns || []).map(column => ({ ...column, links: (column.links || []).map(cleanLink) })) }
      };
      return markup(`<section class="cms-preview-section"><h2 class="cms-preview-heading">Header</h2>${render('header', { site })}</section><section class="cms-preview-section"><h2 class="cms-preview-heading">Footer</h2>${render('footer', { site, page: { whiteLabel: false } })}</section>`);
    }
  }));

  CMS.registerPreviewTemplate('events', createClass({
    render() {
      const data = draftData(this.props.entry);
      const calendar = new URL('https://calendar.google.com/calendar/render');
      calendar.searchParams.set('action', 'TEMPLATE');
      calendar.searchParams.set('text', data.gcal_title || data.title || '');
      const event = { ...data, slurl: safeUrl(data.slurl), calendarUrl: calendar.href };
      return markup(render('event-card', { event }));
    }
  }));

  CMS.registerPreviewTemplate('blog', createClass({
    render() {
      const data = draftData(this.props.entry);
      const post = {
        ...data,
        url: '#',
        featured_image: data.featured_image ? safeUrl(this.props.getAsset(data.featured_image).toString(), '') : ''
      };
      return h('div', { className: 'cms-preview cms-blog-preview' }, [
        h('div', { dangerouslySetInnerHTML: { __html: render('blog-card', { post }) } }),
        h('div', { className: 'article-body cms-blog-body' }, this.props.widgetFor('content'))
      ]);
    }
  }));

  CMS.registerPreviewTemplate('product_guides', createClass({
    render() {
      const data = draftData(this.props.entry);
      const listing = data.listing || {};
      const guide = {
        ...data,
        url: '#',
        marketplace_url: safeUrl(data.marketplace_url),
        listing: { ...listing, image: listing.image ? safeUrl(this.props.getAsset(listing.image).toString(), '') : '' }
      };
      return h('div', { className: 'cms-preview cms-guide-preview' }, [
        h('div', { dangerouslySetInnerHTML: { __html: render('guide-card', { guide }) } }),
        h('div', { className: 'manual-rich-text cms-guide-sections' }, this.props.widgetFor('sections')),
        h('div', { className: 'cms-guide-details' }, [this.props.widgetFor('features'), this.props.widgetFor('chat_commands'), this.props.widgetFor('specs')])
      ]);
    }
  }));
})();
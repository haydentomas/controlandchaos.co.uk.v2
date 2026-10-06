import { initRichTextEditor, flushRichTextEditors } from './rich-text-editor.js';
import { optimizeGalleryUpload } from './gallery-image-upload.js';

const BUCKET = 'creator-blog-media';
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'audio/mp4', 'video/mp4', 'video/webm']);

function validatePosts(posts, monthlyPrice) {
  if (!Array.isArray(posts) || posts.length > 100) throw new Error('Use up to 100 blog posts.');
  return posts.map((post, index) => {
    if (!post || typeof post !== 'object' || Array.isArray(post)) throw new Error('Check blog post details.');
    const title = String(post.title || '').trim();
    const tag = String(post.tag || '').trim();
    const teaser = String(post.teaser || '').trim();
    const body = String(post.body_markdown || '');
    const access = post.access_level;
    const type = post.post_type;
    const mediaType = post.media_type || 'text';
    const mediaPath = String(post.media_path || '');
    const mediaUrl = String(post.media_url || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(post.id || '') || !title || title.length > 160 || tag.length > 60 || teaser.length > 1000 || body.length > 30000) throw new Error(`Check the title and text for post ${index + 1}.`);
    if (!['post', 'live_update'].includes(type) || !['public', 'subscribers'].includes(access) || !['text', 'image', 'audio', 'video'].includes(mediaType)) throw new Error(`Check the format and access for post ${index + 1}.`);
    if (post.is_published && access === 'subscribers' && (!monthlyPrice || !teaser)) throw new Error('Set a monthly price and teaser before publishing subscriber-only posts.');
    if (access === 'subscribers' && mediaUrl) throw new Error('Subscriber-only media must be uploaded privately, not linked by URL.');
    if (mediaUrl && (!/^https:\/\/[^\s]+$/.test(mediaUrl) || /^https:\/\/[^/?#]*@/.test(mediaUrl))) throw new Error('Use a safe HTTPS media URL.');
    return {
      id: post.id,
      legacy_id: String(post.legacy_id || '').slice(0, 100),
      post_type: type,
      access_level: access,
      title,
      tag,
      teaser,
      body_markdown: body,
      media_type: mediaType,
      media_path: mediaPath,
      media_url: mediaUrl,
      is_published: post.is_published === true,
      sort_order: index
    };
  });
}

export function initCreatorBlogEditor(container, addButton, monthlyPriceInput, benefitsInput, reportStatus = () => {}) {
  let posts = [];
  let textEditors = [];
  let profileId = '';
  let client;
  let loaded = false;
  let savedMediaPaths = new Set();
  let expandedPostId = null;
  const create = (tag, className = '') => {
    const element = document.createElement(tag);
    element.className = className;
    return element;
  };
  const selectOption = (select, value) => {
    const option = [...select.querySelectorAll('option')].find(candidate => candidate.value === value);
    if (option) option.selected = true;
  };
  const button = (label, ariaLabel, action, disabled = false) => {
    const control = create('button', 'btn btn-secondary btn-sm');
    control.type = 'button';
    control.textContent = label;
    control.title = ariaLabel;
    control.setAttribute('aria-label', ariaLabel);
    control.disabled = disabled;
    control.addEventListener('click', () => {
      if (!container.closest('fieldset')?.disabled) action();
    });
    return control;
  };
  const paint = () => {
    flushRichTextEditors(container);
    for (const editor of textEditors) editor.destroy();
    textEditors = [];
    container.replaceChildren();
    addButton.disabled = !loaded || posts.length >= 100;
    const count = container.closest('#creator-blog')?.querySelector('[data-blog-count]');
    if (count) count.textContent = `${posts.length} / 100 posts`;
    if (!posts.length) {
      const empty = create('p', 'text-muted');
      empty.textContent = 'No posts yet. Add a public update or a subscriber-only post.';
      container.append(empty);
    }
    posts.forEach((post, index) => {
      const expanded = post.id === expandedPostId;
      const row = create('section', 'creator-blog-editor-item');
      row.dataset.blogEditorPost = post.id;
      const header = create('div', 'creator-blog-editor-header');
      const summary = create('button', 'creator-blog-editor-toggle');
      summary.type = 'button';
      summary.id = `blog-post-${post.id}-toggle`;
      summary.dataset.blogPostToggle = '';
      summary.setAttribute('aria-expanded', String(expanded));
      const details = create('div', 'creator-blog-editor-details');
      details.id = `blog-post-${post.id}-details`;
      details.hidden = !expanded;
      summary.setAttribute('aria-controls', details.id);
      const summaryCopy = create('span', 'creator-blog-summary-copy');
      const summaryTitle = create('span', 'creator-blog-summary-title');
      const summaryMeta = create('span', 'creator-blog-summary-meta');
      const summaryAction = create('span', 'creator-blog-summary-action');
      summaryAction.textContent = expanded ? 'Close' : 'Edit';
      summaryCopy.append(summaryTitle, summaryMeta);
      summary.append(summaryCopy, summaryAction);
      const updateSummary = () => {
        summaryTitle.textContent = post.title || `Untitled post ${index + 1}`;
        summaryMeta.textContent = [post.post_type === 'live_update' ? 'Live update' : 'Post', post.access_level === 'subscribers' ? 'Subscribers' : 'Public', post.is_published ? 'Published' : 'Draft'].join(' | ');
        summary.setAttribute('aria-label', `${expanded ? 'Close' : 'Edit'} post ${index + 1}: ${post.title || 'Untitled post'}`);
      };
      updateSummary();
      summary.addEventListener('click', () => {
        expandedPostId = expanded ? null : post.id;
        paint();
        document.getElementById(`blog-post-${post.id}-toggle`)?.focus();
      });
      const controls = create('div', 'creator-blog-editor-actions');
      const move = offset => {
        const target = index + offset;
        if (target < 0 || target >= posts.length) return;
        const [moved] = posts.splice(index, 1);
        posts.splice(target, 0, moved);
        paint();
        document.getElementById(`blog-post-${moved.id}-toggle`)?.focus();
      };
      controls.append(
        button('\u2191', 'Move post up', () => move(-1), index === 0),
        button('\u2193', 'Move post down', () => move(1), index === posts.length - 1),
        button('Remove post', 'Remove post', () => { if (expandedPostId === post.id) expandedPostId = null; posts.splice(index, 1); paint(); })
      );
      header.append(summary, controls);
      row.append(header, details);
      container.append(row);
      const grid = create('div', 'form-grid-2');
      const textField = (name, labelText, max, tag = 'input') => {
        const group = create('div');
        const label = create('label', 'form-label');
        const input = create(tag, tag === 'textarea' ? 'form-textarea' : 'form-input');
        input.id = `blog-post-${post.id}-${name}`;
        label.htmlFor = input.id;
        label.textContent = labelText;
        input.maxLength = max;
        input.value = post[name] || '';
        if (tag === 'textarea') input.rows = 2;
        input.addEventListener('input', () => { post[name] = input.value; updateSummary(); });
        group.append(label, input);
        grid.append(group);
        return input;
      };
      const selectField = (name, labelText, options) => {
        const group = create('div');
        const label = create('label', 'form-label');
        const select = create('select', 'form-select');
        select.id = `blog-post-${post.id}-${name}`;
        label.htmlFor = select.id;
        label.textContent = labelText;
        for (const [value, text] of options) {
          const option = create('option');
          option.value = value;
          option.textContent = text;
          select.append(option);
        }
        selectOption(select, post[name]);
        select.addEventListener('change', () => { post[name] = select.value; updateSummary(); });
        group.append(label, select);
        grid.append(group);
        return select;
      };
      const title = textField('title', 'Post title', 160);
      title.required = true;
      selectField('post_type', 'Entry type', [['post', 'Blog post'], ['live_update', 'Live update']]);
      selectField('access_level', 'Access', [['public', 'Public'], ['subscribers', 'Subscribers only']]);
      textField('tag', 'Tag / badge', 60);
      textField('teaser', 'Preview / teaser', 1000, 'textarea');
      details.append(grid);
      const body = create('textarea', 'form-textarea creator-blog-body');
      body.id = `blog-post-${post.id}-body`;
      body.maxLength = 30000;
      body.value = post.body_markdown || '';
      body.rows = 10;
      const bodyLabel = create('label', 'form-label');
      bodyLabel.htmlFor = body.id;
      bodyLabel.textContent = 'Post content';
      body.addEventListener('input', () => { post.body_markdown = body.value; });
      details.append(bodyLabel, body);
      if (expanded) textEditors.push(initRichTextEditor(body));
      const mediaGrid = create('div', 'form-grid-2');
      const mediaType = create('select', 'form-select');
      mediaType.id = `blog-post-${post.id}-media-type`;
      const mediaTypeLabel = create('label', 'form-label');
      mediaTypeLabel.htmlFor = mediaType.id;
      mediaTypeLabel.textContent = 'Media type';
      for (const [value, label] of [['text', 'Text only'], ['image', 'Image'], ['audio', 'Audio'], ['video', 'Video']]) {
        const option = create('option');
        option.value = value;
        option.textContent = label;
        mediaType.append(option);
      }
      selectOption(mediaType, post.media_type || 'text');
      mediaType.addEventListener('change', () => { post.media_type = mediaType.value; });
      const mediaTypeGroup = create('div');
      mediaTypeGroup.append(mediaTypeLabel, mediaType);
      mediaGrid.append(mediaTypeGroup);
      const mediaGroup = create('div');
      const mediaLabel = create('label', 'form-label');
      const mediaInput = create('input', 'form-input');
      mediaInput.type = 'file';
      mediaInput.accept = [...ALLOWED_MEDIA_TYPES].join(',');
      mediaInput.id = `blog-post-${post.id}-file`;
      mediaLabel.htmlFor = mediaInput.id;
      mediaLabel.textContent = 'Upload media';
      const mediaStatus = create('p', 'text-muted');
      mediaStatus.textContent = post.pendingFile?.name || (post.media_path ? 'Private media is saved. Choose a file to replace it.' : post.media_url ? 'Public media URL is saved.' : 'Images up to 10 MB; audio/video up to 25 MB.');
      mediaInput.addEventListener('change', () => {
        const file = mediaInput.files?.[0];
        if (!file) return;
        const maxSize = file.type.startsWith('image/') ? 10 * 1024 * 1024 : MAX_FILE_BYTES;
        if (!ALLOWED_MEDIA_TYPES.has(file.type) || file.size <= 0 || file.size > maxSize) {
          mediaInput.value = '';
          mediaStatus.textContent = 'Choose JPEG/PNG/WebP up to 10 MB or MP3/MP4/WebM media up to 25 MB.';
          return;
        }
        post.pendingFile = file;
        post.media_url = '';
        post.media_type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : 'video';
        selectOption(mediaType, post.media_type);
        mediaStatus.textContent = `${file.name} is ready; it uploads when you save.`;
      });
      mediaGroup.append(mediaLabel, mediaInput, mediaStatus);
      mediaGrid.append(mediaGroup);
      details.append(mediaGrid);
      if (post.media_path || post.media_url) {
        const mediaSummary = create('p', 'text-muted');
        mediaSummary.textContent = post.media_path ? 'Saved private upload.' : 'Saved public HTTPS media URL.';
        details.append(mediaSummary);
      }
      const urlField = textField('media_url', 'Public media URL (optional)', 2048);
      urlField.type = 'url';
      const publication = create('label', 'profile-feature-switch');
      const published = create('input');
      published.type = 'checkbox';
      published.checked = post.is_published === true;
      published.addEventListener('change', () => { post.is_published = published.checked; updateSummary(); });
      const publicationText = create('span');
      publicationText.textContent = 'Publish post';
      publication.append(published, publicationText);
      details.append(publication);
      if (expanded) {
        post._bodyInput = body;
      }
    });
  };
  const getPosts = () => {
    flushRichTextEditors(container);
    const monthlyPrice = Number(monthlyPriceInput.value);
    const benefits = String(benefitsInput.value || '').trim();
    if (!Number.isInteger(monthlyPrice) || monthlyPrice < 0 || monthlyPrice > 1000000) throw new Error('Set a monthly price between L$0 and L$1,000,000.');
    if (benefits.length > 1000) throw new Error('Shorten the subscriber benefits summary.');
    return { monthlyPrice, benefits, posts: validatePosts(posts.map(post => ({ ...post, body_markdown: post._bodyInput?.value ?? post.body_markdown })), monthlyPrice) };
  };
  addButton.addEventListener('click', () => {
    if (container.closest('fieldset')?.disabled || posts.length >= 100) return;
    const post = { id: crypto.randomUUID(), legacy_id: '', post_type: 'post', access_level: 'public', title: '', tag: '', teaser: '', body_markdown: '', media_type: 'text', media_path: '', media_url: '', is_published: false, sort_order: posts.length };
    posts.unshift(post);
    expandedPostId = post.id;
    paint();
    document.getElementById(`blog-post-${post.id}-title`)?.focus();
  });
  return {
    async load(clientValue, profile) {
      client = clientValue;
      profileId = profile.id;
      loaded = false;
      posts = [];
      expandedPostId = null;
      savedMediaPaths.clear();
      monthlyPriceInput.value = String(profile.creator_blog_monthly_linden || 0);
      benefitsInput.value = profile.creator_blog_benefits || '';
      paint();
      const { data, error } = await client.rpc('creator_blog_editor_posts', { target_profile: profileId });
      if (error || !Array.isArray(data)) throw new Error('Creator blog could not be loaded. Apply migration 14 before using the blog editor.');
      posts = data.map(post => ({ ...post, pendingFile: null }));
      savedMediaPaths = new Set(posts.map(post => post.media_path).filter(Boolean));
      loaded = true;
      expandedPostId = null;
      paint();
    },
    clear() {
      loaded = false;
      posts = [];
      expandedPostId = null;
      savedMediaPaths.clear();
      monthlyPriceInput.value = '0';
      benefitsInput.value = '';
      paint();
    },
    value() { return getPosts(); },
    async save(onProgress = () => {}) {
      if (!loaded) throw new Error('Creator blog is unavailable until migration 14 is applied.');
      const value = getPosts();
      if (!client || !profileId) throw new Error('Select an active profile before saving blog posts.');
      if (posts.some(post => post.pendingFile) && !client.storage?.from) throw new Error('Creator blog media storage is unavailable. Try again later.');
      const uploaded = [];
      try {
        for (const post of posts.filter(item => item.pendingFile)) {
          const file = post.pendingFile;
          let blob = file;
          let mime = file.type;
          let extension = mime === 'audio/mpeg' ? 'mp3' : mime === 'audio/mp4' ? 'm4a' : mime === 'video/mp4' ? 'mp4' : mime === 'video/webm' ? 'webm' : '';
          if (mime.startsWith('image/')) {
            blob = await optimizeGalleryUpload(file);
            mime = 'image/webp';
            extension = 'webp';
          }
          const path = `${profileId}/${post.id}/${crypto.randomUUID()}.${extension}`;
          onProgress(`Uploading media for ${post.title}...`);
          const { error } = await client.storage.from(BUCKET).upload(path, blob, { contentType: mime, cacheControl: '31536000', upsert: false });
          if (error) throw new Error('Blog media upload failed. Check your connection and retry.');
          uploaded.push({ post, path, oldPath: post.media_path || '', oldUrl: post.media_url || '' });
          post.media_path = path;
          post.media_url = '';
        }
        onProgress('Saving creator blog...');
        const { error } = await client.rpc('creator_blog_save_all', {
          target_profile: profileId,
          monthly_price: value.monthlyPrice,
          benefits: value.benefits,
          posts: posts.map((post, sort_order) => ({
            id: post.id,
            legacy_id: post.legacy_id || '',
            post_type: post.post_type,
            access_level: post.access_level,
            title: post.title,
            tag: post.tag || '',
            teaser: post.teaser || '',
            body_markdown: post._bodyInput?.value ?? post.body_markdown ?? '',
            media_type: post.media_type || 'text',
            media_path: post.media_path || '',
            media_url: post.media_url || '',
            is_published: post.is_published === true,
            sort_order
          }))
        });
        if (error) throw new Error('Creator blog could not be saved. Check the price, post fields and subscription access.');
        const active = new Set(posts.map(post => post.media_path).filter(Boolean));
        const obsolete = [...savedMediaPaths].filter(path => !active.has(path));
        if (obsolete.length) await client.storage.from(BUCKET).remove(obsolete).catch(() => {});
        for (const post of posts) { post.pendingFile = null; post._bodyInput = null; }
        savedMediaPaths = active;
      } catch (error) {
        const newPaths = uploaded.map(item => item.path);
        if (newPaths.length) await client.storage.from(BUCKET).remove(newPaths).catch(() => {});
        for (const item of uploaded) {
          item.post.media_path = item.oldPath;
          item.post.media_url = item.oldUrl;
        }
        throw error;
      }
    }
  };
}

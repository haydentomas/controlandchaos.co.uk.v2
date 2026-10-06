import { initRichTextEditor, flushRichTextEditors } from './rich-text-editor.js';
import { optimizeGalleryUpload } from './gallery-image-upload.js';
import { BLOG_ATTACHMENT_LIMIT, blogAttachments, missingBlogV2Rpc, renderCreatorBlogMedia, validateBlogAttachments } from './creator-blog-media.js';

const BUCKET = 'creator-blog-media';
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'audio/mp4', 'video/mp4', 'video/webm']);

function validatePosts(posts, monthlyPrice, attachmentLimit) {
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
    const attachments = validateBlogAttachments(post.attachments, post, attachmentLimit);
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
      sort_order: index,
      attachments
    };
  });
}

export function initCreatorBlogEditor(container, addButton, monthlyPriceInput, benefitsInput, reportStatus = () => {}) {
  let posts = [];
  const textEditors = new Map();
  let profileId = '';
  let client;
  let loaded = false;
  let savedMediaPaths = new Set();
  let expandedPostId = null;
  let multiAttachments = false;
  let accessGeneration = 0;
  let previewGeneration = 0;
  const previewUrls = new Set();
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
    const generation = ++previewGeneration;
    for (const url of previewUrls) URL.revokeObjectURL(url);
    previewUrls.clear();
    flushRichTextEditors(container);
    for (const [id, entry] of textEditors) {
      if (!posts.some(post => post.id === id)) { entry.editor.destroy(); textEditors.delete(id); }
    }
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
      const cachedBody = textEditors.get(post.id);
      const body = cachedBody?.body || create('textarea', 'form-textarea creator-blog-body');
      body.id = `blog-post-${post.id}-body`;
      body.maxLength = 30000;
      body.value = post.body_markdown || '';
      body.rows = 10;
      const bodyLabel = cachedBody?.label || create('label', 'form-label');
      bodyLabel.htmlFor = body.id;
      bodyLabel.textContent = 'Post content';
      if (!cachedBody) body.addEventListener('input', () => { post.body_markdown = body.value; });
      details.append(bodyLabel);
      if (cachedBody) details.append(cachedBody.wrapper);
      else {
        details.append(body);
        if (expanded) {
          const editor = initRichTextEditor(body);
          textEditors.set(post.id, { editor, body, label: bodyLabel, wrapper: body.closest('.rich-text-editor') || body });
        }
      }
      const mediaGroup = create('div', 'creator-blog-attachments');
      const limit = multiAttachments ? BLOG_ATTACHMENT_LIMIT : 1;
      const attachmentCount = create('p', 'text-muted');
      attachmentCount.textContent = `${post.attachments.length} / ${limit} attachments. Images up to 10 MB; audio/video up to 25 MB.${multiAttachments ? '' : ' Apply migration 15 to enable mixed-media posts.'}`;
      mediaGroup.append(attachmentCount);
      const mediaLabel = create('label', 'form-label');
      const mediaInput = create('input', 'form-input');
      mediaInput.type = 'file';
      mediaInput.multiple = multiAttachments;
      mediaInput.accept = [...ALLOWED_MEDIA_TYPES].join(',');
      mediaInput.id = `blog-post-${post.id}-file`;
      mediaLabel.htmlFor = mediaInput.id;
      mediaLabel.textContent = multiAttachments ? 'Add media files' : 'Upload media';
      const mediaStatus = create('p', 'text-muted');
      mediaStatus.setAttribute('role', 'status');
      mediaInput.addEventListener('change', () => {
        const files = [...(mediaInput.files || [])];
        if (!files.length) return;
        if (multiAttachments && post.attachments.length + files.length > limit) {
          mediaStatus.textContent = `Use up to ${limit} attachments per post. No files were added.`;
          mediaInput.value = '';
          return;
        }
        if (files.some(file => !ALLOWED_MEDIA_TYPES.has(file.type) || file.size <= 0 || file.size > (file.type.startsWith('image/') ? 10 * 1024 * 1024 : MAX_FILE_BYTES))) {
          mediaInput.value = '';
          mediaStatus.textContent = 'Choose JPEG/PNG/WebP up to 10 MB or MP3/MP4/WebM up to 25 MB. No files were added.';
          return;
        }
        const selected = files.map(file => ({ id: crypto.randomUUID(), media_type: file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : 'video', media_path: '', media_url: '', pendingFile: file }));
        post.attachments = multiAttachments ? [...post.attachments, ...selected] : selected;
        paint();
      });
      mediaGroup.append(mediaLabel, mediaInput, mediaStatus);
      const attachmentGrid = create('div', 'creator-blog-attachment-grid');
      mediaGroup.append(attachmentGrid);
      details.append(mediaGroup);
      post.attachments.forEach((attachment, attachmentIndex) => {
        const tile = create('section', 'creator-blog-attachment-tile');
        tile.dataset.blogAttachment = attachment.id;
        const label = create('p', 'text-muted');
        label.textContent = `${attachmentIndex + 1}. ${attachment.pendingFile?.name || `${attachment.media_type} - ${attachment.media_path ? 'Saved private upload' : 'Public URL'}`}`;
        const mediaPreview = create('div', 'creator-blog-editor-media-preview');
        mediaPreview.setAttribute('aria-label', `Attachment ${attachmentIndex + 1} preview`);
        const controls = create('div', 'creator-blog-editor-actions');
        const moveAttachment = offset => {
          const [moved] = post.attachments.splice(attachmentIndex, 1);
          post.attachments.splice(attachmentIndex + offset, 0, moved);
          paint();
        };
        controls.append(
          button('\u2191', `Move attachment ${attachmentIndex + 1} up`, () => moveAttachment(-1), attachmentIndex === 0),
          button('\u2193', `Move attachment ${attachmentIndex + 1} down`, () => moveAttachment(1), attachmentIndex === post.attachments.length - 1),
          button('Remove', `Remove attachment ${attachmentIndex + 1}`, () => { post.attachments.splice(attachmentIndex, 1); paint(); })
        );
        tile.append(label, mediaPreview, controls);
        attachmentGrid.append(tile);
        if (!expanded) return;
        const updateMediaPreview = async () => {
        const previewStatus = create('p', 'text-muted');
        previewStatus.setAttribute('role', 'status');
        mediaPreview.append(previewStatus);
        const media = create('div');
        mediaPreview.append(media);
        const failed = 'Media preview could not be loaded. Reopen the post to retry; the saved upload has not been changed.';
        try {
          let url = '';
          if (attachment.pendingFile) {
            const pendingUrl = URL.createObjectURL(attachment.pendingFile);
            previewUrls.add(pendingUrl);
            url = pendingUrl;
            previewStatus.textContent = 'Selected file preview. Uploads when you save.';
          } else if (attachment.media_path) {
            previewStatus.textContent = 'Loading private media preview...';
            const { data, error } = await client.storage.from(BUCKET).createSignedUrl(attachment.media_path, 300);
            if (generation !== previewGeneration) return;
            if (error || !data?.signedUrl) throw new Error(failed);
            url = data.signedUrl;
            previewStatus.textContent = 'Private media preview. This link expires after five minutes; reopen the post to refresh it.';
          } else if (attachment.media_url) {
            if (!/^https:\/\/[^\s\\]+$/.test(attachment.media_url) || /^https:\/\/[^/?#]*@/.test(attachment.media_url)) throw new Error('Use a safe HTTPS media URL to preview linked media.');
            url = attachment.media_url;
            previewStatus.textContent = 'Linked public media preview.';
          } else {
            mediaPreview.replaceChildren();
            return;
          }
          if (generation !== previewGeneration) return;
          renderCreatorBlogMedia(media, { ...attachment, title: `${post.title} - attachment ${attachmentIndex + 1}` }, url, failed);
        } catch (error) {
          if (generation === previewGeneration) {
            previewStatus.textContent = error.message === 'Use a safe HTTPS media URL to preview linked media.' ? error.message : failed;
          }
        }
        };
        void updateMediaPreview();
      });
      if (post.access_level === 'public') {
        const linkGroup = create('div', 'form-grid-2');
        const linkType = create('select', 'form-select');
        linkType.setAttribute('aria-label', 'Linked attachment type');
        for (const kind of ['image','audio','video']) {
          const option = create('option');
          option.value = kind;
          option.textContent = kind;
          linkType.append(option);
        }
        const linkInput = create('input', 'form-input');
        linkInput.type = 'url';
        linkInput.maxLength = 2048;
        linkInput.setAttribute('aria-label', 'Public attachment URL');
        linkInput.placeholder = 'https://... (public media only)';
        const addLink = button('Add public media URL', 'Add public media URL', () => {
          const url = linkInput.value.trim();
          if (!/^https:\/\/[^\s\\]+$/.test(url) || /^https:\/\/[^/?#]*@/.test(url)) { mediaStatus.textContent = 'Use a safe HTTPS media URL.'; return; }
          if (post.attachments.length >= limit) { mediaStatus.textContent = `Use up to ${limit} attachments per post.`; return; }
          post.attachments.push({ id: crypto.randomUUID(), media_type: linkType.value, media_path: '', media_url: url, pendingFile: null });
          paint();
        });
        linkGroup.append(linkType, linkInput, addLink);
        mediaGroup.append(linkGroup);
      }
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
    return { monthlyPrice, benefits, posts: validatePosts(posts.map(post => ({ ...post, media_type: 'text', media_path: '', media_url: '', body_markdown: post._bodyInput?.value ?? post.body_markdown })), monthlyPrice, multiAttachments ? BLOG_ATTACHMENT_LIMIT : 1) };
  };
  addButton.addEventListener('click', () => {
    if (container.closest('fieldset')?.disabled || posts.length >= 100) return;
    const post = { id: crypto.randomUUID(), legacy_id: '', post_type: 'post', access_level: 'public', title: '', tag: '', teaser: '', body_markdown: '', media_type: 'text', media_path: '', media_url: '', attachments: [], is_published: false, sort_order: posts.length };
    posts.unshift(post);
    expandedPostId = post.id;
    paint();
    document.getElementById(`blog-post-${post.id}-title`)?.focus();
  });
  return {
    async load(clientValue, profile) {
      const loadGeneration = ++accessGeneration;
      for (const entry of textEditors.values()) entry.editor.destroy();
      textEditors.clear();
      client = clientValue;
      profileId = profile.id;
      loaded = false;
      posts = [];
      expandedPostId = null;
      savedMediaPaths.clear();
      monthlyPriceInput.value = String(profile.creator_blog_monthly_linden || 0);
      benefitsInput.value = profile.creator_blog_benefits || '';
      paint();
      let { data, error } = await client.rpc('creator_blog_editor_posts_v2', { target_profile: profileId });
      let attachmentSupport = !error;
      if (missingBlogV2Rpc(error)) {
        ({ data, error } = await client.rpc('creator_blog_editor_posts', { target_profile: profileId }));
        attachmentSupport = false;
      }
      if (loadGeneration !== accessGeneration) return;
      if (error || !Array.isArray(data)) throw new Error('Creator blog could not be loaded. Apply migration 14 before using the blog editor.');
      multiAttachments = attachmentSupport;
      posts = data.map(post => ({ ...post, attachments: blogAttachments(post).map(item => ({ ...item, pendingFile: null })) }));
      savedMediaPaths = new Set(posts.flatMap(post => post.attachments.map(item => item.media_path)).filter(Boolean));
      loaded = true;
      expandedPostId = null;
      paint();
    },
    clear() {
      accessGeneration++;
      for (const entry of textEditors.values()) entry.editor.destroy();
      textEditors.clear();
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
      if (posts.some(post => post.attachments.some(item => item.pendingFile)) && !client.storage?.from) throw new Error('Creator blog media storage is unavailable. Try again later.');
      const uploaded = [];
      let committed = false;
      let uncertainSave = false;
      const fields = container.closest('fieldset');
      const activeProfile = profileId;
      const saveGeneration = accessGeneration;
      if (fields) fields.disabled = true;
      try {
        for (const post of posts) {
          for (const attachment of post.attachments.filter(item => item.pendingFile)) {
            const file = attachment.pendingFile;
            let blob = file;
            let mime = file.type;
            let extension = mime === 'audio/mpeg' ? 'mp3' : mime === 'audio/mp4' ? 'm4a' : mime === 'video/mp4' ? 'mp4' : mime === 'video/webm' ? 'webm' : '';
            if (mime.startsWith('image/')) {
              blob = await optimizeGalleryUpload(file);
              mime = 'image/webp';
              extension = 'webp';
            }
            const path = `${activeProfile}/${post.id}/${crypto.randomUUID()}.${extension}`;
            onProgress(`Uploading media for ${post.title}...`);
            const { error } = await client.storage.from(BUCKET).upload(path, blob, { contentType: mime, cacheControl: '31536000', upsert: false });
            if (error) throw new Error('Blog media upload failed. Check your connection and retry.');
            uploaded.push({ attachment, path, oldPath: attachment.media_path || '', oldUrl: attachment.media_url || '' });
            attachment.media_path = path;
            attachment.media_url = '';
          }
        }
        if (!loaded || accessGeneration !== saveGeneration) throw new Error('Account/profile access changed before saving. Refresh access before retrying.');
        onProgress('Saving creator blog...');
        const payload = {
          target_profile: activeProfile,
          monthly_price: value.monthlyPrice,
          benefits: value.benefits,
          posts: posts.map((post, sort_order) => {
            const attachments = validateBlogAttachments(post.attachments, post, multiAttachments ? BLOG_ATTACHMENT_LIMIT : 1);
            const first = attachments[0];
            return {
              id: post.id,
              legacy_id: post.legacy_id || '',
              post_type: post.post_type,
              access_level: post.access_level,
              title: post.title,
              tag: post.tag || '',
              teaser: post.teaser || '',
              body_markdown: post._bodyInput?.value ?? post.body_markdown ?? '',
              media_type: first?.media_type || 'text',
              media_path: first?.media_path || '',
              media_url: first?.media_url || '',
              ...(multiAttachments ? { attachments } : {}),
              is_published: post.is_published === true,
              sort_order
            };
          })
        };
        uncertainSave = true;
        const { error } = await client.rpc(multiAttachments ? 'creator_blog_save_all_v2' : 'creator_blog_save_all', payload);
        uncertainSave = !!error && !/^[0-9A-Z]{5}$/.test(error.code || '');
        if (error) throw new Error('Creator blog could not be saved. Check the price, post fields and subscription access.');
        committed = true;
        if (!loaded || accessGeneration !== saveGeneration) throw new Error('Blog saved, but account/profile access changed. Refresh before editing further.');
        const active = new Set(posts.flatMap(post => post.attachments.map(item => item.media_path)).filter(Boolean));
        const obsolete = [...savedMediaPaths].filter(path => !active.has(path));
        for (const post of posts) {
          post.body_markdown = post._bodyInput?.value ?? post.body_markdown;
          for (const item of post.attachments) item.pendingFile = null;
        }
        savedMediaPaths = active;
        paint();
        if (obsolete.length) {
          const { error: cleanupError } = await client.storage.from(BUCKET).remove(obsolete);
          if (cleanupError) throw new Error('Blog saved, but removed media could not be deleted from storage. Refresh and reconcile storage before retrying.');
        }
      } catch (error) {
        if (committed) throw error;
        if (uncertainSave) {
          loaded = false;
          addButton.disabled = true;
          throw new Error('Blog save status is uncertain. Uploaded files were retained to protect saved posts. Refresh access and reconcile the post before retrying.');
        }
        const newPaths = uploaded.map(item => item.path);
        for (const item of uploaded) {
          item.attachment.media_path = item.oldPath;
          item.attachment.media_url = item.oldUrl;
        }
        if (newPaths.length) {
          const { error: cleanupError } = await client.storage.from(BUCKET).remove(newPaths);
          if (cleanupError) throw new Error('Blog save failed and new uploads could not be removed. Refresh and reconcile storage before retrying.');
        }
        throw error;
      } finally {
        if (fields && loaded && accessGeneration === saveGeneration) fields.disabled = false;
      }
    }
  };
}

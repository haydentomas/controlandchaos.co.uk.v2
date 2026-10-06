export const BLOG_ATTACHMENT_LIMIT = 10;

export function blogAttachments(post) {
  if (Array.isArray(post.attachments)) return post.attachments;
  if (['image', 'audio', 'video'].includes(post.media_type) && (post.media_path || post.media_url || post.pendingFile)) {
    return [{ id: post.id, media_type: post.media_type, media_path: post.media_path || '', media_url: post.media_url || '', pendingFile: post.pendingFile || null }];
  }
  return [];
}

export function missingBlogV2Rpc(error) {
  return error?.code === 'PGRST202' || (error?.code === '42883' && /creator_blog_(editor_posts|feed|save_all)_v2/.test(error.message || ''));
}

export function validateBlogAttachments(items, post, limit = BLOG_ATTACHMENT_LIMIT) {
  if (!Array.isArray(items) || items.length > limit) throw new Error(`Use up to ${limit} attachments per post.`);
  const ids = new Set();
  const paths = new Set();
  return items.map(item => {
    if (!item || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(item.id || '') || ids.has(item.id) || !['image','audio','video'].includes(item.media_type)) {
      throw new Error('Check attachment identifiers and media types.');
    }
    ids.add(item.id);
    const path = item.media_path || '';
    const url = item.media_url || '';
    if (url && (!/^https:\/\/[^\s\\]+$/.test(url) || /^https:\/\/[^/?#]*@/.test(url) || url.length > 2048)) throw new Error('Use a safe HTTPS attachment URL.');
    if (post.access_level === 'subscribers' && url) throw new Error('Subscriber-only media must be uploaded privately, not linked by URL.');
    if (!item.pendingFile && ((!path && !url) || (path && url))) throw new Error('Each attachment needs a private upload or public URL.');
    if (path) {
      const parts = path.split('/');
      const extensions = { image: 'webp', audio: '(mp3|m4a)', video: '(mp4|webm)' };
      if (parts.length !== 3 || parts[1] !== post.id || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(parts[0])
        || !new RegExp(`^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}[.]${extensions[item.media_type]}$`).test(parts[2]) || paths.has(path)) {
        throw new Error('Check private attachment paths and media types.');
      }
      paths.add(path);
    }
    return { id: item.id, media_type: item.media_type, media_path: path, media_url: url };
  });
}

export function renderCreatorBlogMedia(container, post, url, unavailable = 'This post’s media is temporarily unavailable.') {
  const tag = { image: 'img', audio: 'audio', video: 'video' }[post.media_type];
  if (!url || !tag) return;
  const media = document.createElement(tag);
  media.className = `creator-blog-media-${post.media_type}`;
  media.setAttribute('referrerpolicy', 'no-referrer');
  if (tag === 'img') {
    media.alt = post.title;
    media.loading = 'lazy';
  } else {
    media.controls = true;
    media.preload = 'none';
  }
  media.addEventListener('error', () => {
    if (media.parentNode !== container) return;
    const message = document.createElement('p');
    message.className = 'text-muted';
    message.textContent = unavailable;
    container.replaceChildren(message);
  });
  media.src = url;
  container.append(media);
}

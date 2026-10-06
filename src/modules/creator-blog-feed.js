import { publicImageUrl } from './directory-api.js';
import { renderRichText } from './profile-rich-text.js';
import { blogAttachments, renderCreatorBlogMedia } from './creator-blog-media.js';

const BUCKET = 'creator-blog-media';

function element(tag, className = '') {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function readableDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

export async function renderCreatorBlogFeed(container, status, client, profile, offer, posts) {
  container.replaceChildren();
  status.textContent = '';
  const subscriptionActive = offer?.viewer_is_subscribed === true;
  const teaserPosts = [];
  if (Number(offer?.monthly_price_linden) > 0) {
    const membership = element('section', 'creator-blog-membership-banner');
    const membershipCopy = element('div', 'creator-blog-membership-copy');
    const eyebrow = element('span', 'public-booking-eyebrow');
    eyebrow.textContent = subscriptionActive ? 'Active creator pass' : 'Monthly creator pass';
    const membershipTitle = element('h2');
    membershipTitle.textContent = subscriptionActive ? `Subscribed to ${profile.display_name}` : `Unlock ${profile.display_name}'s subscriber posts`;
    const benefits = element('p');
    benefits.textContent = offer.benefits || 'Access all published subscriber-only posts while your monthly pass is active.';
    membershipCopy.append(eyebrow, membershipTitle, benefits);
    const membershipAction = element('div', 'creator-blog-membership-action');
    const price = element('strong');
    price.textContent = `L$${Number(offer.monthly_price_linden).toLocaleString('en-US')} / month`;
    membershipAction.append(price);
    if (!subscriptionActive && offer.terminal_slurl) {
      const subscribe = element('a', 'btn btn-gold btn-sm');
      subscribe.href = offer.terminal_slurl;
      subscribe.textContent = 'Subscribe at the in-world terminal';
      subscribe.setAttribute('aria-label', `Subscribe to ${profile.display_name}'s creator blog`);
      membershipAction.append(subscribe);
      const identity = element('span', 'creator-blog-membership-identity');
      identity.textContent = `Creator UUID: ${offer.creator_avatar_uuid}`;
      membershipAction.append(identity);
    } else if (!subscriptionActive) {
      const unavailable = element('span', 'text-muted');
      unavailable.textContent = 'In-world subscriptions are being configured.';
      membershipAction.append(unavailable);
    }
    membership.append(membershipCopy, membershipAction);
    container.append(membership);
  }
  for (const post of posts) {
    const locked = post.access_level === 'subscribers' && post.is_locked;
    if (locked) teaserPosts.push(post);
    const card = element('article', `creator-blog-card${locked ? ' is-locked' : ''}`);
    const header = element('header', 'creator-blog-card-header');
    const badges = element('div', 'creator-blog-badges');
    const formatBadge = element('span', 'creator-blog-badge');
    formatBadge.textContent = post.post_type === 'live_update' ? 'Live update' : 'Post';
    const accessBadge = element('span', `creator-blog-badge${post.access_level === 'subscribers' ? ' is-exclusive' : ''}`);
    accessBadge.textContent = post.access_level === 'subscribers' ? locked ? 'Locked' : 'Subscriber post' : 'Public';
    badges.append(formatBadge, accessBadge);
    if (post.tag) {
      const tag = element('span', 'creator-blog-post-tag');
      tag.textContent = post.tag;
      badges.append(tag);
    }
    const date = element('time', 'creator-blog-post-date');
    const formattedDate = readableDate(post.published_at);
    if (formattedDate) {
      date.dateTime = post.published_at;
      date.textContent = formattedDate;
    }
    header.append(badges, date);
    const title = element('h2', 'creator-blog-post-title');
    title.textContent = post.title;
    card.append(header, title);
    if (locked) {
      if (post.teaser) {
        const teaser = element('p', 'creator-blog-post-teaser');
        teaser.textContent = post.teaser;
        card.append(teaser);
      }
      const gate = element('div', 'creator-blog-gate');
      const gateTitle = element('strong');
      gateTitle.textContent = 'Subscriber-only post';
      const gateCopy = element('p');
      gateCopy.textContent = offer?.monthly_price_linden > 0
        ? `Subscribe to ${profile.display_name} for L$${Number(offer.monthly_price_linden).toLocaleString('en-US')} per month to unlock this post and their exclusive archive.`
        : 'This post is for subscribers. The creator has not enabled subscriptions yet.';
      gate.append(gateTitle, gateCopy);
      if (offer?.monthly_price_linden > 0 && offer.terminal_slurl) {
        const subscribe = element('a', 'btn btn-gold btn-sm');
        subscribe.href = offer.terminal_slurl;
        subscribe.textContent = `Subscribe in Second Life · L$${Number(offer.monthly_price_linden).toLocaleString('en-US')} / month`;
        subscribe.setAttribute('aria-label', `Subscribe to ${profile.display_name} in Second Life`);
        gate.append(subscribe);
        const identity = element('p', 'creator-blog-payment-identity');
        identity.textContent = `Creator avatar: ${offer.creator_avatar_uuid}`;
        gate.append(identity);
      }
      card.append(gate);
    } else {
      const body = element('div', 'creator-blog-post-body');
      renderRichText(body, post.body_markdown || '');
      card.append(body);
      const attachments = blogAttachments(post);
      if (attachments.length) {
        const mediaContainer = element('div', 'creator-blog-post-media creator-blog-attachment-grid');
        card.append(mediaContainer);
        for (const [index, attachment] of attachments.entries()) {
          let url = attachment.media_url ? publicImageUrl(attachment.media_url) : '';
          if (attachment.media_path) {
            try {
              const { data, error } = await client.storage.from(BUCKET).createSignedUrl(attachment.media_path, 300);
              if (error || !data?.signedUrl) throw new Error('Media unavailable.');
              url = data.signedUrl;
            } catch {
              url = '';
            }
          }
          const title = `${post.title} - attachment ${index + 1}`;
          const tile = element(attachment.media_type === 'image' && url ? 'button' : 'div', 'creator-blog-attachment-tile');
          mediaContainer.append(tile);
          if (!url) {
            const message = element('p', 'text-muted');
            message.textContent = 'This post’s media is temporarily unavailable.';
            tile.append(message);
          } else {
            if (attachment.media_type === 'image') {
              tile.type = 'button';
              tile.setAttribute('aria-label', `View photo: ${title}`);
              Object.assign(tile.dataset, { photo: url, photoTitle: title, photoCategory: '', photoDescription: '' });
            }
            renderCreatorBlogMedia(tile, { ...attachment, title }, url);
          }
        }
      }
    }
    container.append(card);
  }
  if (posts.length === 0) {
    const empty = element('p', 'text-muted');
    empty.textContent = 'No posts have been published yet.';
    container.append(empty);
  }
  if (subscriptionActive && teaserPosts.length === 0) status.textContent = 'Your creator subscription is active.';
}

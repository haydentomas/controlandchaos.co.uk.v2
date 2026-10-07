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

export function creatorPassBenefits(value) {
  return String(value || '').split(/\r?\n/).map(benefit => benefit.trim()).filter(Boolean);
}

export async function renderCreatorBlogFeed(container, status, client, profile, offer, posts) {
  container.replaceChildren();
  status.textContent = '';
  const subscriptionActive = offer?.viewer_is_subscribed === true;
  const passDialog = document.querySelector('[data-creator-pass-dialog]');
  const dialogOpen = () => {
    if (!passDialog) return;
    if (typeof passDialog.showModal === 'function') passDialog.showModal();
    else passDialog.setAttribute('open', '');
  };
  if (passDialog) {
    const benefits = creatorPassBenefits(offer?.benefits);
    const benefitList = passDialog.querySelector('[data-creator-pass-benefits]');
    const benefitSection = passDialog.querySelector('[data-creator-pass-benefits-section]');
    const dialogTitle = passDialog.querySelector('[data-creator-pass-title]');
    const price = passDialog.querySelector('[data-creator-pass-price]');
    const creatorUuid = passDialog.querySelector('[data-creator-pass-uuid]');
    const teleport = passDialog.querySelector('[data-creator-pass-teleport]');
    const terminalStatus = passDialog.querySelector('[data-creator-pass-terminal-status]');
    const copyButton = passDialog.querySelector('[data-creator-pass-copy]');
    const copyStatus = passDialog.querySelector('[data-creator-pass-copy-status]');
    const uuid = String(offer?.creator_avatar_uuid || '');
    dialogTitle.textContent = `Unlock ${profile.display_name}'s Inner Circle`;
    price.textContent = `L$${Number(offer?.monthly_price_linden || 0).toLocaleString('en-US')} / 30 days`;
    creatorUuid.textContent = uuid || 'Creator UUID unavailable';
    benefitList.replaceChildren(...benefits.map(benefit => {
      const item = element('li');
      item.textContent = benefit;
      return item;
    }));
    benefitSection.hidden = benefits.length === 0;
    const terminalUrl = String(offer?.terminal_slurl || '');
    teleport.hidden = !terminalUrl.startsWith('secondlife://');
    teleport.href = teleport.hidden ? '#' : terminalUrl;
    terminalStatus.hidden = !teleport.hidden;
    terminalStatus.textContent = teleport.hidden ? 'The subscriber terminal location is not configured yet.' : '';
    copyButton.disabled = !uuid;
    copyStatus.textContent = '';
    passDialog.querySelector('[data-creator-pass-close]').onclick = () => passDialog.close?.();
    passDialog.onclick = event => { if (event.target === passDialog) passDialog.close?.(); };
    copyButton.onclick = async () => {
      if (!uuid) return;
      try {
        if (globalThis.navigator?.clipboard?.writeText) await globalThis.navigator.clipboard.writeText(uuid);
        else {
          const input = document.createElement('textarea');
          input.value = uuid;
          input.setAttribute('readonly', '');
          input.style.position = 'fixed';
          input.style.opacity = '0';
          document.body.append(input);
          input.select();
          const copied = document.execCommand?.('copy');
          input.remove();
          if (!copied) throw new Error('Clipboard unavailable.');
        }
        copyStatus.textContent = 'Creator UUID copied. Paste it into the terminal after teleporting.';
      } catch {
        copyStatus.textContent = 'Could not copy automatically. Select the UUID above and copy it.';
      }
    };
  }
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
    if (!subscriptionActive) {
      const subscribe = element('button', 'btn btn-gold btn-sm');
      subscribe.type = 'button';
      subscribe.textContent = 'Unlock membership';
      subscribe.setAttribute('aria-label', `Subscribe to ${profile.display_name}'s creator blog`);
      subscribe.addEventListener('click', dialogOpen);
      membershipAction.append(subscribe);
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
      gate.setAttribute('aria-label', 'Locked subscriber content');
      const blurredPreview = element('div', 'creator-blog-gate-blur');
      blurredPreview.setAttribute('aria-hidden', 'true');
      const gateContent = element('div', 'creator-blog-gate-content');
      const lock = element('span', 'creator-blog-gate-lock');
      lock.setAttribute('aria-hidden', 'true');
      lock.textContent = '🔒';
      const gateTitle = element('strong');
      gateTitle.textContent = 'Subscriber exclusive content';
      const gateCopy = element('p');
      gateCopy.textContent = offer?.monthly_price_linden > 0
        ? `This post is for active ${profile.display_name} subscribers.`
        : 'This post is for subscribers. The creator has not enabled subscriptions yet.';
      gateContent.append(lock, gateTitle, gateCopy);
      if (offer?.monthly_price_linden > 0) {
        const subscribe = element('button', 'btn btn-gold btn-sm');
        subscribe.type = 'button';
        subscribe.textContent = `Unlock for L$${Number(offer.monthly_price_linden).toLocaleString('en-US')} / month`;
        subscribe.setAttribute('aria-label', `Subscribe to ${profile.display_name} in Second Life`);
        subscribe.addEventListener('click', dialogOpen);
        gateContent.append(subscribe);
      }
      gate.append(blurredPreview, gateContent);
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

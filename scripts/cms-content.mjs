import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

const root = path.resolve(import.meta.dirname, '..');
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const text = { type: 'string', minLength: 1 };
const publicUrl = { type: 'string', pattern: '^(?:/(?!/)[^\\s]*|https?://[^\\s]+)$' };
const destination = { type: 'string', pattern: '^(?:/(?!/)[^\\s]*|https?://[^\\s]+|secondlife://[^\\s]+)$' };
const link = {
  type: 'object', additionalProperties: false, required: ['label', 'url', 'newTab'],
  properties: { label: text, url: destination, newTab: { type: 'boolean' } }
};
const validateSite = ajv.compile({
  type: 'object', additionalProperties: false,
  required: ['brand', 'logo', 'home', 'fontStylesheet', 'navigation', 'footer'],
  properties: {
    brand: text, logo: publicUrl, home: { const: '/index.html' }, fontStylesheet: { type: 'string', pattern: '^https://fonts\\.googleapis\\.com/' },
    navigation: {
      type: 'object', additionalProperties: false, required: ['inworldUrl', 'inworldLabel', 'links'],
      properties: {
        inworldUrl: destination, inworldLabel: text,
        links: { type: 'array', items: { ...link, required: [...link.required, 'icon'], properties: { ...link.properties, icon: text } } }
      }
    },
    footer: {
      type: 'object', additionalProperties: false, required: ['description', 'copyright', 'columns'],
      properties: {
        description: text, copyright: text,
        columns: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'links'], properties: { title: text, links: { type: 'array', items: link } } } }
      }
    }
  }
});
const calendarDate = { anyOf: [{ const: '' }, { type: 'string', format: 'date-time' }] };
const validateEvent = ajv.compile({
  type: 'object', additionalProperties: false,
  required: ['id', 'title', 'category', 'category_tag', 'date_display', 'location', 'description', 'slurl', 'order', 'published', 'gcal_title', 'gcal_details', 'gcal_location', 'gcal_start', 'gcal_end'],
  properties: {
    id: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
    title: text, category: { enum: ['Tournament', 'Gala', 'Community', 'Workshop', 'Party', 'XP Boost'] },
    category_tag: text, date_display: text, location: text, description: text, slurl: destination,
    order: { type: 'integer', minimum: 0 }, published: { type: 'boolean' },
    gcal_title: { type: 'string' }, gcal_details: { type: 'string' }, gcal_location: { type: 'string' },
    gcal_start: calendarDate, gcal_end: calendarDate
  }
});

const validatePost = ajv.compile({
  type: 'object', additionalProperties: false,
  required: ['id', 'title', 'category', 'date', 'published_at', 'author', 'summary', 'content', 'featured_image', 'published', 'order'],
  properties: {
    id: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }, title: text,
    category: { enum: ['Product Launch', 'Sim Event', 'Economy Update', 'Patch Notes', 'Community'] },
    date: text, published_at: { type: 'string', format: 'date' }, author: text, summary: text, content: text,
    featured_image: { anyOf: [{ const: '' }, publicUrl] }, published: { type: 'boolean' }, order: { type: 'integer', minimum: 0 }
  }
});

export function renderMarkdown(content) {
  return sanitizeHtml(marked.parse(content), {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img'],
    allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, img: ['src', 'alt', 'title', 'width', 'height', 'loading'], code: ['class'] },
    allowedSchemes: ['http', 'https', 'mailto', 'secondlife'],
    allowProtocolRelative: false
  });
}

export function preparePosts(records) {
  const ids = new Set();
  return records.map(input => {
    const post = { featured_image: '', ...input };
    assertValid(validatePost, post, `Blog post ${post.id ?? '(missing ID)'}`);
    if (ids.has(post.id)) throw new Error(`Duplicate blog ID: ${post.id}`);
    ids.add(post.id);
    const bodyHtml = renderMarkdown(post.content);
    const words = sanitizeHtml(bodyHtml, { allowedTags: [], allowedAttributes: {} }).trim().split(/\s+/).filter(Boolean).length;
    const canonical = `https://controlandchaos.co.uk/blog/${post.id}/`;
    const share = new URL('https://twitter.com/intent/tweet');
    share.searchParams.set('text', post.title);
    share.searchParams.set('url', canonical);
    return { ...post, bodyHtml, url: `/blog-${post.id}.html`, canonical, shareUrl: share.href, readMinutes: Math.max(1, Math.ceil(words / 200)) };
  }).filter(post => post.published).sort((first, second) => second.published_at.localeCompare(first.published_at) || first.order - second.order || first.id.localeCompare(second.id));
}

export async function loadPosts() {
  const directory = path.join(root, 'content/blog');
  const files = (await fs.readdir(directory)).filter(filename => filename.endsWith('.json')).sort();
  const records = await Promise.all(files.map(async filename => {
    const post = JSON.parse(await fs.readFile(path.join(directory, filename), 'utf8'));
    if (filename !== `${post.id}.json`) throw new Error(`${filename}: filename must match blog ID`);
    return post;
  }));
  return preparePosts(records);
}

const validateGuide = ajv.compile({
  type: 'object', additionalProperties: false,
  required: ['id', 'title', 'badge', 'icon', 'price', 'marketplace_url', 'pill_text', 'description', 'sections', 'published', 'order', 'listing'],
  properties: {
    id: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }, title: text, badge: text, icon: text, price: text,
    marketplace_url: destination, pill_text: text, description: text, published: { type: 'boolean' }, order: { type: 'integer', minimum: 0 },
    features: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'desc'], properties: { title: text, desc: text } } },
    sections: {
      type: 'array', minItems: 1,
      items: { type: 'object', additionalProperties: false, required: ['title', 'content'], properties: { title: text, content: text, section_id: { type: 'string', pattern: '^([a-z0-9]+(?:-[a-z0-9]+)*)?$' } } }
    },
    chat_commands: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['command', 'role', 'desc'], properties: { command: text, role: text, desc: text } } },
    specs: { type: 'object', additionalProperties: false, properties: Object.fromEntries(['attachment', 'scripts', 'permissions', 'compatibility', 'contents'].map(name => [name, { type: 'string' }])) },
    listing: {
      type: 'object', additionalProperties: false, required: ['title', 'badge', 'description', 'image', 'featured'],
      properties: { title: text, badge: text, description: text, image: publicUrl, featured: { type: 'boolean' } }
    }
  }
});

export function prepareGuides(records) {
  const ids = new Set();
  return records.map(input => {
    const guide = { features: [], chat_commands: [], specs: {}, ...input };
    assertValid(validateGuide, guide, `Guide ${guide.id ?? '(missing ID)'}`);
    if (guide.id === 'template') throw new Error('Guide ID template is reserved for the design sample');
    if (ids.has(guide.id)) throw new Error(`Duplicate guide ID: ${guide.id}`);
    ids.add(guide.id);
    const anchors = new Set(['guide-commands', 'guide-specs']);
    const sections = guide.sections.map((section, index) => {
      const anchor = section.section_id || `section-${index + 1}`;
      if (anchors.has(anchor)) throw new Error(`${guide.id}: duplicate or reserved section anchor ${anchor}`);
      anchors.add(anchor);
      return { ...section, section_id: anchor, bodyHtml: renderMarkdown(section.content) };
    });
    return { ...guide, sections, url: `/guide-${guide.id}.html`, canonical: `https://controlandchaos.co.uk/guides/${guide.id}/` };
  }).filter(guide => guide.published).sort((first, second) => first.order - second.order || first.id.localeCompare(second.id));
}

export async function loadGuides() {
  const directory = path.join(root, 'content/guides');
  const files = (await fs.readdir(directory)).filter(filename => filename.endsWith('.json')).sort();
  const records = await Promise.all(files.map(async filename => {
    const guide = JSON.parse(await fs.readFile(path.join(directory, filename), 'utf8'));
    if (filename !== `${guide.id}.json`) throw new Error(`${filename}: filename must match guide ID`);
    return guide;
  }));
  return prepareGuides(records);
}

function assertValid(validate, data, filename) {
  if (!validate(data)) throw new Error(`${filename}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
  return data;
}

export function validateSiteContent(site) {
  return assertValid(validateSite, site, 'content/site.json');
}

export function prepareEvents(records) {
  const ids = new Set();
  return records.map(input => {
    const record = { gcal_title: '', gcal_details: '', gcal_location: '', gcal_start: '', gcal_end: '', ...input };
    assertValid(validateEvent, record, `Event ${record.id ?? '(missing ID)'}`);
    if (ids.has(record.id)) throw new Error(`Duplicate event ID: ${record.id}`);
    ids.add(record.id);
    if (!!record.gcal_start !== !!record.gcal_end) throw new Error(`${record.id}: calendar start and end must both be supplied`);
    if (record.gcal_start && Date.parse(record.gcal_end) <= Date.parse(record.gcal_start)) throw new Error(`${record.id}: calendar end must follow start`);
    const calendar = new URL('https://calendar.google.com/calendar/render');
    calendar.searchParams.set('action', 'TEMPLATE');
    calendar.searchParams.set('text', record.gcal_title || record.title);
    calendar.searchParams.set('details', record.gcal_details || record.description);
    calendar.searchParams.set('location', record.gcal_location || record.location);
    if (record.gcal_start) {
      const stamp = value => new Date(value).toISOString().replace(/[-:]|\.\d{3}/g, '');
      calendar.searchParams.set('dates', `${stamp(record.gcal_start)}/${stamp(record.gcal_end)}`);
    }
    return { ...record, calendarUrl: calendar.href };
  }).filter(record => record.published).sort((first, second) => first.order - second.order || first.id.localeCompare(second.id));
}

export async function loadEvents() {
  const directory = path.join(root, 'content', 'events');
  const files = (await fs.readdir(directory)).filter(filename => filename.endsWith('.json')).sort();
  const records = await Promise.all(files.map(async filename => {
    const record = JSON.parse(await fs.readFile(path.join(directory, filename), 'utf8'));
    if (filename !== `${record.id}.json`) throw new Error(`${filename}: filename must match event ID`);
    return record;
  }));
  return prepareEvents(records);
}
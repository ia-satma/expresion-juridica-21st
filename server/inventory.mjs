import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { load } from 'cheerio';

export const SITE_DIR = path.resolve(process.cwd(), 'sitio');

const HTML_EXTENSIONS = new Set(['.html', '.htm']);
const CONTENT_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'dt', 'dd',
  'figcaption', 'address', 'blockquote', 'button', 'label', 'summary',
  'title', 'caption', 'legend'
]);
const ATTR_FIELDS = [
  ['a[href]', 'href', 'link'],
  ['area[href]', 'href', 'link'],
  ['img[src]', 'src', 'image'],
  ['img[alt]', 'alt', 'alt'],
  ['source[src]', 'src', 'video'],
  ['source[srcset]', 'srcset', 'video'],
  ['video[src]', 'src', 'video'],
  ['video[poster]', 'poster', 'image'],
  ['audio[src]', 'src', 'audio'],
  ['iframe[src]', 'src', 'embed'],
  ['input[placeholder]', 'placeholder', 'form'],
  ['textarea[placeholder]', 'placeholder', 'form'],
  ['*[aria-label]', 'aria-label', 'accessibility'],
  ['*[title]', 'title', 'accessibility']
];

function walkFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('._') || entry.name === '.DS_Store') continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(absolute));
    else if (HTML_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(absolute);
  }
  return files;
}

export function routeFromFile(file) {
  const relative = path.relative(SITE_DIR, file).split(path.sep).join('/');
  if (relative === 'index.html') return '/';
  if (relative.endsWith('/index.html')) return `/${relative.slice(0, -'/index.html'.length)}/`;
  return `/${relative}`;
}

export function fileForRoute(route) {
  const normalized = decodeURIComponent(route || '/').replace(/\\/g, '/');
  if (!normalized.startsWith('/') || normalized.includes('..')) return null;
  const clean = normalized.replace(/^\/+/, '');
  const candidates = [];
  if (!clean) candidates.push(path.join(SITE_DIR, 'index.html'));
  else if (clean.endsWith('.html')) candidates.push(path.join(SITE_DIR, clean));
  else candidates.push(path.join(SITE_DIR, clean, 'index.html'));
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

function cssPath($, node) {
  const parts = [];
  let current = node;
  while (current && current.type === 'tag') {
    const name = current.name;
    let position = 1;
    let sibling = current.prev;
    while (sibling) {
      if (sibling.type === 'tag' && sibling.name === name) position += 1;
      sibling = sibling.prev;
    }
    parts.unshift(`${name}:nth-of-type(${position})`);
    if (name === 'html') break;
    current = current.parent;
  }
  return parts.join(' > ');
}

function textFromElement($, element) {
  return $(element).text().replace(/\s+/g, ' ').trim();
}

function fieldId(page, selector, attribute) {
  return crypto.createHash('sha1').update(`${page}|${selector}|${attribute}`).digest('hex').slice(0, 16);
}

function fieldLabel(page, element, original, attribute) {
  const tag = element?.name || 'elemento';
  const text = String(original || '').replace(/\s+/g, ' ').trim();
  const short = text.length > 92 ? `${text.slice(0, 89)}…` : text;
  const pageName = page === '/' ? 'Portada' : page.replace(/^\//, '').replace(/\/$/, '') || 'Página';
  if (attribute !== 'html') return `${pageName} · ${tag}[${attribute}]${short ? ` · ${short}` : ''}`;
  return `${pageName} · ${tag} · ${short || 'contenido'}`;
}

function addField(fields, seen, { page, selector, attribute, kind, original, element, section = '' }) {
  const value = original == null ? '' : String(original);
  if (!value.trim()) return;
  const id = fieldId(page, selector, attribute);
  if (seen.has(id)) return;
  seen.add(id);
  fields.push({
    id,
    page,
    selector,
    attribute,
    kind,
    original: value,
    label: fieldLabel(page, element, value, attribute),
    section: section || page,
    searchable: `${page} ${selector} ${attribute} ${value}`.toLowerCase()
  });
}

function sectionFor($, element) {
  const section = $(element).closest('section, main, footer, header, nav').first();
  if (!section.length) return '';
  return section.attr('id') || section.attr('aria-label') || section.find('h1,h2,h3').first().text().trim().slice(0, 80) || section[0]?.name || '';
}

export function inventoryHtml(html, page) {
  const $ = load(html, { decodeEntities: false });
  const fields = [];
  const seen = new Set();

  $('title, h1, h2, h3, h4, h5, h6, p, li, dt, dd, figcaption, address, blockquote, a, button, label, summary, caption, legend').each((_, element) => {
    const tag = element.name;
    const selector = cssPath($, element);
    const text = textFromElement($, element);
    if (!text) return;
    if (tag === 'title') {
      addField(fields, seen, { page, selector, attribute: 'text', kind: 'text', original: text, element, section: 'SEO' });
      return;
    }
    // Interactive controls keep their SVGs/links intact. Their direct label is editable
    // without replacing the control markup.
    const hasInteractiveChild = $(element).find('a, button, svg').length > 0;
    const directText = (element.children || []).filter((child) => child.type === 'text' && String(child.data || '').trim()).map((child) => String(child.data).replace(/\s+/g, ' ').trim()).join(' ').trim();
    if (hasInteractiveChild || (tag === 'a' && $(element).find('svg').length)) {
      if (directText) addField(fields, seen, { page, selector, attribute: 'text', kind: 'text', original: directText, element, section: sectionFor($, element) });
      return;
    }
    // Rich HTML fields keep the existing emphasis and inline marks editable.
    addField(fields, seen, {
      page,
      selector,
      attribute: 'html',
      kind: 'html',
      original: $(element).html() || text,
      element,
      section: sectionFor($, element)
    });
  });

  // Catch short leaf labels that are not covered by the structural tags above.
  $('span, div').each((_, element) => {
    if ($(element).children().length) return;
    const text = textFromElement($, element);
    if (!text || text.length > 180) return;
    const selector = cssPath($, element);
    addField(fields, seen, { page, selector, attribute: 'html', kind: 'html', original: $(element).html() || text, element, section: sectionFor($, element) });
  });

  for (const [selector, attribute, kind] of ATTR_FIELDS) {
    $(selector).each((_, element) => {
      const value = $(element).attr(attribute);
      if (value == null || !String(value).trim()) return;
      addField(fields, seen, {
        page,
        selector: cssPath($, element),
        attribute,
        kind,
        original: value,
        element,
        section: sectionFor($, element)
      });
    });
  }

  $('meta[name="description"], meta[property^="og:"], meta[name^="twitter:"]').each((_, element) => {
    const value = $(element).attr('content');
    if (!value) return;
    addField(fields, seen, { page, selector: cssPath($, element), attribute: 'content', kind: 'meta', original: value, element, section: 'SEO' });
  });

  // Mark every field in the source so the public bridge can apply the same map client-side.
  for (const field of fields) {
    const target = $(field.selector).first();
    if (!target.length) continue;
    target.attr('data-cms-key', field.id);
    target.attr('data-cms-attr', field.attribute);
  }

  return { $, fields };
}

export function buildInventory() {
  const pages = [];
  const fields = [];
  for (const file of walkFiles(SITE_DIR).sort()) {
    const page = routeFromFile(file);
    const html = fs.readFileSync(file, 'utf8');
    const inventory = inventoryHtml(html, page);
    pages.push({ page, file: path.relative(process.cwd(), file).split(path.sep).join('/'), title: inventory.$('title').text().trim() || page, fieldCount: inventory.fields.length });
    fields.push(...inventory.fields);
  }
  return { generatedAt: new Date().toISOString(), pages, fields };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const inventory = buildInventory();
  console.log(JSON.stringify({ generatedAt: inventory.generatedAt, pages: inventory.pages, fieldCount: inventory.fields.length }, null, 2));
}

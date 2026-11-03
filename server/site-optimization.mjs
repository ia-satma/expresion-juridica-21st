import { constants } from 'node:zlib';
import compression from 'compression';
import { BRAND_CONTACT, canonicalBrandEmail, normalizePublicBrandCopy } from './brand-contact.mjs';

const PUBLIC_BASE = 'https://expresion-juridica-21-st.replit.app';
const MIGRATION = '20261103-public-discovery';
export const OPTIMIZATION_VERSION = '20261103';
const privatePath = value => /^\/(?:admin|api)(?:\/|$)/.test(value);
const cleanText = value => String(value || '').replace(/\s+/g, ' ').trim();
const xml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
export function canonicalBase(settings = {}) {
  try { const url = new URL(settings.canonicalBaseUrl || PUBLIC_BASE); return /^https?:$/.test(url.protocol) ? url.origin : PUBLIC_BASE; }
  catch { return PUBLIC_BASE; }
}
export function canonicalPage(value = '/') {
  let page = String(value).split(/[?#]/)[0].replace(/\/index\.html$/, '/');
  if (!page.startsWith('/')) page = `/${page}`;
  if (!page.endsWith('/')) page += '/';
  return page === '/areas/civil-y-mercantil/' ? '/areas/civil/' : page;
}
export function indexablePages(inventory = {}) {
  return [...new Set((inventory.pages || []).map(item => canonicalPage(item.page)).filter(page => !privatePath(page)))];
}
// This is a one-time upgrade of the prelaunch setting. A later owner opt-out
// remains effective because the migration marker lives outside the settings form.
export function enablePublicDiscovery(store, writeStore) {
  if (store.siteOptimizationMigrations?.[MIGRATION]) return false;
  store.settings.indexingEnabled = true;
  store.settings.geo = { ...store.settings.geo, email: canonicalBrandEmail(store.settings.geo?.email || BRAND_CONTACT.email) };
  store.siteOptimizationMigrations = { ...store.siteOptimizationMigrations, [MIGRATION]: new Date().toISOString() };
  writeStore();
  return true;
}

export const publicSiteCompression = compression({
  threshold: 1024,
  brotli: { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } },
  filter(req, res) {
    return ['GET', 'HEAD'].includes(req.method) && !privatePath(req.path) && compression.filter(req, res);
  }
});

function headingText($) {
  const heading = $('h1').first().clone();
  heading.find('[aria-hidden="true"],svg').remove();
  return cleanText(heading.text());
}
function crumbs($, base, canonical, heading) {
  const result = [];
  $('[aria-label="Ruta de navegación"] li').each((_, el) => {
    const item = $(el).clone(); item.find('[aria-hidden="true"],svg').remove();
    const name = cleanText(item.text());
    if (!name) return;
    const href = item.find('a').attr('href');
    result.push({ '@type': 'ListItem', position: result.length + 1, name: href ? name : heading || name, item: href ? new URL(canonicalPage(href), base).href : canonical });
  });
  return result.length > 1 ? { '@type': 'BreadcrumbList', '@id': `${canonical}#breadcrumb`, itemListElement: result } : null;
}
function serviceCatalog(inventory, base, provider) {
  const entries = new Map();
  for (const item of inventory.pages || []) {
    const page = canonicalPage(item.page);
    if (!/^\/areas\/[^/]+\/$/.test(page) || entries.has(page)) continue;
    const name = cleanText(item.title).replace(/\s*\|\s*Expresión Jurídica.*$/i, '');
    entries.set(page, { '@type': 'Offer', itemOffered: { '@type': 'Service', name, serviceType: name, url: `${base}${page}`, provider: { '@id': provider } } });
  }
  return [...entries.values()];
}

export function enhanceSiteDocument($, { page, settings, inventory = {}, preview = false }) {
  const base = canonicalBase(settings), route = canonicalPage(page), canonical = `${base}${route}`;
  const heading = headingText($), title = cleanText($('title').first().text()) || `${heading} | ${settings.siteName}`;
  const description = normalizePublicBrandCopy(cleanText($('meta[name="description"]').first().attr('content') || settings.siteDescription));
  $('html').attr('lang', settings.defaultLocale || 'es-MX');
  $('meta[name="robots"]').remove();
  $('head').append($('<meta>').attr({ name: 'robots', content: preview ? 'noindex,nofollow,noarchive' : settings.indexingEnabled ? 'index,follow,max-image-preview:large' : 'noindex,nofollow' }));
  $('link[rel="canonical"]').remove(); $('head').append($('<link>').attr({ rel: 'canonical', href: canonical }));
  const descriptionMeta = $('meta[name="description"]'); descriptionMeta.slice(1).remove();
  if (descriptionMeta.length) descriptionMeta.first().attr('content', description);
  else $('head').append($('<meta>').attr({ name: 'description', content: description }));
  for (const [key, content] of [['og:url', canonical], ['og:title', title], ['og:description', description], ['og:locale', (settings.defaultLocale || 'es-MX').replace('-', '_')]]) {
    $(`meta[property="${key}"]`).remove(); $('head').append($('<meta>').attr({ property: key, content }));
  }
  const geo = settings.geo || {}, provider = `${base}/#legal-service`, logo = `${base}/marca/logo-original-240.png`;
  const catalog = serviceCatalog(inventory, base, provider);
  const business = {
    '@type': 'LegalService', '@id': provider, name: geo.businessName || settings.siteName,
    url: `${base}/`, description: normalizePublicBrandCopy(settings.siteDescription), logo, image: logo,
    email: canonicalBrandEmail(geo.email || BRAND_CONTACT.email),
    address: { '@type': 'PostalAddress', streetAddress: geo.street, addressLocality: geo.locality, addressRegion: geo.region, addressCountry: geo.country || 'MX' },
    areaServed: [{ '@type': 'City', name: geo.locality || 'Xalapa' }, { '@type': 'Country', name: 'México' }],
    ...(catalog.length ? { hasOfferCatalog: { '@type': 'OfferCatalog', name: 'Áreas de práctica', itemListElement: catalog } } : {})
  };
  if (geo.phone) business.telephone = geo.phone;
  const latitude = Number(geo.latitude), longitude = Number(geo.longitude);
  if (String(geo.latitude ?? '').trim() && String(geo.longitude ?? '').trim() && Number.isFinite(latitude) && Math.abs(latitude) <= 90 && Number.isFinite(longitude) && Math.abs(longitude) <= 180) business.geo = { '@type': 'GeoCoordinates', latitude, longitude };
  const breadcrumb = crumbs($, base, canonical, heading);
  const graph = [business,
    { '@type': 'WebSite', '@id': `${base}/#website`, url: `${base}/`, name: settings.siteName, publisher: { '@id': provider }, inLanguage: settings.defaultLocale || 'es-MX' },
    { '@type': 'WebPage', '@id': `${canonical}#webpage`, url: canonical, name: title, description, inLanguage: settings.defaultLocale || 'es-MX', isPartOf: { '@id': `${base}/#website` }, about: { '@id': provider }, ...(breadcrumb ? { breadcrumb: { '@id': breadcrumb['@id'] } } : {}) }
  ];
  if (breadcrumb) graph.push(breadcrumb);
  if (/^\/areas\/[^/]+\/$/.test(route)) graph.push({ '@type': 'Service', '@id': `${canonical}#service`, url: canonical, name: heading, serviceType: heading, description, provider: { '@id': provider }, areaServed: { '@type': 'Country', name: 'México' }, mainEntityOfPage: { '@id': `${canonical}#webpage` } });
  if (/^\/analisis\/[^/]+\/$/.test(route) && $('article').length) {
    const published = $('main header time[datetime]').first().attr('datetime');
    const image = $('main img').first().attr('src');
    graph.push({ '@type': 'Article', '@id': `${canonical}#article`, headline: heading, description, inLanguage: settings.defaultLocale || 'es-MX', publisher: { '@id': provider }, mainEntityOfPage: { '@id': `${canonical}#webpage` }, ...(published && /^\d{4}-\d{2}-\d{2}/.test(published) ? { datePublished: published } : {}), ...(image ? { image: new URL(image, base).href } : {}) });
  }
  $('script[data-cms-schema="true"],script[data-cms-breadcrumb="true"]').remove();
  $('head').append(`<script type="application/ld+json" data-cms-schema="true">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')}</script>`);
  // Keep the entry motion, but paint the first-screen heading immediately.
  // Opacity/blur on that text delayed LCP, then restarted on client rendering.
  $('style[data-site-performance]').remove();
  $('head').append('<style data-site-performance="20261103">h1.titular .revela>span{opacity:1!important;filter:none!important;animation:ej-heading-settle .45s cubic-bezier(.16,1,.3,1) both!important;animation-delay:0s!important}@keyframes ej-heading-settle{from{transform:translate3d(0,.08em,0)}to{transform:none}}#cms-cookie-banner .cms-cookie-actions button{min-height:44px}#cms-cookie-banner{max-height:calc(100dvh - 2rem);overflow:auto}@media(prefers-reduced-motion:reduce){h1.titular .revela>span{animation:none!important}}@media(max-width:767px){input,select,textarea{font-size:16px}.enlace{overflow-wrap:anywhere}main .grid>*{min-width:0}main a.inline-flex{max-width:100%;white-space:normal;text-align:center}main h1.titular .revela>span{max-width:100%;overflow-wrap:anywhere;hyphens:auto}}</style>');
}

export function optimizationStatus(store, inventory) {
  const settings = store.settings, geo = settings.geo || {}, base = canonicalBase(settings);
  return { checkedAt: new Date().toISOString(), indexingEnabled: Boolean(settings.indexingEnabled), canonicalBaseUrl: base, indexablePages: settings.indexingEnabled ? indexablePages(inventory).length : 0, email: canonicalBrandEmail(geo.email || BRAND_CONTACT.email), locationComplete: ['street', 'locality', 'region', 'country'].every(key => Boolean(cleanText(geo[key]))), searchConsoleConfigured: Boolean(cleanText(settings.searchConsoleVerification)), compression: ['br', 'gzip'], schemaTypes: ['LegalService', 'WebSite', 'WebPage', 'BreadcrumbList', 'Service', 'Article'], links: { robots: `${base}/robots.txt`, sitemap: `${base}/sitemap.xml`, aiGuide: `${base}/llms.txt` } };
}

export function registerSiteOptimizationRoutes(app, { getStore, getInventory, requireAuth }) {
  app.use((req, res, next) => { if (privatePath(req.path)) res.set('X-Robots-Tag', 'noindex, nofollow, noarchive'); next(); });
  app.get('/robots.txt', (_req, res) => {
    const settings = getStore().settings;
    const body = settings.indexingEnabled ? `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\nAllow: /api/cms/public\nDisallow: /*?cms_preview=1\nSitemap: ${canonicalBase(settings)}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n';
    res.set('Cache-Control', 'public, max-age=300').type('text/plain').send(body);
  });
  app.get('/sitemap.xml', (_req, res) => {
    const settings = getStore().settings, base = canonicalBase(settings);
    const urls = settings.indexingEnabled ? indexablePages(getInventory()).map(page => `<url><loc>${xml(base + page)}</loc></url>`).join('') : '';
    res.set('Cache-Control', 'public, max-age=300').type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  });
  app.get('/llms.txt', (_req, res) => {
    const { settings } = getStore(), base = canonicalBase(settings), geo = settings.geo || {};
    const pages = getInventory().pages || [], seen = new Set();
    const links = pages.flatMap(item => { const page = canonicalPage(item.page); if (seen.has(page) || privatePath(page)) return []; seen.add(page); return [`- [${cleanText(item.title)}](${base}${page})`]; });
    const body = [`# ${settings.siteName}`, '', normalizePublicBrandCopy(settings.siteDescription), '', `Canonical: ${base}/`, '', '## Páginas públicas', ...links, '', '## Contacto institucional', `- ${canonicalBrandEmail(geo.email || BRAND_CONTACT.email)}`, `- ${[geo.street, geo.locality, geo.region, geo.country].filter(Boolean).join(', ')}`];
    res.set('Cache-Control', 'public, max-age=300').type('text/plain').send(`${body.join('\n')}\n`);
  });
  app.get('/areas/civil-y-mercantil/', (_req, res) => res.redirect(301, '/areas/civil/'));
  app.get('/api/cms/seo-audit', requireAuth, (_req, res) => res.set('Cache-Control', 'private, no-store').json(optimizationStatus(getStore(), getInventory())));
}

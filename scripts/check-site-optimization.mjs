import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import express from 'express';
import { load } from 'cheerio';
import { buildInventory, fileForRoute, routeFromFile } from '../server/inventory.mjs';
import { enablePublicDiscovery, publicSiteCompression, registerSiteOptimizationRoutes, enhanceSiteDocument, indexablePages } from '../server/site-optimization.mjs';

const root = process.cwd(), inventory = buildInventory();
const store = { settings: { siteName: 'Expresión Jurídica Consultores', siteDescription: 'Asesoría y defensa jurídica especializada para personas, empresas e instituciones.', canonicalBaseUrl: 'https://expresion-juridica-21-st.replit.app', defaultLocale: 'es-MX', indexingEnabled: false, geo: { businessName: 'Expresión Jurídica Consultores', email: 'consultoria@expresionjuridica.com', street: 'Boulevard Europa No. 33, Fracc. Montemagno', locality: 'Xalapa', region: 'Veracruz', country: 'MX' } } };
let writes = 0;
assert(enablePublicDiscovery(store, () => writes++)); assert.equal(writes, 1);
store.settings.indexingEnabled = false;
assert.equal(enablePublicDiscovery(store, () => writes++), false); assert.equal(store.settings.indexingEnabled, false); assert.equal(writes, 1);
store.settings.indexingEnabled = true;
assert(!indexablePages(inventory).includes('/areas/civil-y-mercantil/'));
for (const item of inventory.pages) {
  const file = fileForRoute(item.page); if (!file) continue;
  const $ = load(await fs.readFile(file, 'utf8'));
  const descriptionWasEditable = $('meta[name="description"]').length > 0;
  $('meta[name="description"]').first().attr('data-cms-key', 'description-editor-field');
  enhanceSiteDocument($, { page: item.page, settings: store.settings, inventory });
  assert.equal($('link[rel="canonical"]').length, 1); assert.equal($('meta[name="description"]').length, 1);
  if (descriptionWasEditable) assert.equal($('meta[name="description"]').attr('data-cms-key'), 'description-editor-field');
  assert.match($('meta[name="robots"]').attr('content'), /^index,follow/);
  const graph = JSON.parse($('script[data-cms-schema]').text())['@graph'];
  assert.equal(graph.find(item => item['@type'] === 'LegalService')['@id'], store.settings.canonicalBaseUrl + '/#legal-service');
  assert.equal(graph.find(item => item['@type'] === 'LegalService').email, 'Consultoria@expresionjuridica.com');
  assert.equal(graph.filter(item => item['@type'] === 'WebPage').length, 1);
  if (item.page.includes('juicio-electoral-personas-juzgadoras')) assert.equal(graph.find(item => item['@type'] === 'Article').datePublished, '2025-06-06');
  if (item.page === '/areas/amparo/') { const crumbs = graph.find(item => item['@type'] === 'BreadcrumbList').itemListElement; assert.equal(crumbs.length, 3); assert.equal(crumbs[1].item, store.settings.canonicalBaseUrl + '/areas/'); }
  enhanceSiteDocument($, { page: item.page, settings: store.settings, inventory, preview: true });
  assert.equal($('meta[name="robots"]').attr('content'), 'noindex,nofollow,noarchive');
}
const app = express(); app.use(publicSiteCompression);
const requireAuth = (req, res, next) => req.headers.cookie?.includes('seo_audit_qa=1') ? next() : res.status(401).json({ error: 'AUTH_REQUIRED' });
registerSiteOptimizationRoutes(app, { getStore: () => store, getInventory: () => inventory, requireAuth });
app.get('/api/cms/public', (req, res) => res.json({ page: req.query.path || '/', overrides: {}, settings: store.settings }));
app.get('/__qa/settings', async (_req, res) => {
  const $ = load(await fs.readFile(path.join(root, 'public/admin/index.html'), 'utf8'));
  $('script[src*="app.js"]').remove(); $('.content-view').attr('hidden', '');
  $('#settings-view').removeAttr('hidden').parents().removeAttr('hidden'); $('#auth-view').attr('hidden', '');
  res.set('Set-Cookie', 'seo_audit_qa=1; Path=/; SameSite=Lax').type('html').send($.html());
});
app.get('/api/cms/private-fixture', (_req, res) => res.json({ private: 'x'.repeat(4096) }));
app.get('/range-fixture.mp4', (_req, res) => res.status(206).type('video/mp4').set('Content-Range', 'bytes 0-4095/8000').send(Buffer.alloc(4096, 1)));
app.use('/admin', express.static(path.join(root, 'public/admin')));
app.get('/cms-bridge.js', (_req, res) => res.sendFile(path.join(root, 'public/cms-bridge.js')));
app.use(async (req, res, next) => {
  const file = fileForRoute(req.path); if (!file) return next();
  const $ = load(await fs.readFile(file, 'utf8'));
  enhanceSiteDocument($, { page: routeFromFile(file), settings: store.settings, inventory, preview: req.query.cms_preview === '1' });
  $('body').append('<script src="/cms-bridge.js" defer></script>');
  res.type('html').send($.html());
});
app.use(express.static(path.join(root, 'sitio')));
const server = app.listen(process.env.EJ_SEO_PREVIEW === '1' ? 8796 : 0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
function raw(url, encoding) {
  return new Promise((resolve, reject) => {
    http.get(base + url, { headers: { 'accept-encoding': encoding } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}
try {
  const plain = await raw('/', 'identity'), br = await raw('/', 'br'), gzip = await raw('/', 'gzip');
  assert.equal(br.headers['content-encoding'], 'br'); assert.equal(gzip.headers['content-encoding'], 'gzip');
  assert.deepEqual(brotliDecompressSync(br.bytes), plain.bytes); assert.deepEqual(gunzipSync(gzip.bytes), plain.bytes);
  assert(br.bytes.length < plain.bytes.length * .3); assert(gzip.bytes.length < plain.bytes.length * .3);
  assert.match(br.headers.vary, /Accept-Encoding/);
  const privateResponse = await raw('/api/cms/private-fixture', 'br'); assert.equal(privateResponse.headers['content-encoding'], undefined); assert.match(privateResponse.headers['x-robots-tag'], /noindex/);
  const video = await raw('/range-fixture.mp4', 'br'); assert.equal(video.status, 206); assert.equal(video.bytes.length, 4096); assert.equal(video.headers['content-encoding'], undefined); assert.equal(video.headers['content-range'], 'bytes 0-4095/8000');
  assert.equal((await fetch(base + '/api/cms/seo-audit')).status, 401);
  const status = await (await fetch(base + '/api/cms/seo-audit', { headers: { cookie: 'seo_audit_qa=1' } })).json(); assert(status.indexingEnabled); assert.equal(status.indexablePages, indexablePages(inventory).length);
  const robots = await (await fetch(base + '/robots.txt')).text(); assert.match(robots, /Allow: \/\n/); assert.match(robots, /Disallow: \/admin\//);
  const sitemap = await (await fetch(base + '/sitemap.xml')).text(); assert(!sitemap.includes('civil-y-mercantil')); assert.equal((sitemap.match(/<url>/g) || []).length, status.indexablePages);
  const guide = await (await fetch(base + '/llms.txt')).text(); assert(guide.includes('Consultoria@expresionjuridica.com')); assert(!guide.includes('civil-y-mercantil'));
  assert.equal((await fetch(base + '/areas/civil-y-mercantil/', { redirect: 'manual' })).status, 301);
  store.settings.indexingEnabled = false;
  assert.match(await (await fetch(base + '/robots.txt')).text(), /Disallow: \/\n/); assert(!(await (await fetch(base + '/sitemap.xml')).text()).includes('<url>'));
  store.settings.indexingEnabled = true;
  console.log(JSON.stringify({ passed: true, reviewedPages: inventory.pages.length, canonicalPages: status.indexablePages, bodyBytes: plain.bytes.length, brotliBytes: br.bytes.length, gzipBytes: gzip.bytes.length, ownerIndexingOptOutPreserved: true, privateRoutesProtected: true, videoRangePreserved: true }));
  if (process.env.EJ_SEO_PREVIEW === '1') console.log(`PREVIEW ${base}/ and ${base}/__qa/settings`);
} finally { if (process.env.EJ_SEO_PREVIEW !== '1') server.close(); }

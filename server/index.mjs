import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { buildInventory, fileForRoute, inventoryHtml, routeFromFile, SITE_DIR } from './inventory.mjs';
import { auth, authDatabase, googleAuthEnabled, migrateAuthDatabase } from './auth.mjs';

const ROOT = process.cwd();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(ROOT, 'data');
const MEDIA_DIR = path.join(ROOT, 'storage', 'media');
const ADMIN_DIR = path.join(ROOT, 'public', 'admin');
const STORE_FILE = path.join(DATA_DIR, 'cms.json');
const OWNER_EMAIL = String(process.env.CMS_OWNER_EMAIL || 'ia@satma.mx').trim().toLowerCase();
const GOOGLE_ALLOWED_DOMAIN = String(process.env.CMS_GOOGLE_ALLOWED_DOMAIN || 'satma.mx').trim().toLowerCase().replace(/^@/, '');
const GOOGLE_DEFAULT_ROLE = ['editor', 'viewer'].includes(String(process.env.CMS_GOOGLE_DEFAULT_ROLE || '').toLowerCase()) ? String(process.env.CMS_GOOGLE_DEFAULT_ROLE).toLowerCase() : 'viewer';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const defaultSettings = () => ({
  siteName: 'Expresión Jurídica Consultores',
  siteDescription: 'Asesoría y defensa jurídica especializada para personas, empresas e instituciones.',
  defaultLocale: 'es-MX',
  canonicalBaseUrl: 'https://expresion-juridica-21-st.replit.app',
  indexingEnabled: false,
  searchConsoleVerification: '',
  analytics: {
    enabled: false,
    measurementId: ''
  },
  cookie: {
    version: '1.0',
    title: 'Privacidad y cookies',
    text: 'Usamos cookies necesarias para que el sitio funcione. Con tu permiso, activamos analítica para comprender el uso del sitio.',
    acceptLabel: 'Aceptar analítica',
    rejectLabel: 'Rechazar analítica',
    policyUrl: '/politica-de-cookies/'
  },
  geo: {
    businessName: 'Expresión Jurídica Consultores',
    phone: '',
    email: 'consultoria@expresionjuridica.com',
    street: 'Boulevard Europa No. 33, Fracc. Montemagno',
    locality: 'Xalapa',
    region: 'Veracruz',
    country: 'MX',
    latitude: '',
    longitude: ''
  },
  navigation: {
    visibility: {}
  }
});

const defaultStore = () => ({
  version: 1,
  createdAt: new Date().toISOString(),
  authAdmins: [],
  draftOverrides: {},
  publishedOverrides: {},
  media: [],
  submissions: [],
  revisions: [],
  audit: [],
  settings: defaultSettings()
});

function mergeSettings(input = {}) {
  const defaults = defaultSettings();
  return {
    ...defaults,
    ...input,
    analytics: { ...defaults.analytics, ...(input.analytics || {}) },
    cookie: { ...defaults.cookie, ...(input.cookie || {}) },
    geo: { ...defaults.geo, ...(input.geo || {}) },
    navigation: { ...defaults.navigation, ...(input.navigation || {}) }
  };
}

function readStore() {
  if (!fs.existsSync(STORE_FILE)) return defaultStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    const base = defaultStore();
    return {
      ...base,
      ...parsed,
      authAdmins: Array.isArray(parsed.authAdmins) ? parsed.authAdmins : [],
      settings: mergeSettings(parsed.settings)
    };
  } catch (error) {
    console.error('[cms] No se pudo leer data/cms.json; se usa una copia vacía.', error.message);
    return defaultStore();
  }
}

let store = readStore();
let inventory = buildInventory();

function writeStore() {
  const temp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`);
  fs.renameSync(temp, STORE_FILE);
}

function now() {
  return new Date().toISOString();
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return index === -1 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function cmsAdminFor(session) {
  if (!session?.user?.id) return null;
  return store.authAdmins.find((admin) => admin.userId === session.user.id) || null;
}

function emailKey(email) {
  return String(email || '').trim().toLowerCase();
}

function authRoleForCmsRole(role) {
  return role === 'owner' ? 'admin' : 'user';
}

function googleEmailAllowed(email) {
  const normalized = emailKey(email);
  return Boolean(normalized && normalized.includes('@') && (normalized === OWNER_EMAIL || (GOOGLE_ALLOWED_DOMAIN && normalized.endsWith(`@${GOOGLE_ALLOWED_DOMAIN}`))));
}

function pendingGoogleInvite(email) {
  const normalized = emailKey(email);
  return store.authAdmins.find((admin) => !admin.userId && admin.provider === 'google' && !admin.banned && emailKey(admin.email) === normalized) || null;
}

function cmsAdminRecordForId(id) {
  return store.authAdmins.find((admin) => admin.userId === id || admin.id === id) || null;
}

function hasAuthUsers() {
  try {
    return Boolean(authDatabase.prepare('SELECT id FROM "user" LIMIT 1').get());
  } catch (error) {
    // The migration runs before the first request. Treat an unavailable table
    // as empty so the guarded first-run path can still report a useful state.
    return false;
  }
}

function setupRequired() {
  return store.authAdmins.length === 0 && !hasAuthUsers();
}

function hasGoogleAccount(userId) {
  if (!googleAuthEnabled) return false;
  try {
    return Boolean(authDatabase.prepare('SELECT 1 FROM account WHERE userId = ? AND providerId = ? LIMIT 1').get(userId, 'google'));
  } catch (error) {
    console.error('[cms-auth] no se pudo comprobar la cuenta Google', error.message);
    return false;
  }
}

function syncBetterAuthRole(userId, cmsRole) {
  try {
    authDatabase.prepare('UPDATE "user" SET role = ? WHERE id = ?').run(authRoleForCmsRole(cmsRole), userId);
  } catch (error) {
    console.error('[cms-auth] no se pudo sincronizar el rol Better Auth', error.message);
  }
}

function publicSettings() {
  const { siteName, siteDescription, defaultLocale, canonicalBaseUrl, indexingEnabled, searchConsoleVerification, analytics, cookie, geo, navigation } = store.settings;
  return {
    siteName,
    siteDescription,
    defaultLocale,
    canonicalBaseUrl,
    indexingEnabled: Boolean(indexingEnabled),
    searchConsoleVerification,
    analytics: {
      enabled: Boolean(analytics?.enabled),
      measurementId: String(analytics?.measurementId || '')
    },
    cookie: { ...cookie },
    geo: { ...geo },
    navigation: { visibility: { ...(navigation?.visibility || {}) } }
  };
}

function normalizeSettings(input = {}) {
  const next = mergeSettings(input);
  const text = (value, max = 1000) => String(value ?? '').trim().slice(0, max);
  const baseUrl = text(next.canonicalBaseUrl, 500);
  let canonicalBaseUrl = defaultSettings().canonicalBaseUrl;
  try {
    const parsed = new URL(baseUrl);
    if (['http:', 'https:'].includes(parsed.protocol)) canonicalBaseUrl = parsed.toString().replace(/\/$/, '');
  } catch {
    // Keep the safe production default when an invalid canonical URL is submitted.
  }
  const visibility = {};
  for (const [key, value] of Object.entries(next.navigation?.visibility || {})) {
    const cleanKey = text(key, 220);
    if (cleanKey) visibility[cleanKey] = Boolean(value);
  }
  const measurementId = text(next.analytics?.measurementId, 80).replace(/[^A-Za-z0-9_-]/g, '');
  const verification = text(next.searchConsoleVerification, 120).replace(/[^A-Za-z0-9_-]/g, '');
  return {
    siteName: text(next.siteName, 180) || defaultSettings().siteName,
    siteDescription: text(next.siteDescription, 320),
    defaultLocale: text(next.defaultLocale, 20) || 'es-MX',
    canonicalBaseUrl,
    indexingEnabled: Boolean(next.indexingEnabled),
    searchConsoleVerification: verification,
    analytics: { enabled: Boolean(next.analytics?.enabled), measurementId },
    cookie: {
      version: text(next.cookie?.version, 40) || '1.0',
      title: text(next.cookie?.title, 140),
      text: text(next.cookie?.text, 500),
      acceptLabel: text(next.cookie?.acceptLabel, 80),
      rejectLabel: text(next.cookie?.rejectLabel, 80),
      policyUrl: text(next.cookie?.policyUrl, 500) || '/politica-de-cookies/'
    },
    geo: {
      businessName: text(next.geo?.businessName, 180),
      phone: text(next.geo?.phone, 60),
      email: text(next.geo?.email, 160),
      street: text(next.geo?.street, 180),
      locality: text(next.geo?.locality, 100),
      region: text(next.geo?.region, 100),
      country: text(next.geo?.country, 10),
      latitude: text(next.geo?.latitude, 30),
      longitude: text(next.geo?.longitude, 30)
    },
    navigation: { visibility }
  };
}

async function authSessionFor(req) {
  try {
    return await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  } catch (error) {
    console.error('[cms-auth] session lookup failed', error.message);
    return null;
  }
}

function setCsrfCookie(res) {
  const token = randomToken(24);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `cms_csrf=${encodeURIComponent(token)}; Path=/; SameSite=Lax${secure}`);
  return token;
}

function audit(action, user, detail = {}) {
  store.audit.unshift({
    id: crypto.randomUUID(),
    action,
    actor: user?.email || 'system',
    at: now(),
    detail
  });
  store.audit = store.audit.slice(0, 500);
}

async function requireAuth(req, res, next) {
  const session = await authSessionFor(req);
  const admin = cmsAdminFor(session);
  if (!session?.user || !admin) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  req.cmsUser = session.user;
  req.cmsAdmin = admin;
  req.cmsSession = session;
  next();
}

function requireCmsRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.cmsAdmin?.role)) return res.status(403).json({ error: 'ROLE_REQUIRED', roles });
    next();
  };
}

const requireEditor = requireCmsRole('owner', 'editor');
const requireOwner = requireCmsRole('owner');

function requireCsrf(req, res, next) {
  const csrf = parseCookies(req).cms_csrf;
  if (!csrf || req.get('x-cms-csrf') !== csrf) return res.status(403).json({ error: 'CSRF_INVALID' });
  next();
}

function findField(id) {
  return inventory.fields.find((field) => field.id === id) || null;
}

function sanitizeMarkup(value) {
  return String(value)
    .replace(/<\/?script[^>]*>/gi, '')
    .replace(/<\/?style[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*("|')/gi, '$1=$2#$3');
}

function sanitizeAttribute(attribute, value) {
  const raw = String(value ?? '');
  if (['href', 'src', 'poster', 'data'].includes(attribute) && /^\s*javascript:/i.test(raw)) return '#';
  if (attribute === 'srcset' && /javascript:/i.test(raw)) return raw.replace(/javascript:[^,\s]+/gi, '#');
  return raw;
}

function applyField($, field, value) {
  const target = $(field.selector).first();
  if (!target.length) return;
  if (field.attribute === 'html') target.html(sanitizeMarkup(value));
  else if (field.attribute === 'text') {
    const textNode = target.contents().toArray().find((node) => node.type === 'text' && String(node.data || '').trim());
    if (textNode) textNode.data = String(value);
    else target.text(String(value));
  }
  else target.attr(field.attribute, sanitizeAttribute(field.attribute, value));
}

function injectBridge($) {
  const script = '<script src="/cms-bridge.js" defer data-cms-bridge="true"></script>';
  if ($('script[data-cms-bridge="true"]').length) return;
  if ($('body').length) $('body').append(script);
  else $('html').append(script);
}

function navigationKey($, element) {
  const href = $(element).attr('href');
  if (href) return `href:${href}`;
  const text = $(element).clone().find('svg').remove().end().text().replace(/\s+/g, ' ').trim().toLowerCase();
  return text ? `text:${text}` : '';
}

function applyNavigation($) {
  const visibility = store.settings.navigation?.visibility || {};
  $('header nav a, header nav button, footer nav a').each((_, element) => {
    const key = navigationKey($, element);
    if (!key) return;
    $(element).attr('data-cms-menu-key', key);
    if (Object.prototype.hasOwnProperty.call(visibility, key)) {
      if (visibility[key] === false) $(element).attr('hidden', 'hidden');
      else $(element).removeAttr('hidden');
    }
  });
}

function setMeta($, selector, attributes) {
  $(selector).remove();
  const element = $('<meta>').attr(attributes);
  $('head').append(element);
}

function injectSiteMetadata($, page, preview = false) {
  const settings = store.settings;
  const base = String(settings.canonicalBaseUrl || '').replace(/\/$/, '');
  const canonical = `${base}${page === '/' ? '/' : page}`;
  setMeta($, 'meta[name="robots"]', {
    name: 'robots',
    content: preview ? 'noindex,nofollow,noarchive' : settings.indexingEnabled ? 'index,follow' : 'noindex,nofollow'
  });
  if (settings.searchConsoleVerification) setMeta($, 'meta[name="google-site-verification"]', { name: 'google-site-verification', content: settings.searchConsoleVerification });
  $('link[rel="canonical"]').remove();
  if (base) $('head').append($('<link>').attr({ rel: 'canonical', href: canonical }));
  setMeta($, 'meta[property="og:url"]', { property: 'og:url', content: canonical });
  const geo = settings.geo || {};
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'LegalService',
    name: geo.businessName || settings.siteName,
    url: base,
    description: settings.siteDescription,
    areaServed: { '@type': 'Country', name: 'México' },
    address: {
      '@type': 'PostalAddress',
      streetAddress: geo.street,
      addressLocality: geo.locality,
      addressRegion: geo.region,
      addressCountry: geo.country || 'MX'
    }
  };
  if (geo.email) schema.email = geo.email;
  if (geo.phone) schema.telephone = geo.phone;
  if (geo.latitude && geo.longitude) schema.geo = { '@type': 'GeoCoordinates', latitude: geo.latitude, longitude: geo.longitude };
  $('script[type="application/ld+json"][data-cms-schema="true"]').remove();
  $('head').append(`<script type="application/ld+json" data-cms-schema="true">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>`);
}

function renderHtml(file, preview = false) {
  const raw = fs.readFileSync(file, 'utf8');
  const page = routeFromFile(file);
  const { $, fields } = inventoryHtml(raw, page);
  const overrides = preview ? store.draftOverrides : store.publishedOverrides;
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(overrides, field.id)) applyField($, field, overrides[field.id]);
  }
  injectSiteMetadata($, page, preview);
  applyNavigation($);
  injectBridge($);
  return $.html();
}

function refreshInventory() {
  inventory = buildInventory();
  return inventory;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, MEDIA_DIR),
    filename: (_req, file, cb) => {
      const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'archivo';
      cb(null, `${crypto.randomUUID()}-${safeName}`);
    }
  }),
  limits: { fileSize: 250 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /^(image|video|audio|application\/pdf|font\/|application\/octet-stream)/i.test(file.mimetype);
    cb(allowed ? null : new Error('MEDIA_TYPE_NOT_ALLOWED'), allowed);
  }
});

function cleanMediaFolder(value) {
  const folder = String(value || 'General').trim().replace(/[\\/]+/g, ' · ').replace(/[^\p{L}\p{N} .·_-]+/gu, '').slice(0, 80);
  return folder || 'General';
}

const app = express();
app.disable('x-powered-by');

// Better Auth must receive the raw request stream before Express body parsers.
// Express 5 uses the `*splat` catch-all syntax documented by Better Auth.
app.all('/api/auth/sign-up/email', (req, res, next) => {
  if (!setupRequired()) return res.status(403).json({ error: 'SIGNUP_DISABLED' });
  return toNodeHandler(auth)(req, res, next);
});
app.all('/api/auth/*splat', toNodeHandler(auth));

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

app.post('/api/public/contact', (req, res) => {
  const body = req.body || {};
  if (String(body.website || '').trim()) return res.status(400).json({ error: 'INVALID_REQUEST' });
  const name = String(body.nombre || '').trim().slice(0, 160);
  const email = String(body.correo || '').trim().toLowerCase().slice(0, 254);
  const subject = String(body.materia || '').trim().slice(0, 100);
  const message = String(body.mensaje || '').trim().slice(0, 600);
  const consent = Boolean(body.privacidad);
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || !subject || !message || !consent) return res.status(422).json({ error: 'CONTACT_FIELDS_INVALID' });
  const item = {
    id: crypto.randomUUID(),
    name,
    email,
    subject,
    message,
    consentAt: now(),
    status: 'new',
    createdAt: now(),
    source: String(body.source || '/contacto/').slice(0, 200),
    userAgent: String(req.get('user-agent') || '').slice(0, 300)
  };
  store.submissions.unshift(item);
  store.submissions = store.submissions.slice(0, 2000);
  writeStore();
  res.status(201).json({ ok: true, id: item.id, message: 'Solicitud recibida. Nos pondremos en contacto pronto.' });
});

app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'expresion-juridica-cms', inventory: inventory.pages.length }));

app.get('/api/cms/auth-options', (_req, res) => {
  res.set('Cache-Control', 'no-store').json({ google: googleAuthEnabled });
});

app.get('/api/cms/auth-state', async (req, res) => {
  const session = await authSessionFor(req);
  if (!session?.user) return res.json({ authenticated: false, setupRequired: setupRequired() });
  let admin = cmsAdminFor(session);
  if (!admin && store.authAdmins.length === 0) {
    if (String(session.user.email || '').toLowerCase() !== OWNER_EMAIL) return res.status(403).json({ error: 'OWNER_EMAIL_REQUIRED' });
    admin = { id: crypto.randomUUID(), userId: session.user.id, email: session.user.email, role: 'owner', provider: hasGoogleAccount(session.user.id) ? 'google' : 'password', createdAt: now() };
    store.authAdmins.push(admin);
    syncBetterAuthRole(session.user.id, admin.role);
    audit('auth.bootstrap', session.user);
    writeStore();
  }
  if (!admin && hasGoogleAccount(session.user.id)) {
    const invite = pendingGoogleInvite(session.user.email);
    if (invite) {
      invite.userId = session.user.id;
      invite.pending = false;
      invite.updatedAt = now();
      admin = invite;
      syncBetterAuthRole(session.user.id, admin.role);
      audit('auth.google.invite.accept', session.user, { role: admin.role });
      writeStore();
    }
  }
  if (!admin && store.authAdmins.length && hasGoogleAccount(session.user.id) && googleEmailAllowed(session.user.email)) {
    admin = { id: crypto.randomUUID(), userId: session.user.id, email: session.user.email, role: session.user.email.toLowerCase() === OWNER_EMAIL ? 'owner' : GOOGLE_DEFAULT_ROLE, provider: 'google', createdAt: now() };
    store.authAdmins.push(admin);
    syncBetterAuthRole(session.user.id, admin.role);
    audit('auth.google.bootstrap', session.user, { role: admin.role, domain: GOOGLE_ALLOWED_DOMAIN });
    writeStore();
  }
  if (!admin) return res.status(403).json({ error: 'CMS_ACCESS_NOT_GRANTED' });
  syncBetterAuthRole(session.user.id, admin.role);
  const csrf = setCsrfCookie(res);
  res.json({ authenticated: true, setupRequired: false, csrf, user: { ...session.user, role: admin.role } });
});

app.get('/api/cms/summary', requireAuth, (_req, res) => {
  const draftCount = Object.keys(store.draftOverrides).length;
  const publishedCount = Object.keys(store.publishedOverrides).length;
  res.json({
    siteName: store.settings.siteName,
    pages: inventory.pages.length,
    fields: inventory.fields.length,
    draftFields: draftCount,
    publishedFields: publishedCount,
    media: store.media.filter((item) => !item.deletedAt).length,
    submissions: store.submissions.filter((item) => item.status === 'new').length,
    revisions: store.revisions.length,
    auditEvents: store.audit.length,
    lastPublishedAt: store.revisions[0]?.at || null,
    inventoryGeneratedAt: inventory.generatedAt
  });
});

app.get('/api/cms/settings', requireAuth, (_req, res) => {
  res.json({ settings: store.settings, editable: _req.cmsAdmin.role === 'owner' });
});

app.put('/api/cms/settings', requireAuth, requireOwner, requireCsrf, (req, res) => {
  const input = req.body?.settings || req.body || {};
  store.settings = normalizeSettings({
    ...store.settings,
    ...input,
    analytics: { ...store.settings.analytics, ...(input.analytics || {}) },
    cookie: { ...store.settings.cookie, ...(input.cookie || {}) },
    geo: { ...store.settings.geo, ...(input.geo || {}) },
    navigation: { ...store.settings.navigation, ...(input.navigation || {}) }
  });
  audit('settings.update', req.cmsUser, { indexingEnabled: store.settings.indexingEnabled, analyticsEnabled: store.settings.analytics.enabled });
  writeStore();
  res.json({ ok: true, settings: store.settings });
});

app.get('/api/cms/pages', requireAuth, (_req, res) => {
  const pages = inventory.pages.map((page) => {
    const pageFields = inventory.fields.filter((field) => field.page === page.page);
    const draft = pageFields.filter((field) => Object.prototype.hasOwnProperty.call(store.draftOverrides, field.id)).length;
    const published = pageFields.filter((field) => Object.prototype.hasOwnProperty.call(store.publishedOverrides, field.id)).length;
    return { ...page, draftFields: draft, publishedFields: published };
  });
  res.json({ pages });
});

app.get('/api/cms/fields', requireAuth, (req, res) => {
  const page = req.query.page ? String(req.query.page) : '';
  const search = String(req.query.search || '').trim().toLowerCase();
  const kind = String(req.query.kind || '').trim();
  const section = String(req.query.section || '').trim().toLowerCase();
  const offset = Math.max(0, Number(req.query.offset || 0));
  const limit = Math.min(2000, Math.max(1, Number(req.query.limit || 500)));
  const fields = inventory.fields.filter((field) => {
    if (page && field.page !== page) return false;
    if (kind && field.kind !== kind) return false;
    if (section && !field.section.toLowerCase().includes(section)) return false;
    if (search && !field.searchable.includes(search)) return false;
    return true;
  });
  res.json({
    total: fields.length,
    fields: fields.slice(offset, offset + limit).map((field) => ({
      ...field,
      draftValue: Object.prototype.hasOwnProperty.call(store.draftOverrides, field.id) ? store.draftOverrides[field.id] : null,
      publishedValue: Object.prototype.hasOwnProperty.call(store.publishedOverrides, field.id) ? store.publishedOverrides[field.id] : null
    }))
  });
});

app.get('/api/cms/public', (req, res) => {
  const page = String(req.query.path || '/');
  authSessionFor(req).then((session) => {
    const preview = String(req.query.preview || '') === '1' && Boolean(cmsAdminFor(session));
    const overrides = preview ? store.draftOverrides : store.publishedOverrides;
    const map = {};
    for (const field of inventory.fields) {
      if (field.page !== page || !Object.prototype.hasOwnProperty.call(overrides, field.id)) continue;
      map[field.id] = field.attribute === 'html' ? sanitizeMarkup(overrides[field.id]) : sanitizeAttribute(field.attribute, overrides[field.id]);
    }
    res.set('Cache-Control', 'no-store').json({ page, preview, overrides: map, settings: publicSettings() });
  }).catch(() => res.status(500).json({ error: 'AUTH_STATE_ERROR' }));
});

app.post('/api/cms/fields/:id', requireAuth, requireEditor, requireCsrf, (req, res) => {
  const field = findField(req.params.id);
  if (!field) return res.status(404).json({ error: 'FIELD_NOT_FOUND' });
  if (!Object.prototype.hasOwnProperty.call(req.body, 'value')) return res.status(400).json({ error: 'VALUE_REQUIRED' });
  const value = req.body.value == null ? null : String(req.body.value);
  if (value != null && value.length > 100000) return res.status(413).json({ error: 'VALUE_TOO_LARGE' });
  if (value == null || value === field.original) delete store.draftOverrides[field.id];
  else store.draftOverrides[field.id] = value;
  audit('content.draft.update', req.cmsUser, { fieldId: field.id, page: field.page, kind: field.kind });
  writeStore();
  res.json({ ok: true, fieldId: field.id, draftValue: store.draftOverrides[field.id] ?? null });
});

app.post('/api/cms/publish', requireAuth, requireEditor, requireCsrf, (req, res) => {
  const changed = Object.keys(store.draftOverrides).length;
  store.publishedOverrides = { ...store.draftOverrides };
  store.revisions.unshift({
    id: crypto.randomUUID(),
    at: now(),
    actor: req.cmsUser.email,
    fields: store.publishedOverrides,
    changed
  });
  store.revisions = store.revisions.slice(0, 50);
  audit('content.publish', req.cmsUser, { changed });
  writeStore();
  res.json({ ok: true, changed, publishedAt: store.revisions[0].at });
});

app.get('/api/cms/revisions', requireAuth, (_req, res) => {
  res.json({ revisions: store.revisions.map(({ fields, ...revision }) => ({ ...revision, fieldCount: Object.keys(fields || {}).length })) });
});

app.post('/api/cms/revisions/:id/restore', requireAuth, requireEditor, requireCsrf, (req, res) => {
  const revision = store.revisions.find((candidate) => candidate.id === req.params.id);
  if (!revision) return res.status(404).json({ error: 'REVISION_NOT_FOUND' });
  store.draftOverrides = { ...(revision.fields || {}) };
  audit('content.revision.restore', req.cmsUser, { revisionId: revision.id });
  writeStore();
  res.json({ ok: true, draftFields: Object.keys(store.draftOverrides).length });
});

app.post('/api/cms/inventory/refresh', requireAuth, requireEditor, requireCsrf, (_req, res) => {
  refreshInventory();
  audit('content.inventory.refresh', _req.cmsUser, { pages: inventory.pages.length, fields: inventory.fields.length });
  writeStore();
  res.json({ ok: true, generatedAt: inventory.generatedAt, pages: inventory.pages.length, fields: inventory.fields.length });
});

app.get('/api/cms/media', requireAuth, (req, res) => {
  const folder = String(req.query.folder || '').trim();
  const search = String(req.query.search || '').trim().toLowerCase();
  const media = store.media.filter((item) => !item.deletedAt && (!folder || item.folder === folder) && (!search || `${item.originalName} ${item.caption || ''} ${item.alt || ''}`.toLowerCase().includes(search))).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const folders = Object.entries(store.media.filter((item) => !item.deletedAt).reduce((map, item) => { const key = item.folder || 'General'; map[key] = (map[key] || 0) + 1; return map; }, {})).sort(([a], [b]) => a.localeCompare(b, 'es'));
  res.json({ media, folders: folders.map(([name, count]) => ({ name, count })) });
});

app.post('/api/cms/media', requireAuth, requireEditor, requireCsrf, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'FILE_REQUIRED' });
  const item = {
    id: crypto.randomUUID(),
    url: `/cms-media/${encodeURIComponent(req.file.filename)}`,
    filename: req.file.filename,
    originalName: req.file.originalname,
    mime: req.file.mimetype,
    size: req.file.size,
    folder: cleanMediaFolder(req.body?.folder),
    alt: String(req.body?.alt || '').trim().slice(0, 300),
    caption: String(req.body?.caption || '').trim().slice(0, 500),
    createdAt: now(),
    uploadedBy: req.cmsUser.email
  };
  store.media.push(item);
  audit('media.upload', req.cmsUser, { mediaId: item.id, name: item.originalName, size: item.size });
  writeStore();
  res.status(201).json({ media: item });
});

app.patch('/api/cms/media/:id', requireAuth, requireEditor, requireCsrf, (req, res) => {
  const item = store.media.find((candidate) => candidate.id === req.params.id && !candidate.deletedAt);
  if (!item) return res.status(404).json({ error: 'MEDIA_NOT_FOUND' });
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'folder')) item.folder = cleanMediaFolder(req.body.folder);
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'alt')) item.alt = String(req.body.alt || '').trim().slice(0, 300);
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'caption')) item.caption = String(req.body.caption || '').trim().slice(0, 500);
  audit('media.update', req.cmsUser, { mediaId: item.id, folder: item.folder });
  writeStore();
  res.json({ ok: true, media: item });
});

app.delete('/api/cms/media/:id', requireAuth, requireEditor, requireCsrf, (req, res) => {
  const item = store.media.find((candidate) => candidate.id === req.params.id && !candidate.deletedAt);
  if (!item) return res.status(404).json({ error: 'MEDIA_NOT_FOUND' });
  item.deletedAt = now();
  audit('media.archive', req.cmsUser, { mediaId: item.id });
  writeStore();
  res.status(204).end();
});

app.get('/api/cms/activity', requireAuth, (_req, res) => {
  res.json({ activity: store.audit.slice(0, 100) });
});

app.get('/api/cms/submissions', requireAuth, (req, res) => {
  const status = String(req.query.status || '').trim();
  const submissions = store.submissions.filter((item) => !status || item.status === status).map(({ userAgent, ...item }) => item);
  res.json({ submissions, counts: store.submissions.reduce((map, item) => { map[item.status] = (map[item.status] || 0) + 1; return map; }, {}) });
});

app.patch('/api/cms/submissions/:id', requireAuth, requireEditor, requireCsrf, (req, res) => {
  const item = store.submissions.find((candidate) => candidate.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'SUBMISSION_NOT_FOUND' });
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'status') && ['new', 'in_progress', 'resolved', 'archived'].includes(req.body.status)) item.status = req.body.status;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'notes')) item.notes = String(req.body.notes || '').slice(0, 2000);
  item.updatedAt = now();
  audit('submission.update', req.cmsUser, { submissionId: item.id, status: item.status });
  writeStore();
  res.json({ ok: true, submission: item });
});

function cmsRoleForUser(user) {
  return store.authAdmins.find((admin) => admin.userId === user.id)?.role || null;
}

function userPayload(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: cmsRoleForUser(user),
    authRole: user.role || 'user',
    banned: Boolean(user.banned),
    banReason: user.banReason || '',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

app.get('/api/cms/users', requireAuth, requireOwner, async (req, res, next) => {
  try {
    const result = await auth.api.listUsers({
      query: { limit: 100, offset: 0, sortBy: 'createdAt', sortDirection: 'desc' },
      headers: fromNodeHeaders(req.headers)
    });
    const users = (result?.users || []).filter((user) => cmsRoleForUser(user)).map(userPayload);
    const pendingInvites = store.authAdmins
      .filter((admin) => !admin.userId && admin.provider === 'google')
      .map((admin) => ({
        id: admin.id,
        name: admin.name || admin.email,
        email: admin.email,
        role: admin.role,
        authRole: 'pending',
        banned: Boolean(admin.banned),
        banReason: admin.banReason || '',
        pending: true,
        provider: 'google',
        createdAt: admin.createdAt,
        updatedAt: admin.updatedAt || admin.createdAt
      }));
    res.json({ users: [...users, ...pendingInvites], total: users.length + pendingInvites.length });
  } catch (error) {
    next(error);
  }
});

app.post('/api/cms/users', requireAuth, requireOwner, requireCsrf, async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim();
    const password = String(req.body?.password || '');
    const role = ['owner', 'editor', 'viewer'].includes(req.body?.role) ? req.body.role : 'editor';
    const authMethod = req.body?.authMethod === 'google' ? 'google' : 'password';
    if (!email || !name || !/^\S+@\S+\.\S+$/.test(email) || (authMethod === 'password' && password.length < 8)) return res.status(400).json({ error: 'USER_FIELDS_INVALID' });
    const existingCmsAccess = store.authAdmins.find((admin) => emailKey(admin.email) === email && !admin.banned);
    if (existingCmsAccess) return res.status(409).json({ error: 'USER_ALREADY_AUTHORIZED' });
    if (authMethod === 'google') {
      const invite = { id: crypto.randomUUID(), userId: null, email, name, role, provider: 'google', pending: true, banned: false, createdAt: now() };
      store.authAdmins.push(invite);
      audit('auth.google.invite', req.cmsUser, { email, role });
      writeStore();
      return res.status(201).json({ user: { id: invite.id, name, email, role, authRole: 'pending', pending: true, provider: 'google', banned: false, createdAt: invite.createdAt } });
    }
    const result = await auth.api.createUser({
      body: { email, name, password, role: authRoleForCmsRole(role) },
      headers: fromNodeHeaders(req.headers)
    });
    const user = result?.user || result;
    if (!user?.id) return res.status(500).json({ error: 'USER_CREATE_FAILED' });
    store.authAdmins.push({ id: crypto.randomUUID(), userId: user.id, email: user.email, name: user.name, role, provider: 'password', createdAt: now() });
    syncBetterAuthRole(user.id, role);
    audit('auth.user.create', req.cmsUser, { userId: user.id, email: user.email, role });
    writeStore();
    res.status(201).json({ user: userPayload({ ...user, role: authRoleForCmsRole(role) }) });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/cms/users/:id/role', requireAuth, requireOwner, requireCsrf, async (req, res, next) => {
  try {
    const target = cmsAdminRecordForId(req.params.id);
    const role = String(req.body?.role || '');
    if (!target || !['owner', 'editor', 'viewer'].includes(role)) return res.status(400).json({ error: 'ROLE_INVALID' });
    if (target.role === 'owner' && role !== 'owner' && store.authAdmins.filter((admin) => admin.role === 'owner' && !admin.banned).length < 2) {
      return res.status(409).json({ error: 'LAST_OWNER' });
    }
    const result = target.userId ? await auth.api.setRole({
      body: { userId: target.userId, role: authRoleForCmsRole(role) },
      headers: fromNodeHeaders(req.headers)
    }) : null;
    target.role = role;
    target.updatedAt = now();
    if (target.userId) syncBetterAuthRole(target.userId, role);
    audit('auth.user.role', req.cmsUser, { userId: target.userId || target.id, role });
    writeStore();
    if (!target.userId) return res.json({ user: { id: target.id, name: target.name || target.email, email: target.email, role, authRole: 'pending', pending: true, provider: 'google', banned: Boolean(target.banned), createdAt: target.createdAt, updatedAt: target.updatedAt } });
    const user = result?.user || result;
    res.json({ user: userPayload({ ...user, role: authRoleForCmsRole(role) }) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/cms/users/:id/status', requireAuth, requireOwner, requireCsrf, async (req, res, next) => {
  try {
    const target = cmsAdminRecordForId(req.params.id);
    const disabled = Boolean(req.body?.disabled);
    if (!target) return res.status(404).json({ error: 'USER_NOT_FOUND' });
    if (target.role === 'owner') return res.status(409).json({ error: 'OWNER_CANNOT_BE_DISABLED' });
    const result = target.userId ? (disabled
      ? await auth.api.banUser({ body: { userId: target.userId, banReason: 'Acceso revocado desde el CMS' }, headers: fromNodeHeaders(req.headers) })
      : await auth.api.unbanUser({ body: { userId: target.userId }, headers: fromNodeHeaders(req.headers) })) : null;
    target.banned = disabled;
    target.banReason = disabled ? 'Acceso revocado desde el CMS' : '';
    target.updatedAt = now();
    audit(disabled ? 'auth.user.disable' : 'auth.user.enable', req.cmsUser, { userId: target.userId || target.id });
    writeStore();
    if (!target.userId) return res.json({ user: { id: target.id, name: target.name || target.email, email: target.email, role: target.role, authRole: 'pending', pending: true, provider: 'google', banned: target.banned, createdAt: target.createdAt, updatedAt: target.updatedAt } });
    const user = result?.user || result;
    res.json({ user: userPayload({ ...user, role: authRoleForCmsRole(target.role) }) });
  } catch (error) {
    next(error);
  }
});

function absoluteSiteUrl(route = '/') {
  const base = String(store.settings.canonicalBaseUrl || '').replace(/\/$/, '');
  return `${base}${route === '/' ? '/' : route}`;
}

app.get('/robots.txt', (_req, res) => {
  const body = store.settings.indexingEnabled
    ? `User-agent: *\nAllow: /\nSitemap: ${absoluteSiteUrl('/sitemap.xml')}\n`
    : 'User-agent: *\nDisallow: /\n';
  res.type('text/plain').send(body);
});

app.get('/sitemap.xml', (_req, res) => {
  const urls = store.settings.indexingEnabled ? inventory.pages.map((page) => `<url><loc>${absoluteSiteUrl(page.page)}</loc></url>`).join('') : '';
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
});

app.get('/llms.txt', (_req, res) => {
  const lines = [
    `# ${store.settings.siteName}`,
    '',
    store.settings.siteDescription,
    '',
    '## Páginas',
    ...inventory.pages.map((page) => `- [${page.title}](${absoluteSiteUrl(page.page)})`),
    '',
    '## Contacto',
    `- ${store.settings.geo?.email || ''}`,
    `- ${store.settings.geo?.street || ''}, ${store.settings.geo?.locality || ''}, ${store.settings.geo?.region || ''}`
  ];
  res.type('text/plain').send(`${lines.join('\n')}\n`);
});

// The CMS is intentionally in front of the static export: HTML receives published overrides
// server-side, while every non-HTML asset remains byte-for-byte the Replit build.
app.use(async (req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method) || req.path.startsWith('/api/') || req.path === '/healthz' || req.path.startsWith('/admin') || req.path.startsWith('/cms-media') || req.path === '/cms-bridge.js') return next();
  const file = fileForRoute(req.path);
  if (!file) return next();
  try {
    const preview = req.query.cms_preview === '1' && Boolean(cmsAdminFor(await authSessionFor(req)));
    res.set('Cache-Control', 'no-store');
    if (preview) res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.type('html').send(renderHtml(file, preview));
  } catch (error) {
    next(error);
  }
});

app.get('/cms-bridge.js', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'cms-bridge.js')));
app.use('/cms-media', express.static(MEDIA_DIR, { fallthrough: false, maxAge: '1h' }));
app.use('/admin', express.static(ADMIN_DIR, { index: 'index.html', maxAge: 0 }));
app.use(express.static(SITE_DIR, { index: false, maxAge: '1h' }));

app.use((error, _req, res, _next) => {
  const status = error?.message === 'MEDIA_TYPE_NOT_ALLOWED' ? 415 : error?.code === 'LIMIT_FILE_SIZE' ? 413 : 500;
  console.error('[cms]', error);
  if (res.headersSent) return;
  res.status(status).json({ error: status === 500 ? 'INTERNAL_ERROR' : error.message });
});

async function start() {
  await migrateAuthDatabase();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[cms] Expresión Jurídica CMS en http://localhost:${PORT}`);
    console.log(`[cms] ${inventory.pages.length} páginas · ${inventory.fields.length} campos editables`);
    if (setupRequired()) console.log('[cms] Primer arranque: el acceso inicial está protegido para la cuenta propietaria.');
  });
}

start().catch((error) => {
  console.error('[cms] No se pudo iniciar la autenticación Better Auth', error);
  process.exitCode = 1;
});

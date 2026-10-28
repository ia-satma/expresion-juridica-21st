import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { buildInventory, fileForRoute, inventoryHtml, routeFromFile, SITE_DIR } from './inventory.mjs';
import { auth, migrateAuthDatabase } from './auth.mjs';

const ROOT = process.cwd();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(ROOT, 'data');
const MEDIA_DIR = path.join(ROOT, 'storage', 'media');
const ADMIN_DIR = path.join(ROOT, 'public', 'admin');
const STORE_FILE = path.join(DATA_DIR, 'cms.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const defaultStore = () => ({
  version: 1,
  createdAt: new Date().toISOString(),
  users: [],
  authAdmins: [],
  draftOverrides: {},
  publishedOverrides: {},
  media: [],
  revisions: [],
  audit: [],
  settings: {
    siteName: 'Expresión Jurídica Consultores',
    defaultLocale: 'es-MX',
    noindex: true
  }
});

function readStore() {
  if (!fs.existsSync(STORE_FILE)) return defaultStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    return { ...defaultStore(), ...parsed, authAdmins: Array.isArray(parsed.authAdmins) ? parsed.authAdmins : [] };
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

function applyField($, field, value) {
  const target = $(field.selector).first();
  if (!target.length) return;
  if (field.attribute === 'html') target.html(sanitizeMarkup(value));
  else if (field.attribute === 'text') target.text(String(value));
  else target.attr(field.attribute, String(value));
}

function injectBridge($) {
  const script = '<script src="/cms-bridge.js" defer data-cms-bridge="true"></script>';
  if ($('script[data-cms-bridge="true"]').length) return;
  if ($('body').length) $('body').append(script);
  else $('html').append(script);
}

function renderHtml(file, preview = false) {
  const raw = fs.readFileSync(file, 'utf8');
  const page = routeFromFile(file);
  const { $, fields } = inventoryHtml(raw, page);
  const overrides = preview ? store.draftOverrides : store.publishedOverrides;
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(overrides, field.id)) applyField($, field, overrides[field.id]);
  }
  injectBridge($);
  if (preview) {
    $('head').prepend('<meta name="robots" content="noindex,nofollow,noarchive" data-cms-preview="true">');
  }
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

const app = express();
app.disable('x-powered-by');

// Better Auth must receive the raw request stream before Express body parsers.
// Express 5 uses the `*splat` catch-all syntax documented by Better Auth.
app.all('/api/auth/sign-up/email', (req, res, next) => {
  if (store.authAdmins.length) return res.status(403).json({ error: 'SIGNUP_DISABLED' });
  return toNodeHandler(auth)(req, res, next);
});
app.all('/api/auth/*splat', toNodeHandler(auth));

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'expresion-juridica-cms', inventory: inventory.pages.length }));

app.get('/api/cms/auth-state', async (req, res) => {
  const session = await authSessionFor(req);
  if (!session?.user) return res.json({ authenticated: false, setupRequired: store.authAdmins.length === 0 });
  let admin = cmsAdminFor(session);
  if (!admin && store.authAdmins.length === 0) {
    admin = { userId: session.user.id, email: session.user.email, role: 'owner', createdAt: now() };
    store.authAdmins.push(admin);
    audit('auth.bootstrap', session.user);
    writeStore();
  }
  if (!admin) return res.status(403).json({ error: 'CMS_ACCESS_NOT_GRANTED' });
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
    revisions: store.revisions.length,
    auditEvents: store.audit.length,
    lastPublishedAt: store.revisions[0]?.at || null,
    inventoryGeneratedAt: inventory.generatedAt
  });
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
      map[field.id] = field.attribute === 'html' ? sanitizeMarkup(overrides[field.id]) : overrides[field.id];
    }
    res.set('Cache-Control', 'no-store').json({ page, preview, overrides: map });
  }).catch(() => res.status(500).json({ error: 'AUTH_STATE_ERROR' }));
});

app.post('/api/cms/fields/:id', requireAuth, requireCsrf, (req, res) => {
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

app.post('/api/cms/publish', requireAuth, requireCsrf, (req, res) => {
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

app.post('/api/cms/revisions/:id/restore', requireAuth, requireCsrf, (req, res) => {
  const revision = store.revisions.find((candidate) => candidate.id === req.params.id);
  if (!revision) return res.status(404).json({ error: 'REVISION_NOT_FOUND' });
  store.draftOverrides = { ...(revision.fields || {}) };
  audit('content.revision.restore', req.cmsUser, { revisionId: revision.id });
  writeStore();
  res.json({ ok: true, draftFields: Object.keys(store.draftOverrides).length });
});

app.post('/api/cms/inventory/refresh', requireAuth, requireCsrf, (_req, res) => {
  refreshInventory();
  audit('content.inventory.refresh', _req.cmsUser, { pages: inventory.pages.length, fields: inventory.fields.length });
  writeStore();
  res.json({ ok: true, generatedAt: inventory.generatedAt, pages: inventory.pages.length, fields: inventory.fields.length });
});

app.get('/api/cms/media', requireAuth, (_req, res) => {
  res.json({ media: store.media.filter((item) => !item.deletedAt).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) });
});

app.post('/api/cms/media', requireAuth, requireCsrf, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'FILE_REQUIRED' });
  const item = {
    id: crypto.randomUUID(),
    url: `/cms-media/${encodeURIComponent(req.file.filename)}`,
    filename: req.file.filename,
    originalName: req.file.originalname,
    mime: req.file.mimetype,
    size: req.file.size,
    createdAt: now(),
    uploadedBy: req.cmsUser.email
  };
  store.media.push(item);
  audit('media.upload', req.cmsUser, { mediaId: item.id, name: item.originalName, size: item.size });
  writeStore();
  res.status(201).json({ media: item });
});

app.delete('/api/cms/media/:id', requireAuth, requireCsrf, (req, res) => {
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
    if (!store.authAdmins.length) console.log('[cms] Primer arranque: abre /admin y crea la cuenta propietaria.');
  });
}

start().catch((error) => {
  console.error('[cms] No se pudo iniciar la autenticación Better Auth', error);
  process.exitCode = 1;
});

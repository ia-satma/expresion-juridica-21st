import './security-bootstrap.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { buildInventory, fileForRoute, inventoryHtml, routeFromFile, SITE_DIR } from './inventory.mjs';
import { auth, authDatabase, authUsesPostgres, findAuthUserByEmail, hasAuthUsers, migrateAuthDatabase, setAuthUserRole } from './auth.mjs';
import { recoverExistingOwner } from './owner-recovery.mjs';
import { DATA_DIR, DATA_SCOPE, MEDIA_DIR, STORE_FILE } from './data-paths.mjs';
import { appStorageEnabled, appStorageScope, deleteFile as deleteStorageFile, downloadFile as downloadStorageFile, removeLocalFile, uploadFile as uploadStorageFile } from './app-storage.mjs';
import { generatePresentation, filePathForPresentation, ensurePresentationDir, presentationModels } from './presentation-generator.mjs';
import { preparePresentationInputs, cleanupPresentationInputs, MAX_PRESENTATION_FILE_BYTES, MAX_DOCUMENT_FILE_BYTES, presentationInputError } from './presentation-inputs.mjs';
import { registerSocialRoutes } from './social-routes.mjs';
import { registerDocumentRoutes } from './document-routes.mjs';
import { repairPresentationImageSizing } from './presentation-images.mjs';
import { BRAND_CONTACT, canonicalBrandEmail, normalizePublicBrandCopy } from './brand-contact.mjs';
import { enablePublicDiscovery, publicSiteCompression, registerSiteOptimizationRoutes, enhanceSiteDocument } from './site-optimization.mjs';
import { authSecurityPolicy, checkLoginAttempt, recordLoginFailure, recordLoginSuccess } from './auth-security.mjs';
import { createUserSecurity } from './user-security.mjs';
import { securityMiddleware, allowedMedia, hostedHttps, safeMediaFilename } from './web-security.mjs';
import { safeLog, publicFailure } from './security-logging.mjs';
import { registerContentEditorRoutes, pendingFieldIds, replaceTemplateText, editablePages } from './content-editor.mjs';
import { registerContactFormRoute } from './contact-form.mjs';
import { createContactRepository } from './contact-store.mjs';
import { cmsPermissions, cmsRequestAllowed } from './cms-permissions.mjs';
import { registerStudioTrashRoutes } from './studio-trash.mjs';
import { createStudioJobs } from './studio-jobs.mjs';
import { readStudioState, writeStudioState, listStudioRecords } from './studio-state.mjs';

const ROOT = process.cwd();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_DIR = path.join(ROOT, 'public', 'admin');
const OWNER_EMAIL = String(process.env.CMS_OWNER_EMAIL || 'ia@satma.mx').trim().toLowerCase();
const PUBLIC_CANONICAL_BASE_URL = 'https://expresionjuridica.com';
const configuredCanonicalBaseUrl = String(process.env.CMS_CANONICAL_BASE_URL || '').trim();
const DEFAULT_CANONICAL_BASE_URL = /(?:^|\.)replit\.app(?:\/|$)/i.test(configuredCanonicalBaseUrl) || !configuredCanonicalBaseUrl
  ? PUBLIC_CANONICAL_BASE_URL
  : configuredCanonicalBaseUrl.replace(/\/$/, '');
const cmsPermissionCatalog = ['content', 'media', 'signatures', 'submissions', 'settings', 'users', 'view'];
const PRESENTATIONS_DIR = path.resolve(DATA_DIR, 'generated-presentations');
const PRESENTATION_INPUTS_DIR = path.resolve(DATA_DIR, 'presentation-inputs');
const DOCUMENT_INPUTS_DIR = path.resolve(DATA_DIR, 'document-inputs');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(MEDIA_DIR, { recursive: true });
ensurePresentationDir();
fs.mkdirSync(PRESENTATION_INPUTS_DIR, { recursive: true });
fs.mkdirSync(DOCUMENT_INPUTS_DIR, { recursive: true });

const defaultSettings = () => ({
  siteName: 'Expresión Jurídica Consultores',
  siteDescription: 'Asesoría y defensa jurídica especializada para personas, empresas e instituciones.',
  defaultLocale: 'es-MX',
  canonicalBaseUrl: DEFAULT_CANONICAL_BASE_URL,
  indexingEnabled: true,
  searchConsoleVerification: '',
  analytics: {
    enabled: false,
    measurementId: ''
  },
  cookie: {
    version: '1.0',
    title: 'Privacidad y cookies',
    text: 'Usamos almacenamiento técnico para recordar que ya viste este aviso. La analítica sólo se activa si la aceptas.',
    acceptLabel: 'Aceptar analítica',
    rejectLabel: 'Rechazar analítica',
    privacyUrl: '/aviso-de-privacidad/',
    policyUrl: '/politica-de-cookies/'
  },
  geo: {
    businessName: 'Expresión Jurídica Consultores',
    phone: '',
    email: BRAND_CONTACT.email,
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
  signatures: [],
  presentations: [],
  rolePermissions: { owner: ['*'], editor: ['content', 'media', 'signatures', 'submissions'], viewer: ['view'] },
  submissions: [],
  revisions: [],
  audit: [],
  settings: defaultSettings()
});

let canonicalUrlMigrated = false;
function isReplitCanonicalUrl(value) {
  try { return /(?:^|\.)replit\.app$/i.test(new URL(String(value || '')).hostname); } catch { return false; }
}

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
    const settings = mergeSettings(parsed.settings);
    if (isReplitCanonicalUrl(settings.canonicalBaseUrl)) {
      settings.canonicalBaseUrl = DEFAULT_CANONICAL_BASE_URL;
      canonicalUrlMigrated = true;
    }
    return {
      ...base,
      ...parsed,
      authAdmins: Array.isArray(parsed.authAdmins)
        ? parsed.authAdmins
          .filter((admin) => admin?.provider !== 'google' && !admin?.pending)
          .map((admin) => ({ ...admin, provider: 'password', mustChangePassword: Boolean(admin.mustChangePassword) }))
        : [],
      signatures: Array.isArray(parsed.signatures) ? parsed.signatures : [],
      presentations: Array.isArray(parsed.presentations) ? parsed.presentations : [],
      rolePermissions: normalizeRolePermissions(parsed.rolePermissions),
      settings
    };
  } catch (error) {
    safeLog('error', 'cms.store.read.failed', error);
    if (authUsesPostgres && DATA_SCOPE === 'production') throw new Error('CMS_STORE_INVALID');
    return defaultStore();
  }
}

async function restoreCmsStoreFromAppStorage() {
  if (!appStorageEnabled) return false;
  const durableProduction = authUsesPostgres && DATA_SCOPE === 'production';
  try {
    const result = await downloadStorageFile('cms.json');
    if (!result.ok) {
      if (result.error === 'APP_STORAGE_NOT_FOUND') return !fs.existsSync(STORE_FILE);
      throw new Error(result.error);
    }
    const restored = JSON.parse(result.value.toString('utf8'));
    if (!Array.isArray(restored?.authAdmins) || !restored.settings) throw new Error('CMS_STORE_INVALID');
    const temporaryFile = `${STORE_FILE}.remote`;
    fs.writeFileSync(temporaryFile, result.value, { mode: 0o600 });
    fs.renameSync(temporaryFile, STORE_FILE);
    return true;
  } catch (error) {
    safeLog('error', 'cms.restore.failed', error);
    if (durableProduction) throw error;
    return false;
  }
}

let storeUploadQueue=Promise.resolve();
function queueStoreUpload(snapshot=`${JSON.stringify(store,null,2)}\n`) {
  if(!appStorageEnabled)return Promise.resolve();
  const work=storeUploadQueue.then(async()=>{
    const file=path.join(DATA_DIR,`.cms-upload-${crypto.randomUUID()}.json`);
    try { fs.writeFileSync(file,snapshot,{mode:0o600});const result=await uploadStorageFile('cms.json',file);if(!result?.ok)throw new Error('APP_STORAGE_UNAVAILABLE'); }
    finally {fs.rmSync(file,{force:true});}
  });
  // Handle legacy callers too, while returning rejection to saves that await durability.
  storeUploadQueue=work.catch(error=>safeLog('error','cms.persistence.failed',error));
  return work;
}

const remoteStoreVerified = await restoreCmsStoreFromAppStorage();
let store = readStore();
const userSecurity = createUserSecurity({ database:authDatabase, auth, secret:auth.options.secret, onAudit:(action,detail)=>{audit(action,null,detail);return writeStore();} });
const contactRepository = createContactRepository(store);
let inventory = buildInventory();
const SEO_HOME_TITLE = 'Abogados en Xalapa y Veracruz | Expresión Jurídica';
const SEO_HOME_TITLE_FIELD = inventory.fields.find(field => field.page === '/' && field.selector.includes('> title') && field.attribute === 'text');
let seoHomeTitleMigrated = false;
if (SEO_HOME_TITLE_FIELD) {
  for (const overrides of [store.draftOverrides, store.publishedOverrides]) {
    const current = overrides[SEO_HOME_TITLE_FIELD.id];
    if (typeof current === 'string' && /Litigio estratégico|Asesoría jurídica|Abogados\s*\|\s*Juicios/i.test(current) && current !== SEO_HOME_TITLE) {
      overrides[SEO_HOME_TITLE_FIELD.id] = SEO_HOME_TITLE;
      seoHomeTitleMigrated = true;
    }
  }
}

function writeStore({localOnly=false}={}) {
  const temp = `${STORE_FILE}.tmp`;
  const snapshot=`${JSON.stringify(store, null, 2)}\n`;
  fs.writeFileSync(temp, snapshot, {mode:0o600});
  fs.renameSync(temp, STORE_FILE);
  return localOnly?Promise.resolve():queueStoreUpload(snapshot);
}

if (canonicalUrlMigrated || seoHomeTitleMigrated) await writeStore();

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

function pageCategory(page) {
  const route = String(page || '/');
  if (route === '/') return 'Inicio';
  if (route.startsWith('/areas/')) return 'Áreas de práctica';
  if (route === '/areas/') return 'Áreas de práctica';
  if (route.startsWith('/analisis/')) return 'Análisis';
  if (route === '/analisis/') return 'Análisis';
  if (route === '/como-trabajamos/') return 'Cómo trabajamos';
  if (route === '/contacto/') return 'Contacto';
  if (route === '/aviso-de-privacidad/' || route === '/politica-de-cookies/') return 'Privacidad y legal';
  return 'Páginas institucionales';
}

function authRoleForCmsRole(role) {
  return role === 'owner' ? 'admin' : 'user';
}

function normalizeRolePermissions(input = {}) {
  const defaults = { owner: ['*'], editor: ['content', 'media', 'signatures', 'submissions'], viewer: ['view'] };
  return Object.fromEntries(Object.entries(defaults).map(([role, fallback]) => {
    const values = Array.isArray(input?.[role]) ? input[role].filter((permission) => permission === '*' || cmsPermissionCatalog.includes(permission)) : fallback;
    return [role, role === 'owner' ? ['*'] : [...new Set(values.length ? values : fallback)]];
  }));
}

function cmsAdminRecordForId(id) {
  return store.authAdmins.find((admin) => admin.userId === id || admin.id === id) || null;
}

async function setupRequired() {
  return !authUsesPostgres && store.authAdmins.length === 0 && !(await hasAuthUsers());
}

async function syncBetterAuthRole(userId, cmsRole) {
  await setAuthUserRole(userId, authRoleForCmsRole(cmsRole));
}

function publicSettings() {
  const { siteName, siteDescription, defaultLocale, canonicalBaseUrl, indexingEnabled, searchConsoleVerification, analytics, cookie, geo, navigation } = store.settings;
  return {
    siteName,
    siteDescription: normalizePublicBrandCopy(siteDescription),
    defaultLocale,
    canonicalBaseUrl,
    indexingEnabled: Boolean(indexingEnabled),
    searchConsoleVerification,
    analytics: {
      enabled: Boolean(analytics?.enabled),
      measurementId: String(analytics?.measurementId || '')
    },
    cookie: { ...cookie },
    geo: { ...geo, email: canonicalBrandEmail(geo?.email) },
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
      privacyUrl: text(next.cookie?.privacyUrl, 500) || '/aviso-de-privacidad/',
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
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers), query:{disableCookieCache:true,disableRefresh:true} });
    const createdAt = Date.parse(session?.session?.createdAt || '');
    const maxAgeMs = authSecurityPolicy.sessionHours * 60 * 60 * 1000;
    if (Number.isFinite(createdAt) && Date.now() - createdAt >= maxAgeMs) { await userSecurity.revokeSession(session); return null; }
    if (!(await userSecurity.validateSession(session)).valid) return null;
    return session;
  } catch (error) {
    safeLog('error', 'auth.session.lookup.failed', error);
    return null;
  }
}

function setCsrfCookie(res) {
  const token = randomToken(24);
  const secure = hostedHttps() ? '; Secure' : '';
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
  const admin = await attachCmsSession(req);
  if (!admin) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  if (admin.mustChangePassword) return res.status(403).json({ error: 'PASSWORD_CHANGE_REQUIRED' });
  if (!cmsRequestAllowed(req,store)) return res.status(403).json({error:'ROLE_REQUIRED'});
  next();
}

async function requireSession(req, res, next) {
  if (!await attachCmsSession(req)) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  next();
}

async function attachCmsSession(req) {
  const session = await authSessionFor(req);
  const admin = cmsAdminFor(session);
  if (!session?.user || !admin) return null;
  req.cmsUser = session.user;
  req.cmsAdmin = admin;
  req.cmsSession = session;
  return admin;
}

function temporaryPassword() {
  return crypto.randomBytes(18).toString('base64url');
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
    if (target.contents().toArray().some(node => node.type === 'text' && String(node.data || '').trim())) target.html(replaceTemplateText(target.html(), String(value), true));
    else target.text(String(value));
  }
  else target.attr(field.attribute, sanitizeAttribute(field.attribute, value));
}

function injectBridge($) {
  const script = '<script src="/cms-bridge.js?v=20261103-content2" defer data-cms-bridge="true"></script>';
  if ($('script[data-cms-bridge="true"]').length) { $('script[data-cms-bridge="true"]').attr('src','/cms-bridge.js?v=20261103-content2'); return; }
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
    description: normalizePublicBrandCopy(settings.siteDescription),
    areaServed: { '@type': 'Country', name: 'México' },
    address: {
      '@type': 'PostalAddress',
      streetAddress: geo.street,
      addressLocality: geo.locality,
      addressRegion: geo.region,
      addressCountry: geo.country || 'MX'
    }
  };
  if (geo.email) schema.email = canonicalBrandEmail(geo.email);
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
    if (Object.prototype.hasOwnProperty.call(overrides, field.id)) applyField($, field, normalizePublicBrandCopy(overrides[field.id]));
  }
  injectSiteMetadata($, page, preview);
  enhanceSiteDocument($, { page, settings: store.settings, inventory, preview });
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
      const extension = path.extname(file.originalname).toLowerCase();
      cb(null, `${crypto.randomUUID()}${extension}`);
    }
  }),
  limits: { fileSize: 250 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = allowedMedia(file);
    cb(allowed ? null : new Error('MEDIA_TYPE_NOT_ALLOWED'), allowed);
  }
});

function cleanMediaFolder(value) {
  const folder = String(value || 'General').trim().replace(/[\\/]+/g, ' · ').replace(/[^\p{L}\p{N} .·_-]+/gu, '').slice(0, 80);
  return folder || 'General';
}

const siteMediaExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.svg', '.mp4', '.webm', '.mp3', '.wav', '.pdf']);
function siteMediaFiles(directory, prefix = '') {
  const files = [];
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('._') || entry.name === '.DS_Store') continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.join(prefix, entry.name).split(path.sep).join('/');
    if (entry.isDirectory()) files.push(...siteMediaFiles(absolute, relative));
    else if (siteMediaExtensions.has(path.extname(entry.name).toLowerCase())) files.push({ absolute, relative });
  }
  return files;
}

function mediaMime(file) {
  const ext = path.extname(file).toLowerCase();
  return ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.pdf': 'application/pdf' })[ext] || 'application/octet-stream';
}

async function importSiteMediaOnStart() {
  if (!appStorageEnabled) return;
  const sourceFiles = [
    ...siteMediaFiles(SITE_DIR),
    ...siteMediaFiles(path.join(ROOT, 'firma-cms', 'assets'), 'firma-cms/assets')
  ];
  const pending = sourceFiles.filter((file) => !store.media.some((item) => !item.deletedAt && item.sourcePath === file.relative));
  if (!pending.length) return;
  const imported = [];
  for (const file of pending) {
    const filename = 'site-' + file.relative.replace(/[^a-zA-Z0-9._-]+/g, '-');
    const uploaded = await uploadStorageFile(filename, file.absolute);
    if (!uploaded.ok) throw new Error('No se pudo cargar ' + file.relative + ': ' + uploaded.error);
    const item = {
      id: crypto.randomUUID(),
      url: '/cms-media/' + encodeURIComponent(filename),
      filename,
      storage: 'replit-app-storage',
      storageScope: appStorageScope,
      originalName: path.basename(file.relative),
      sourcePath: file.relative,
      mime: mediaMime(file.relative),
      size: fs.statSync(file.absolute).size,
      folder: file.relative.startsWith('img/') ? 'Imágenes del sitio' : file.relative.startsWith('video/') ? 'Videos del sitio' : file.relative.startsWith('firma-cms/') ? 'Firmas de correo' : 'Marca',
      alt: '',
      caption: 'Importado del sitio · ' + file.relative,
      createdAt: now(),
      uploadedBy: 'system'
    };
    store.media.push(item);
    imported.push(item);
  }
  audit('media.site-import', { email: 'system' }, { count: imported.length, scope: appStorageScope });
  writeStore();
  console.log('[cms-storage] importados ' + imported.length + ' medios a ' + appStorageScope);
}

const app = express();
app.disable('x-powered-by');
app.use(securityMiddleware({ getCanonicalBase: () => store.settings.canonicalBaseUrl }));
app.use(publicSiteCompression);

// Better Auth must receive the raw request stream before Express body parsers.
// Express 5 uses the `*splat` catch-all syntax documented by Better Auth.
app.all('/api/auth/sign-up/email', async (req, res, next) => {
  if (!(await setupRequired())) return res.status(403).json({ error: 'SIGNUP_DISABLED' });
  return toNodeHandler(auth)(req, res, next);
});
app.all('/api/auth/sign-out', async (req, res, next) => { const session = await authSessionFor(req); const admin = cmsAdminFor(session); if (session?.user && admin) { audit('auth.logout', session.user, { sessionId: session.session?.id || null, role: admin.role }); writeStore(); } return toNodeHandler(auth)(req, res, next); });

function authClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
}

function authLoginEmail(req) {
  return String(req.body?.email || '').trim().toLowerCase();
}

async function authRequestHandler(req, res, next) {
  const pathname = String(req.originalUrl || '').split('?')[0];
  const isEmailLogin = req.method === 'POST' && pathname.endsWith('/sign-in/email');
  if (!isEmailLogin) return toNodeHandler(auth)(req, res, next);

  const email = authLoginEmail(req);
  const ip = authClientIp(req);
  const gate = checkLoginAttempt({ email, ip });
  if (!gate.allowed) {
    res.setHeader('Retry-After', String(gate.retryAfterSeconds));
    audit('auth.login.blocked', null, { email: email || null, scope: gate.scope, retryAfterSeconds: gate.retryAfterSeconds });
    writeStore();
    return res.status(429).json({
      error: 'LOGIN_TEMPORARILY_BLOCKED',
      message: 'Hay demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.',
      retryAfterSeconds: gate.retryAfterSeconds,
    });
  }

  res.once('finish', () => {
    const status = Number(res.statusCode || 0);
    if (status >= 200 && status < 300) {
      recordLoginSuccess({ email, ip });
      return;
    }
    if (![400, 401, 403, 429].includes(status)) return;
    const result = recordLoginFailure({ email, ip });
    audit('auth.login.failed', null, {
      email: email || null,
      status,
      blocked: result.blocked,
      retryAfterSeconds: result.retryAfterSeconds,
    });
    writeStore();
  });
  return toNodeHandler(auth)(req, res, next);
}

app.all('/api/auth/*splat', userSecurity.authHandler);

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
registerSiteOptimizationRoutes(app, { getStore: () => store, getInventory: () => inventory, requireAuth });
registerContentEditorRoutes(app, { getInventory: () => inventory, store, writeStore, requireAuth, requireEditor, requireCsrf, audit });
userSecurity.registerActivityRoutes(app,{requireSession,requireCsrf});

registerContactFormRoute(app, { store, writeStore, persistSubmission:item=>contactRepository.save(item), findSubmission:id=>contactRepository.get(id) });

app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'expresion-juridica-cms', inventory: inventory.pages.length, dataScope: DATA_SCOPE, appStorage: appStorageEnabled }));

app.get('/api/cms/auth-state', async (req, res) => {
  const session = await authSessionFor(req);
  if (!session?.user) return res.json({ authenticated: false, setupRequired: await setupRequired() });
  let admin = cmsAdminFor(session);
  if (!admin && !authUsesPostgres && store.authAdmins.length === 0) {
    if (String(session.user.email || '').toLowerCase() !== OWNER_EMAIL) return res.status(403).json({ error: 'OWNER_EMAIL_REQUIRED' });
    admin = { id: crypto.randomUUID(), userId: session.user.id, email: session.user.email, role: 'owner', provider: 'password', mustChangePassword: false, createdAt: now() };
    store.authAdmins.push(admin);
    audit('auth.bootstrap', session.user);
    await writeStore();
  }
  if (!admin) return res.status(403).json({ error: 'CMS_ACCESS_NOT_GRANTED' });
  if (session.user.role !== authRoleForCmsRole(admin.role)) await syncBetterAuthRole(session.user.id, admin.role);
  const sessionId = session.session?.id;
  if (sessionId && !store.audit.some((item) => item.action === 'auth.login' && item.detail?.sessionId === sessionId)) { audit('auth.login', session.user, { sessionId, role: admin.role }); writeStore(); }
  const csrf = setCsrfCookie(res);
  res.json({ authenticated: true, setupRequired: false, csrf, user: { ...session.user, role: admin.role, permissions:cmsPermissions({cmsAdmin:admin},store), mustChangePassword: Boolean(admin.mustChangePassword) }, sessionExpiresAt: session.session?.expiresAt || null, sessionMaxAgeHours: authSecurityPolicy.sessionHours, userSecurity:await userSecurity.sessionInfo(session) });
});

app.post('/api/cms/auth/change-password', requireSession, requireCsrf, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (newPassword.length < 8) return res.status(400).json({ error: 'PASSWORD_TOO_SHORT' });
  if (!currentPassword) return res.status(400).json({ error: 'CURRENT_PASSWORD_REQUIRED' });
  try {
    await auth.api.changePassword({
      body: { currentPassword, newPassword, revokeOtherSessions: false },
      headers: fromNodeHeaders(req.headers)
    });
    await userSecurity.revokeUserSessions(req.cmsUser.id,{exceptId:req.cmsSession.session.id});
    req.cmsAdmin.mustChangePassword = false;
    req.cmsAdmin.updatedAt = now();
    audit('auth.password.change', req.cmsUser);
    await writeStore();
    res.json({ ok: true });
  } catch (error) {
    safeLog('error', 'auth.password.change.failed', error);
    res.status(400).json({ error: 'PASSWORD_CHANGE_FAILED' });
  }
});

app.get('/api/cms/summary', requireAuth, async (_req, res) => {
  await contactRepository.list();
  const draftCount = pendingFieldIds(store).length;
  const publishedCount = Object.keys(store.publishedOverrides).length;
  res.json({
    siteName: store.settings.siteName,
    pages: editablePages(inventory).length,
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
  const pages = editablePages(inventory).map((page) => {
    const pageFields = inventory.fields.filter((field) => field.page === page.page);
    const pending = new Set(pendingFieldIds(store));
    const draft = pageFields.filter((field) => pending.has(field.id)).length;
    const published = pageFields.filter((field) => Object.prototype.hasOwnProperty.call(store.publishedOverrides, field.id)).length;
    return { ...page, category: pageCategory(page.page), draftFields: draft, publishedFields: published };
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
      const value = normalizePublicBrandCopy(overrides[field.id]);
      map[field.id] = field.attribute === 'html' ? sanitizeMarkup(value) : sanitizeAttribute(field.attribute, value);
    }
    const renderedOverrides = {}, bindings = {};
    const file = fileForRoute(page);
    if (file) {
      const { $, fields } = inventoryHtml(fs.readFileSync(file,'utf8'), page);
      for (const field of fields) if (Object.hasOwn(overrides,field.id)) applyField($,field,normalizePublicBrandCopy(overrides[field.id]));
      for (const field of fields) if (Object.hasOwn(overrides,field.id)) {
        const target = $(field.selector).first(); if (!target.length) continue;
        const html = ['html','text'].includes(field.attribute);
        renderedOverrides[field.id] = html ? sanitizeMarkup(target.html()) : target.attr(field.attribute) ?? '';
        bindings[field.id] = { selector: field.selector, attribute: html ? 'html' : field.attribute };
      }
    }
    res.set('Cache-Control', 'no-store').json({ page, preview, overrides: map, renderedOverrides, bindings, settings: publicSettings() });
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
  const changed = pendingFieldIds(store).length;
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
  res.json({ media, folders: folders.map(([name, count]) => ({ name, count })), storage: { provider: appStorageEnabled ? 'replit-app-storage' : 'local', scope: appStorageEnabled ? appStorageScope : DATA_SCOPE } });
});

app.post('/api/cms/media', requireAuth, requireEditor, requireCsrf, upload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'FILE_REQUIRED' });
  let storage = 'local';
  if (appStorageEnabled) {
    try {
      const uploaded = await uploadStorageFile(req.file.filename, req.file.path);
      if (!uploaded.ok) {
        removeLocalFile(req.file.path);
        return res.status(503).json({ error: uploaded.error });
      }
      storage = 'replit-app-storage';
      removeLocalFile(req.file.path);
    } catch (error) {
      removeLocalFile(req.file.path);
      return next(error);
    }
  }
  const item = {
    id: crypto.randomUUID(),
    url: `/cms-media/${encodeURIComponent(req.file.filename)}`,
    filename: req.file.filename,
    storage,
    storageScope: appStorageEnabled ? appStorageScope : DATA_SCOPE,
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

app.post('/api/cms/media/import-site', requireAuth, requireEditor, requireCsrf, async (req, res, next) => {
  if (!appStorageEnabled) return res.status(503).json({ error: 'APP_STORAGE_NOT_CONFIGURED' });
  try {
    const imported = [];
    const sourceFiles = [
      ...siteMediaFiles(SITE_DIR),
      ...siteMediaFiles(path.join(ROOT, 'firma-cms', 'assets'), 'firma-cms/assets')
    ];
    for (const file of sourceFiles) {
      const sourcePath = file.relative;
      if (store.media.some((item) => !item.deletedAt && item.sourcePath === sourcePath)) continue;
      const filename = `site-${sourcePath.replace(/[^a-zA-Z0-9._-]+/g, '-')}`;
      const uploaded = await uploadStorageFile(filename, file.absolute);
      if (!uploaded.ok) return res.status(503).json({ error: uploaded.error, imported: imported.length });
      const folder = sourcePath.startsWith('img/') ? 'Imágenes del sitio' : sourcePath.startsWith('video/') ? 'Videos del sitio' : sourcePath.startsWith('firma-cms/') ? 'Firmas de correo' : 'Marca';
      const item = {
        id: crypto.randomUUID(),
        url: `/cms-media/${encodeURIComponent(filename)}`,
        filename,
        storage: 'replit-app-storage',
        storageScope: appStorageScope,
        originalName: path.basename(sourcePath),
        sourcePath,
        mime: mediaMime(sourcePath),
        size: fs.statSync(file.absolute).size,
        folder,
        alt: '',
        caption: `Importado del sitio · ${sourcePath}`,
        createdAt: now(),
        uploadedBy: req.cmsUser.email
      };
      store.media.push(item);
      imported.push(item);
    }
    if (imported.length) {
      audit('media.site-import', req.cmsUser, { count: imported.length, scope: appStorageScope });
      writeStore();
    }
    res.json({ ok: true, imported: imported.length, total: store.media.filter((item) => !item.deletedAt).length, storage: appStorageScope });
  } catch (error) {
    next(error);
  }
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
  const archive = async () => {
    if (item.storage === 'replit-app-storage') {
      const result = await deleteStorageFile(item.filename);
      if (!result.ok) return res.status(503).json({ error: result.error });
    } else if (item.filename) {
      removeLocalFile(path.join(MEDIA_DIR, item.filename));
    }
    item.deletedAt = now();
    audit('media.archive', req.cmsUser, { mediaId: item.id });
    writeStore();
    res.status(204).end();
  };
  archive().catch((error) => { res.status(500).json({ error: 'MEDIA_DELETE_FAILED', detail: error.message }); });
});

app.get('/api/cms/activity', requireAuth, (_req, res) => {
  res.json({ activity: store.audit.slice(0, 100) });
});

app.get('/api/cms/signatures', requireAuth, (req, res) => {
  res.json({ signatures: store.signatures.filter(item=>req.query.includeDeleted==='1'||!item.deletedAt).map(signature => ({ ...signature, email: canonicalBrandEmail(signature.email) })) });
});

app.post('/api/cms/signatures', requireAuth, requireEditor, requireCsrf, async (req, res) => {
  const input = req.body || {};
  const clean = (value, max) => String(value || '').trim().slice(0, max);
  const signature = {
    id: crypto.randomUUID(),
    name: clean(input.name, 160),
    role: clean(input.role, 160),
    phone: clean(input.phone, 80),
    email: canonicalBrandEmail(clean(input.email, 254).toLowerCase()),
    address1: clean(input.address1, 180),
    address2: clean(input.address2, 180),
    baseUrl: clean(input.baseUrl, 500),
    createdAt: now(),
    updatedAt: now(),
    createdBy: req.cmsUser.email
  };
  if (!signature.name || !signature.email || !/^\S+@\S+\.\S+$/.test(signature.email)) return res.status(422).json({ error: 'SIGNATURE_FIELDS_INVALID' });
  store.signatures.unshift(signature);
  audit('signature.create', req.cmsUser, { signatureId: signature.id, name: signature.name });
  await writeStore();
  res.status(201).json({ signature });
});

app.patch('/api/cms/signatures/:id', requireAuth, requireEditor, requireCsrf, async (req, res) => {
  const signature = store.signatures.find((item) => item.id === req.params.id);
  if (!signature || signature.deletedAt) return res.status(404).json({ error: 'SIGNATURE_NOT_FOUND' });
  const clean = (value, max) => String(value || '').trim().slice(0, max);
  for (const [key, max] of Object.entries({ name: 160, role: 160, phone: 80, email: 254, address1: 180, address2: 180, baseUrl: 500 })) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) signature[key] = clean(req.body[key], max);
  }
  signature.email = canonicalBrandEmail(signature.email);
  if (!signature.name || !/^\S+@\S+\.\S+$/.test(signature.email)) return res.status(422).json({ error: 'SIGNATURE_FIELDS_INVALID' });
  signature.updatedAt = now();
  audit('signature.update', req.cmsUser, { signatureId: signature.id });
  await writeStore();
  res.json({ signature });
});

registerStudioTrashRoutes(app,{base:'/api/cms/signatures',getRecord:async id=>store.signatures.find(item=>item.id===id),saveRecord:async record=>{store.signatures=store.signatures.map(item=>item.id===record.id?record:item);},requireAuth,requireEditor,requireCsrf,audit,writeStore,action:'signature'});

function publicPresentationItem(item) {
  const id = encodeURIComponent(item.id);
  return {
    id: item.id,
    title: item.title,
    subtitle: item.subtitle,
    topic: item.topic,
    sourceLength: item.sourceLength || 0,
    language: item.language || 'es',
    style: item.style || 'editorial',
    branding: item.branding || 'firm',
    brandProfile: item.brandProfile || null,
    formats: item.formats || ['pptx', 'pdf', 'png'],
    sources: item.sources || [],
    documentNames: item.documentNames || [],
    generatedImageCount: item.generatedImageCount || 0,
    slideCount: item.slideCount || item.outline?.slides?.length || 0,
    contentSlideCount: item.contentSlideCount || item.slideCount || item.outline?.slides?.length || 0,
    includeBookends: item.includeBookends === true,
    bookendSlides: item.bookendSlides || null,
    aiUsed: Boolean(item.aiUsed),
    model: item.model || null,
    imageUsed: Boolean(item.imageUsed),
    imageModel: item.imageModel || null,
    warning: item.warning || null,
    createdAt: item.createdAt,
    createdBy: item.createdBy || '',
    outline: item.outline || null,
    files: {
      pptx: item.files?.pptx ? `/api/cms/presentations/${id}/file/pptx` : null,
      pdf: item.files?.pdf ? `/api/cms/presentations/${id}/file/pdf` : null,
      imagesZip: item.files?.imagesZip ? `/api/cms/presentations/${id}/file/images` : null,
      artwork: item.files?.artwork ? `/api/cms/presentations/${id}/file/artwork` : null,
      images: Array.from({ length: item.slideCount || item.outline?.slides?.length || 0 }, (_, index) => `/api/cms/presentations/${id}/file/png?slide=${index}`)
    }
  };
}

const presentationJobs=createStudioJobs('presentations',publicPresentationItem,'PRESENTATION_GENERATION_FAILED');
const getPresentation=async id=>await readStudioState('presentations',id)||(store.presentations||[]).find(item=>item.id===id);
app.get('/api/cms/presentations', requireAuth, async (req, res) => {
  store.presentations=await listStudioRecords('presentations',store.presentations||[]);
  res.json({
    presentations: (store.presentations || []).map(publicPresentationItem),
    generator: presentationModels(),activeJob:await presentationJobs.active(req)
  });
});
app.get('/api/cms/presentations/jobs/:id',requireAuth,async(req,res)=>{const job=await presentationJobs.read(req,req.params.id);if(!job)return res.status(404).json({error:'PRESENTATION_JOB_NOT_FOUND'});res.json({job});});

const presentationUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, PRESENTATION_INPUTS_DIR),
    filename: (_req, _file, callback) => callback(null, crypto.randomUUID())
  }),
  limits: { fileSize: MAX_PRESENTATION_FILE_BYTES, files: 30, fields: 20, fieldSize: 150000 },
  fileFilter: (_req, file, callback) => {
    const extensions = file.fieldname === 'documents' ? ['.pdf', '.docx', '.txt', '.md'] : ['.png', '.jpg', '.jpeg', '.webp'];
    const valid = extensions.includes(path.extname(file.originalname).toLowerCase());
    callback(valid ? null : presentationInputError('Formato de archivo no admitido.'), valid);
  }
}).fields([{ name: 'documents', maxCount: 20 }, { name: 'supportImages', maxCount: 10 }]);

const documentUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, DOCUMENT_INPUTS_DIR),
    filename: (_req, _file, callback) => callback(null, crypto.randomUUID())
  }),
  limits: { fileSize: MAX_DOCUMENT_FILE_BYTES, files: 20, fields: 8, fieldSize: 200000 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    const valid = ['.pdf', '.docx'].includes(extension);
    callback(valid ? null : presentationInputError('Solo se admiten archivos DOCX o PDF.', 'DOCUMENT_FILE_TYPE_INVALID', 422), valid);
  }
}).fields([{ name: 'documents', maxCount: 20 }]);

function receivePresentationInputs(req, res, next) {
  if (!req.is('multipart/form-data')) return next();
  presentationUpload(req, res, async error => {
    if (!error) return next();
    await cleanupPresentationInputs(req.files);
    res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 422).json({ error: error.code || 'PRESENTATION_INPUT_INVALID', detail: error.code === 'LIMIT_FILE_SIZE' ? 'Cada archivo debe pesar como máximo 100 MB.' : error.code === 'LIMIT_UNEXPECTED_FILE' ? 'Admite hasta 20 documentos y 10 imágenes de apoyo.' : error.message });
  });
}

function receiveDocumentInputs(req, res, next) {
  if (!req.is('multipart/form-data')) return next();
  documentUpload(req, res, async error => {
    if (!error) return next();
    await cleanupPresentationInputs(req.files);
    res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : error.code === 'LIMIT_UNEXPECTED_FILE' ? 422 : error.status || 422).json({
      error: error.code || 'DOCUMENT_INPUT_INVALID',
      detail: error.code === 'LIMIT_FILE_SIZE' ? 'Cada archivo debe pesar como máximo 100 MB.' : error.code === 'LIMIT_UNEXPECTED_FILE' ? 'Admite hasta 20 documentos.' : error.message
    });
  });
}

app.post('/api/cms/presentations/generate', requireAuth, requireEditor, requireCsrf, receivePresentationInputs, async (req, res) => {
  try {
    const body = req.body || {};
    const topic = String(body.topic || '').trim();
    if (topic.length > 10000) throw presentationInputError('El tema admite hasta 10 000 caracteres.');
    const inputs = await preparePresentationInputs(req.files);
    if (topic.length < 6 && !inputs.documentNames.length) throw presentationInputError('Escribe un tema de al menos 6 caracteres o sube un documento.', 'PRESENTATION_TOPIC_REQUIRED');
    const sourceText = [String(body.sourceText || '').trim(), inputs.sourceText].filter(Boolean).join('\n\n');
    if (sourceText.length > 120000) throw presentationInputError('El material supera 120 000 caracteres. Reduce el texto o los documentos.');
    const slideCount = Number(body.slideCount || 8);
    if (!Number.isInteger(slideCount) || slideCount < 3 || slideCount > 20) throw presentationInputError('Elige entre 3 y 20 diapositivas.');
    let formats;
    try { formats = typeof body.formats === 'string' ? JSON.parse(body.formats) : body.formats; } catch { /* validated below */ }
    if (!Array.isArray(formats) || !formats.length || formats.some(format => !['pptx', 'pdf', 'png'].includes(format))) throw presentationInputError('Selecciona al menos un formato de descarga.', 'PRESENTATION_FORMAT_REQUIRED');
    const enabled = value => value === true || value === 'true';
    const options={
      topic: topic || 'Presentación basada en documentos', sourceText, slideCount,
      language: body.language === 'en' ? 'en' : 'es',
      style: ['corporate', 'editorial', 'dark'].includes(body.style) ? body.style : 'corporate',
      branding: body.branding === 'minimal' ? 'minimal' : 'firm',
      includeVisuals: enabled(body.includeVisuals), includeImage: enabled(body.includeImage), includeBookends: body.includeBookends === undefined ? true : enabled(body.includeBookends), webSearch: enabled(body.webSearch),
      formats, documentNames: inputs.documentNames, supportImages: inputs.supportImages
    };
    const work=async(progress=()=>{})=>{
      const result=await generatePresentation(options,progress),record={...result,createdBy:req.cmsUser.email};
      progress('Guardando la presentación y sus descargas',0,1,'save');await writeStudioState('presentations',record.id,record);
      store.presentations=[record,...(store.presentations||[]).filter(item=>item.id!==record.id)];
      audit('presentation.create',req.cmsUser,{presentationId:record.id,slideCount:record.slideCount,aiUsed:record.aiUsed,model:record.model,brandProfile:record.brandProfile,documentCount:record.documentNames.length});await writeStore();return record;
    };
    if(enabled(body.async)){const job=await presentationJobs.enqueue(req,work);res.status(202).json({job});}
    else res.status(201).json({presentation:publicPresentationItem(await work())});
  } catch (error) {
    safeLog('error','presentation.generation.failed',error);
    res.status(error.status || 500).json(publicFailure(error,'PRESENTATION_GENERATION_FAILED'));
  } finally {
    await cleanupPresentationInputs(req.files);
  }
});

app.get('/api/cms/presentations/:id/file/:kind', requireAuth, async (req, res, next) => {
  const item = await getPresentation(req.params.id);
  if (!item) return res.status(404).json({ error: 'PRESENTATION_NOT_FOUND' });
  const kind = String(req.params.kind || '').toLowerCase();
  let file = null;
  let contentType = 'application/octet-stream';
  let disposition = 'attachment';
  if (kind === 'pptx') { file = item.files?.pptx; contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'; }
  if (kind === 'pdf') { file = item.files?.pdf; contentType = 'application/pdf'; }
  if (kind === 'artwork') { file = item.files?.artwork; contentType = 'image/png'; }
  if (kind === 'images') { file = item.files?.imagesZip; contentType = 'application/zip'; }
  if (kind === 'png') {
    const index = Number.parseInt(req.query.slide, 10);
    file = Number.isInteger(index) ? item.files?.images?.[index] : null;
    contentType = 'image/png';
    disposition = 'inline';
  }
  const fileNotFound = () => res.status(404).json(publicFailure('PRESENTATION_FILE_NOT_FOUND'));
  if (!file) return fileNotFound();
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  const headers = {
    'Content-Type': contentType,
    'Content-Disposition': `${disposition}; filename="${String(file.name || `${item.id}.${kind}`).replace(/[^a-zA-Z0-9._-]/g, '-')}"`
  };
  if (file.storage === 'replit-app-storage') {
    try {
      const result = await downloadStorageFile(file.relative);
      if (!result.ok) return result.error === 'APP_STORAGE_NOT_FOUND'
        ? fileNotFound()
        : res.status(503).json(publicFailure(result.error, 'APP_STORAGE_UNAVAILABLE'));
      const data = kind === 'pptx' ? (await repairPresentationImageSizing(result.value)).buffer : result.value;
      return res.set(headers).send(data);
    } catch (error) {
      return next(error);
    }
  }
  const localPath = filePathForPresentation(file);
  if (!localPath || !path.resolve(localPath).startsWith(`${PRESENTATIONS_DIR}${path.sep}`)) return fileNotFound();
  if (kind === 'pptx') {
    try {
      const { buffer } = await repairPresentationImageSizing(await fs.promises.readFile(localPath));
      return res.set(headers).send(buffer);
    } catch (error) {
      return error.code === 'ENOENT' ? fileNotFound() : next(error);
    }
  }
  return res.sendFile(localPath, { dotfiles: 'deny', headers }, error => {
    if (!error || res.headersSent) return;
    res.removeHeader('Content-Disposition');
    res.removeHeader('Content-Type');
    return error.status === 404 || error.code === 'ENOENT' ? fileNotFound() : next(error);
  });
});

registerSocialRoutes(app, { store, writeStore, requireAuth, requireEditor, requireCsrf, receivePresentationInputs, audit });
registerDocumentRoutes(app, { store, writeStore, requireAuth, requireEditor, requireCsrf, receiveDocumentInputs, audit });

app.get('/api/cms/submissions', requireAuth, async (req, res) => {
  await contactRepository.list();
  const status = String(req.query.status || '').trim();
  const submissions = store.submissions.filter((item) => !status || item.status === status).map(({ userAgent, ...item }) => item);
  res.json({ submissions, counts: store.submissions.reduce((map, item) => { map[item.status] = (map[item.status] || 0) + 1; return map; }, {}) });
});

app.patch('/api/cms/submissions/:id', requireAuth, requireEditor, requireCsrf, async (req, res) => {
  const existing = await contactRepository.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'SUBMISSION_NOT_FOUND' });
  const item = {...existing};
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'status') && ['new', 'in_progress', 'resolved', 'archived'].includes(req.body.status)) item.status = req.body.status;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'notes')) item.notes = String(req.body.notes || '').slice(0, 2000);
  item.updatedAt = now();
  await contactRepository.save(item);
  store.submissions = [item, ...store.submissions.filter(candidate=>candidate.id!==item.id)];
  audit('submission.update', req.cmsUser, { submissionId: item.id, status: item.status });
  await writeStore();
  res.json({ ok: true, submission: item });
});

function cmsRoleForUser(user) {
  return store.authAdmins.find((admin) => admin.userId === user.id)?.role || null;
}

function userPayload(user) {
  const cmsAdmin = store.authAdmins.find((admin) => admin.userId === user.id);
  const lastAccess = store.audit.find((item) => item.action === 'auth.login' && emailKey(item.actor) === emailKey(user.email));
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: cmsRoleForUser(user),
    permissions: cmsPermissions({cmsAdmin},store),
    authRole: user.role || 'user',
    provider: 'password',
    mustChangePassword: Boolean(cmsAdmin?.mustChangePassword),
    banned: Boolean(user.banned),
    banReason: user.banReason || '',
    deletedAt: cmsAdmin?.deletedAt || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastAccessAt: lastAccess?.at || null
  };
}

function recentAccessPayload() {
  return store.audit
    .filter((item) => ['auth.login', 'auth.login.failed', 'auth.login.blocked'].includes(item.action))
    .slice(0, 100)
    .map((item) => {
      const success = item.action === 'auth.login';
      const blocked = item.action === 'auth.login.blocked' || item.detail?.blocked;
      const admin = item.actor && store.authAdmins.find((candidate) => emailKey(candidate.email) === emailKey(item.actor));
      return {
        at: item.at,
        email: success ? item.actor : '',
        name: admin?.name || '',
        role: admin?.role || item.detail?.role || '',
        result: success ? 'success' : blocked ? 'blocked' : 'failed',
        origin: item.detail?.scope || 'protected'
      };
    });
}

app.get('/api/cms/role-permissions', requireAuth, requireOwner, (_req, res) => { res.json({ permissions: store.rolePermissions, catalog: cmsPermissionCatalog }); });

app.put('/api/cms/role-permissions', requireAuth, requireOwner, requireCsrf, (req, res) => { store.rolePermissions = normalizeRolePermissions(req.body?.permissions || {}); audit('auth.permissions.update', req.cmsUser, { roles: Object.keys(store.rolePermissions) }); writeStore(); res.json({ ok: true, permissions: store.rolePermissions }); });

app.get('/api/cms/users', requireAuth, requireOwner, async (req, res, next) => {
  try {
    const result = await auth.api.listUsers({
      query: { limit: 100, offset: 0, sortBy: 'createdAt', sortDirection: 'desc' },
      headers: fromNodeHeaders(req.headers)
    });
    const includeArchived = String(req.query?.includeArchived || '') === '1';
    const users = (result?.users || []).filter((user) => cmsRoleForUser(user) && (includeArchived || !store.authAdmins.find((admin) => admin.userId === user.id)?.deletedAt)).map(userPayload);
    res.json({ users, total: users.length, recentAccesses: recentAccessPayload() });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/cms/users/:id', requireAuth, requireOwner, requireCsrf, async (req, res, next) => {
  try {
    const target = cmsAdminRecordForId(req.params.id);
    if (!target?.userId) return res.status(404).json({ error: 'USER_NOT_FOUND' });
    if (target.userId === req.cmsUser.id) return res.status(409).json({ error: 'CURRENT_USER_CANNOT_BE_DELETED' });
    if (target.role === 'owner' && store.authAdmins.filter((admin) => admin.role === 'owner' && !admin.banned).length < 2) return res.status(409).json({ error: 'LAST_OWNER' });
    await auth.api.banUser({ body: { userId: target.userId, banReason: 'Cuenta archivada desde el CMS' }, headers: fromNodeHeaders(req.headers) });
    target.banned = true;
    target.deletedAt = now();
    target.banReason = 'Cuenta archivada desde el CMS';
    target.updatedAt = now();
    audit('auth.user.delete', req.cmsUser, { userId: target.userId });
    await writeStore();
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.post('/api/cms/users/:id/restore', requireAuth, requireOwner, requireCsrf, async (req, res, next) => {
  try {
    const target = cmsAdminRecordForId(req.params.id);
    if (!target?.userId) return res.status(404).json({ error: 'USER_NOT_FOUND' });
    await auth.api.unbanUser({ body: { userId: target.userId }, headers: fromNodeHeaders(req.headers) });
    target.banned = false;
    target.deletedAt = null;
    target.banReason = '';
    target.updatedAt = now();
    audit('auth.user.restore', req.cmsUser, { userId: target.userId });
    await writeStore();
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.post('/api/cms/users', requireAuth, requireOwner, requireCsrf, async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim();
    const role = ['owner', 'editor', 'viewer'].includes(req.body?.role) ? req.body.role : 'editor';
    if (!email || !name || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'USER_FIELDS_INVALID' });
    const existingCmsAccess = store.authAdmins.find((admin) => emailKey(admin.email) === email && !admin.banned);
    if (existingCmsAccess) return res.status(409).json({ error: 'USER_ALREADY_AUTHORIZED' });
    // Better Auth archives users by banning them. Creating the same email again
    // otherwise raises USER_ALREADY_EXISTS even though the CMS entry is archived.
    // Restore that account in place and issue a fresh temporary password.
    await syncBetterAuthRole(req.cmsUser.id, 'owner');
    const existingAuthUser = await findAuthUserByEmail(email);
    const archivedCmsAccess = existingAuthUser?.id
      ? store.authAdmins.find((admin) => admin.userId === existingAuthUser.id && (admin.banned || admin.deletedAt))
      : null;
    if (archivedCmsAccess) {
      const password = temporaryPassword();
      const headers = fromNodeHeaders(req.headers);
      await auth.api.setUserPassword({ body: { userId: existingAuthUser.id, newPassword: password }, headers });
      await auth.api.unbanUser({ body: { userId: existingAuthUser.id }, headers });
      await setAuthUserRole(existingAuthUser.id, authRoleForCmsRole(role));
      archivedCmsAccess.email = email;
      archivedCmsAccess.name = name;
      archivedCmsAccess.role = role;
      archivedCmsAccess.banned = false;
      archivedCmsAccess.deletedAt = null;
      archivedCmsAccess.banReason = '';
      archivedCmsAccess.mustChangePassword = true;
      archivedCmsAccess.updatedAt = now();
      const restored = await auth.api.getUser({ query: { id: existingAuthUser.id }, headers });
      const user = restored?.user || restored || { ...existingAuthUser, name, role: authRoleForCmsRole(role) };
      audit('auth.user.recreate', req.cmsUser, { userId: existingAuthUser.id, email, role });
      await writeStore();
      return res.status(201).json({ user: userPayload({ ...user, role: authRoleForCmsRole(role) }), temporaryPassword: password });
    }
    if (existingAuthUser) return res.status(409).json({ error: 'USER_ALREADY_AUTHORIZED' });
    const password = temporaryPassword();
    const result = await auth.api.createUser({
      body: { email, name, password, role: authRoleForCmsRole(role) },
      headers: fromNodeHeaders(req.headers)
    });
    const user = result?.user || result;
    if (!user?.id) return res.status(500).json({ error: 'USER_CREATE_FAILED' });
    store.authAdmins.push({ id: crypto.randomUUID(), userId: user.id, email: user.email, name: user.name, role, provider: 'password', mustChangePassword: true, createdAt: now() });
    audit('auth.user.create', req.cmsUser, { userId: user.id, email: user.email, role });
    await writeStore();
    res.status(201).json({ user: userPayload({ ...user, role: authRoleForCmsRole(role) }), temporaryPassword: password });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/cms/users/:id/role', requireAuth, requireOwner, requireCsrf, async (req, res, next) => {
  try {
    const target = cmsAdminRecordForId(req.params.id);
    const role = String(req.body?.role || '');
    if (!target?.userId || !['owner', 'editor', 'viewer'].includes(role)) return res.status(400).json({ error: 'ROLE_INVALID' });
    if (target.role === 'owner' && role !== 'owner' && store.authAdmins.filter((admin) => admin.role === 'owner' && !admin.banned).length < 2) {
      return res.status(409).json({ error: 'LAST_OWNER' });
    }
    const result = await auth.api.setRole({
      body: { userId: target.userId, role: authRoleForCmsRole(role) },
      headers: fromNodeHeaders(req.headers)
    });
    target.role = role;
    target.updatedAt = now();
    audit('auth.user.role', req.cmsUser, { userId: target.userId || target.id, role });
    await writeStore();
    const user = result?.user || result;
    res.json({ user: userPayload({ ...user, role: authRoleForCmsRole(role) }) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/cms/users/:id/reset-password', requireAuth, requireOwner, requireCsrf, async (req, res, next) => {
  try {
    const target = cmsAdminRecordForId(req.params.id);
    if (!target?.userId) return res.status(404).json({ error: 'USER_NOT_FOUND' });
    const temporary = temporaryPassword();
    await auth.api.setUserPassword({ body: { userId: target.userId, newPassword: temporary }, headers: fromNodeHeaders(req.headers) });
    await userSecurity.revokeUserSessions(target.userId);
    target.mustChangePassword = true;
    target.updatedAt = now();
    audit('auth.user.password.reset', req.cmsUser, { userId: target.userId });
    await writeStore();
    res.json({ ok: true, temporaryPassword: temporary, userId: target.userId });
  } catch (error) { next(error); }
});

app.post('/api/cms/users/:id/status', requireAuth, requireOwner, requireCsrf, async (req, res, next) => {
  try {
    const target = cmsAdminRecordForId(req.params.id);
    const disabled = Boolean(req.body?.disabled);
    if (!target?.userId) return res.status(404).json({ error: 'USER_NOT_FOUND' });
    if (target.role === 'owner') return res.status(409).json({ error: 'OWNER_CANNOT_BE_DISABLED' });
    const result = disabled
      ? await auth.api.banUser({ body: { userId: target.userId, banReason: 'Acceso revocado desde el CMS' }, headers: fromNodeHeaders(req.headers) })
      : await auth.api.unbanUser({ body: { userId: target.userId }, headers: fromNodeHeaders(req.headers) });
    target.banned = disabled;
    target.banReason = disabled ? 'Acceso revocado desde el CMS' : '';
    if (!disabled) target.deletedAt = null;
    target.updatedAt = now();
    audit(disabled ? 'auth.user.disable' : 'auth.user.enable', req.cmsUser, { userId: target.userId || target.id });
    writeStore();
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
    normalizePublicBrandCopy(store.settings.siteDescription),
    '',
    '## Páginas',
    ...inventory.pages.map((page) => `- [${page.title}](${absoluteSiteUrl(page.page)})`),
    '',
    '## Contacto',
    `- ${canonicalBrandEmail(store.settings.geo?.email) || ''}`,
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
app.use('/firma-assets', express.static(path.join(ROOT, 'firma-cms', 'assets'), { maxAge: '1h' }));
app.get('/cms-media/:filename', async (req, res, next) => {
  const filename = req.params.filename;
  if (!safeMediaFilename(filename)) return res.status(404).json({ error: 'MEDIA_NOT_FOUND' });
  const item = store.media.find((candidate) => candidate.filename === filename && !candidate.deletedAt);
  if (!item) return res.status(404).json({ error: 'MEDIA_NOT_FOUND' });
  if (item?.storage === 'replit-app-storage') {
    try {
      const result = await downloadStorageFile(filename);
      if (!result.ok) return res.status(404).json({ error: 'MEDIA_NOT_FOUND' });
      res.type(item.mime || 'application/octet-stream').send(result.value);
    } catch (error) {
      next(error);
    }
    return;
  }
  if (item.storage === 'local') return res.sendFile(filename, { root: MEDIA_DIR, dotfiles: 'deny' }, next);
  return res.status(404).json({ error: 'MEDIA_NOT_FOUND' });
});
app.use('/cms-media', (_req, res) => res.status(404).end());
app.use('/admin', express.static(ADMIN_DIR, { index: 'index.html', maxAge: 0 }));
// HTML and hashed bundles are versioned in the exported site. Keep the static
// layer revalidating so CMS publishes and bundle fixes appear immediately.
app.use(express.static(SITE_DIR, { index: false, maxAge: 0 }));

app.use((error, _req, res, _next) => {
  const status = error?.message === 'MEDIA_TYPE_NOT_ALLOWED' ? 415 : error?.code === 'LIMIT_FILE_SIZE' ? 413 : 500;
  safeLog('error', 'request.error', error);
  if (res.headersSent) return;
  res.status(status).json(publicFailure(error));
});

async function start() {
  await migrateAuthDatabase();
  await userSecurity.ready;
  if (authUsesPostgres) {
    const recovery = await recoverExistingOwner({
      pool: authDatabase,
      auth,
      authAdmins: store.authAdmins,
      ownerEmail: OWNER_EMAIL,
      password: DATA_SCOPE === 'production' ? process.env.CMS_OWNER_BOOTSTRAP_PASSWORD : '',
      persistNewOwner: remoteStoreVerified ? async (owner) => {
        store.authAdmins.push(owner);
        await writeStore();
      } : undefined
    });
    if (DATA_SCOPE === 'production' && !(await hasAuthUsers())) throw new Error('CMS_OWNER_BOOTSTRAP_REQUIRED');
    if (recovery.status === 'recovered' || recovery.status === 'created') console.log('[cms-auth] Cuenta propietaria guardada en PostgreSQL.');
  }
  enablePublicDiscovery(store, writeStore);
  const initialSetup = await setupRequired();
  setTimeout(() => importSiteMediaOnStart().catch((error) => console.error('[cms-storage] importación inicial falló', error.message)), 1200);
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[cms] Expresión Jurídica CMS en http://localhost:${PORT}`);
    console.log(`[cms] ${inventory.pages.length} páginas · ${inventory.fields.length} campos editables`);
    if (initialSetup) console.log('[cms] Primer arranque: el acceso inicial está protegido para la cuenta propietaria.');
  });
}

start().catch((error) => {
  safeLog('error', 'application.start.failed', error);
  if (authUsesPostgres) void authDatabase.end().catch(() => {});
  process.exitCode = 1;
});

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { load } from 'cheerio';
import { publicFailure, withLogContext } from './security-logging.mjs';

export function hostedHttps(env = process.env) {
  return env.NODE_ENV === 'production' || Boolean(env.REPL_ID || env.REPLIT_DEPLOYMENT_URL || env.REPLIT_DEV_DOMAIN) || /^https:\/\//i.test(env.BETTER_AUTH_URL || '');
}

function trustedHashes(root) {
  const hashes = new Set();
  // Hash only trusted application files, never HTML submitted through the CMS.
  for (const filename of ['sitio/index.html', 'public/admin/index.html']) {
    const file = path.join(root, filename);
    if (!fs.existsSync(file)) continue;
    const $ = load(fs.readFileSync(file, 'utf8'));
    $('script:not([src])').each((_, node) => {
      const text = $(node).text();
      if (text.trim()) hashes.add(`'sha256-${crypto.createHash('sha256').update(text).digest('base64')}'`);
    });
  }
  return [...hashes];
}

export function contentSecurityPolicy(root = process.cwd(), secure = hostedHttps()) {
  return [
    "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'self'", "form-action 'self' mailto:",
    `script-src 'self' ${trustedHashes(root).join(' ')} https://www.googletagmanager.com`, "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://www.google-analytics.com https://www.googletagmanager.com",
    "connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com https://www.googletagmanager.com",
    "media-src 'self' blob:", "worker-src 'self' blob:", "frame-src 'self' blob: https://www.google.com https://maps.google.com",
    ...(secure ? ['upgrade-insecure-requests'] : [])
  ].join('; ');
}

export function applicationCookie(value, secure) {
  if (typeof value !== 'string') return value;
  const cookie = value.split(';'), name = cookie[0].split('=')[0].trim();
  if (!/^(?:__Secure-|__Host-)?better-auth[.-]|^cms_csrf$/.test(name)) return value;
  if (secure && !cookie.some(part => /^\s*Secure\s*$/i.test(part))) cookie.push(' Secure');
  if (!cookie.some(part => /^\s*SameSite=/i.test(part))) cookie.push(' SameSite=Lax');
  if (name !== 'cms_csrf' && !cookie.some(part => /^\s*HttpOnly\s*$/i.test(part))) cookie.push(' HttpOnly');
  return cookie.join(';');
}

function origin(value) { try { return new URL(value).origin; } catch { return null; } }

export function securityMiddleware({ root = process.cwd(), getCanonicalBase = () => 'https://expresion-juridica-21-st.replit.app', env = process.env } = {}) {
  const secure = hostedHttps(env), policy = contentSecurityPolicy(root, secure);
  const configuredOrigins = [env.BETTER_AUTH_URL, env.REPLIT_DEPLOYMENT_URL, env.REPLIT_DEV_DOMAIN ? `https://${env.REPLIT_DEV_DOMAIN}` : null, ...(!secure ? [`http://localhost:${env.PORT || 3000}`, `http://127.0.0.1:${env.PORT || 3000}`] : [])].map(origin).filter(Boolean);
  return (req, res, next) => {
    const privateRoute = /^\/(?:admin|api)(?:\/|$)/.test(req.path) && req.path !== '/api/cms/public' && req.path !== '/api/public/contact';
    const setHeader = res.setHeader.bind(res);
    res.setHeader = (name, value) => {
      if (name.toLowerCase() === 'set-cookie') value = Array.isArray(value) ? value.map(item => applicationCookie(item, secure)) : applicationCookie(value, secure);
      if (privateRoute && name.toLowerCase() === 'cache-control') value = 'private, no-store, max-age=0';
      return setHeader(name, value);
    };
    const requestId = crypto.randomUUID();
    setHeader('X-Request-Id', requestId);
    setHeader('Content-Security-Policy', req.path.startsWith('/cms-media/') ? "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; sandbox; base-uri 'none'; form-action 'none'; frame-ancestors 'self'" : policy);
    setHeader('X-Content-Type-Options', 'nosniff'); setHeader('X-Frame-Options', 'SAMEORIGIN');
    setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (secure) setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    if (privateRoute) setHeader('Cache-Control', 'private, no-store, max-age=0');
    const json = res.json.bind(res);
    res.json = payload => {
      if (res.statusCode >= 400 && payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const safe = publicFailure(payload.error || payload.code);
        payload = { ...safe, ...(Number.isFinite(payload.retryAfterSeconds) ? { retryAfterSeconds: payload.retryAfterSeconds } : {}) };
      }
      return json(payload);
    };
    return withLogContext(requestId, () => {
      if (req.path.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const allowed = new Set([...configuredOrigins, origin(getCanonicalBase())].filter(Boolean));
        const suppliedOrigin = req.get('origin');
        if (req.get('sec-fetch-site') === 'cross-site' || suppliedOrigin && !allowed.has(origin(suppliedOrigin))) return res.status(403).json(publicFailure('ORIGIN_NOT_ALLOWED'));
      }
      return next();
    });
  };
}

const mediaTypes = new Map([
  ['.png', ['image/png']], ['.jpg', ['image/jpeg']], ['.jpeg', ['image/jpeg']], ['.webp', ['image/webp']], ['.avif', ['image/avif']], ['.gif', ['image/gif']], ['.svg', ['image/svg+xml']],
  ['.mp4', ['video/mp4']], ['.webm', ['video/webm']], ['.mov', ['video/quicktime']], ['.m4v', ['video/x-m4v', 'video/mp4']], ['.ogv', ['video/ogg']],
  ['.mp3', ['audio/mpeg']], ['.wav', ['audio/wav', 'audio/x-wav']], ['.ogg', ['audio/ogg']], ['.m4a', ['audio/mp4', 'audio/x-m4a']], ['.flac', ['audio/flac', 'audio/x-flac']],
  ['.pdf', ['application/pdf']], ['.ttf', ['font/ttf', 'application/x-font-ttf']], ['.otf', ['font/otf', 'application/x-font-opentype']], ['.woff', ['font/woff', 'application/font-woff']], ['.woff2', ['font/woff2']]
]);
export function allowedMedia(file) {
  const extension = path.extname(String(file.originalname || '')).toLowerCase();
  const allowed = mediaTypes.get(extension), mime = String(file.mimetype || '').toLowerCase();
  return Boolean(allowed && (allowed.includes(mime) || mime === 'application/octet-stream'));
}

export function safeMediaFilename(filename) {
  return typeof filename === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(filename);
}

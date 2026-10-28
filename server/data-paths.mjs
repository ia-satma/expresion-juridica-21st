import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const LEGACY_DATA_DIR = path.join(ROOT, 'data');
const LEGACY_MEDIA_DIR = path.join(ROOT, 'storage', 'media');
const inferredScope = process.env.REPLIT_DEPLOYMENT_URL || process.env.NODE_ENV === 'production' ? 'production' : 'development';
const requestedScope = String(process.env.CMS_DATA_SCOPE || inferredScope).trim().toLowerCase();
export const DATA_SCOPE = /^[a-z0-9_-]+$/.test(requestedScope) ? requestedScope : 'development';
export const DATA_DIR = path.join(LEGACY_DATA_DIR, DATA_SCOPE);
export const AUTH_DB_FILE = path.join(DATA_DIR, 'auth.sqlite');
export const STORE_FILE = path.join(DATA_DIR, 'cms.json');
export const SECRET_FILE = path.join(DATA_DIR, 'better-auth.secret');
export const MEDIA_DIR = path.join(ROOT, 'storage', 'media', DATA_SCOPE);

function copyFileIfMissing(source, target) {
  if (!fs.existsSync(source) || fs.existsSync(target)) return;
  fs.copyFileSync(source, target);
}

function copyDirectoryIfEmpty(source, target) {
  if (!fs.existsSync(source) || fs.readdirSync(target).length) return;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name.startsWith('._') || entry.name === '.DS_Store') continue;
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    // The scoped media directory lives inside the legacy media directory.
    // Never recurse into the destination while doing the one-time migration.
    if (path.resolve(sourcePath) === path.resolve(target)) continue;
    if (entry.isDirectory()) {
      fs.mkdirSync(targetPath, { recursive: true });
      copyDirectoryIfEmpty(sourcePath, targetPath);
    } else {
      copyFileIfMissing(sourcePath, targetPath);
    }
  }
}

export function ensureDataScope() {
  fs.mkdirSync(LEGACY_DATA_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(MEDIA_DIR), { recursive: true });
  fs.mkdirSync(MEDIA_DIR, { recursive: true });

  // One-time migration from the original unscoped layout. Future writes stay
  // inside the selected environment and never mix development with production.
  for (const suffix of ['', '-wal', '-shm']) copyFileIfMissing(path.join(LEGACY_DATA_DIR, `auth.sqlite${suffix}`), path.join(DATA_DIR, `auth.sqlite${suffix}`));
  copyFileIfMissing(path.join(LEGACY_DATA_DIR, 'cms.json'), path.join(DATA_DIR, 'cms.json'));
  copyFileIfMissing(path.join(LEGACY_DATA_DIR, 'better-auth.secret'), path.join(DATA_DIR, 'better-auth.secret'));
  copyDirectoryIfEmpty(LEGACY_MEDIA_DIR, MEDIA_DIR);
}

ensureDataScope();

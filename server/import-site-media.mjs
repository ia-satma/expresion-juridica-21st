import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_SCOPE, STORE_FILE } from './data-paths.mjs';
import { appStorageEnabled, appStorageScope, uploadFile } from './app-storage.mjs';

const ROOT = process.cwd();
const SITE_DIR = path.join(ROOT, 'sitio');
const SIGNATURE_DIR = path.join(ROOT, 'firma-cms', 'assets');
const extensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.svg', '.mp4', '.webm', '.mp3', '.wav', '.pdf']);

function filesIn(directory, prefix = '') {
  const files = [];
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('._') || entry.name === '.DS_Store') continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.join(prefix, entry.name).split(path.sep).join('/');
    if (entry.isDirectory()) files.push(...filesIn(absolute, relative));
    else if (extensions.has(path.extname(entry.name).toLowerCase())) files.push({ absolute, relative });
  }
  return files;
}

function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  return ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.pdf': 'application/pdf' })[ext] || 'application/octet-stream';
}

function folderFor(sourcePath) {
  if (sourcePath.startsWith('img/')) return 'Imágenes del sitio';
  if (sourcePath.startsWith('video/')) return 'Videos del sitio';
  if (sourcePath.startsWith('firma-cms/')) return 'Firmas de correo';
  return 'Marca';
}

if (!appStorageEnabled) {
  console.error('[cms-storage] App Storage no está disponible en este entorno.');
  process.exitCode = 1;
} else if (!fs.existsSync(STORE_FILE)) {
  console.error(`[cms-storage] No existe ${STORE_FILE}. Inicia el CMS una vez antes de importar.`);
  process.exitCode = 1;
} else {
  const store = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  store.media = Array.isArray(store.media) ? store.media : [];
  const sourceFiles = [...filesIn(SITE_DIR), ...filesIn(SIGNATURE_DIR, 'firma-cms/assets')];
  let imported = 0;
  for (const file of sourceFiles) {
    if (store.media.some((item) => !item.deletedAt && item.sourcePath === file.relative)) continue;
    const filename = `site-${file.relative.replace(/[^a-zA-Z0-9._-]+/g, '-')}`;
    const result = await uploadFile(filename, file.absolute);
    if (!result.ok) {
      console.error(`[cms-storage] No se pudo cargar ${file.relative}: ${result.error}`);
      process.exitCode = 1;
      break;
    }
    store.media.push({
      id: crypto.randomUUID(),
      url: `/cms-media/${encodeURIComponent(filename)}`,
      filename,
      storage: 'replit-app-storage',
      storageScope: appStorageScope,
      originalName: path.basename(file.relative),
      sourcePath: file.relative,
      mime: mimeFor(file.relative),
      size: fs.statSync(file.absolute).size,
      folder: folderFor(file.relative),
      alt: '',
      caption: `Importado del sitio · ${file.relative}`,
      createdAt: new Date().toISOString(),
      uploadedBy: 'system'
    });
    imported += 1;
  }
  if (imported) {
    const temp = `${STORE_FILE}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`);
    fs.renameSync(temp, STORE_FILE);
  }
  console.log(JSON.stringify({ ok: true, imported, total: store.media.filter((item) => !item.deletedAt).length, scope: DATA_SCOPE, storage: appStorageScope }));
}

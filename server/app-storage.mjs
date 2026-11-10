import fs from 'node:fs';
import { Client } from '@replit/object-storage';
import { DATA_SCOPE } from './data-paths.mjs';

const bucketId = process.env.REPLIT_OBJECT_STORAGE_BUCKET_ID || process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
let client = null;

export const appStorageEnabled = Boolean(process.env.REPL_ID || process.env.REPLIT_DEPLOYMENT_URL || process.env.REPLIT_DEV_DOMAIN);
export const appStorageScope = DATA_SCOPE;

function objectKey(filename) {
  return `${DATA_SCOPE}/${filename}`;
}

function resultError(result) {
  if (!result || result.ok !== false) return null;
  const status = result.error?.code || result.error?.statusCode || result.error?.status;
  const message = result.error?.message || String(result.error || '');
  return status === 404 || /not[ _]found|no such object|404/i.test(message) ? 'APP_STORAGE_NOT_FOUND' : 'APP_STORAGE_UNAVAILABLE';
}

async function storageOperation(operation) {
  if (!appStorageEnabled) return { ok: false, error: 'APP_STORAGE_NOT_CONFIGURED' };
  let current;
  try {
    // The SDK starts default bucket discovery in its constructor. Observe it
    // immediately through the operation so a missing bucket cannot crash startup.
    current = client ??= new Client(bucketId ? { bucketId } : undefined);
    const result = await operation(current);
    const error = resultError(result);
    return error ? { ok: false, error } : result;
  } catch {
    if (client === current) client = null;
    return { ok: false, error: 'APP_STORAGE_UNAVAILABLE' };
  }
}

export async function uploadFile(filename, localPath) {
  const key = objectKey(filename);
  const result = await storageOperation(storage => storage.uploadFromFilename(key, localPath));
  return result.ok ? { ok: true, key } : result;
}

export async function downloadFile(filename) {
  const result = await storageOperation(storage => storage.downloadAsBytes(objectKey(filename)));
  if (!result.ok) return result;
  // The Replit SDK forwards the [Buffer] tuple returned by Google Storage.
  const bytes = Array.isArray(result.value) ? result.value[0] : result.value;
  return Buffer.isBuffer(bytes) ? { ok: true, value: bytes } : { ok: false, error: 'APP_STORAGE_UNAVAILABLE' };
}

export async function deleteFile(filename) {
  const result = await storageOperation(storage => storage.delete(objectKey(filename)));
  return result.ok ? { ok: true } : result;
}

export function listFiles(prefix) {
  return storageOperation(storage => storage.list({ prefix: objectKey(prefix) }));
}

export function removeLocalFile(filePath) {
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (error) { console.error('[cms-storage] no se pudo limpiar temporal', error.message); }
}

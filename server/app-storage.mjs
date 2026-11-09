import fs from 'node:fs';
import { Client } from '@replit/object-storage';
import { DATA_SCOPE } from './data-paths.mjs';

const isReplit = Boolean(process.env.REPL_ID || process.env.REPLIT_DEPLOYMENT_URL || process.env.REPLIT_DEV_DOMAIN);
let client = null;
if (isReplit) {
  try {
    // Replit exposes the default bucket automatically. A bucket ID can be
    // supplied when the project has an explicitly named App Storage bucket.
    const bucketId = process.env.REPLIT_OBJECT_STORAGE_BUCKET_ID || process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    client = new Client(bucketId ? { bucketId } : undefined);
  } catch (error) {
    console.error('[cms-storage] no se pudo inicializar Replit App Storage', error.message);
  }
}

export const appStorageEnabled = Boolean(client);
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

export async function uploadFile(filename, localPath) {
  if (!client) return { ok: false, error: 'APP_STORAGE_NOT_CONFIGURED' };
  const key = objectKey(filename);
  const result = await client.uploadFromFilename(key, localPath);
  const error = resultError(result);
  if (error) return { ok: false, error };
  return { ok: true, key };
}

export async function downloadFile(filename) {
  if (!client) return { ok: false, error: 'APP_STORAGE_NOT_CONFIGURED' };
  const result = await client.downloadAsBytes(objectKey(filename));
  const error = resultError(result);
  if (error) return { ok: false, error };
  return { ok: true, value: Buffer.from(result.value) };
}

export async function deleteFile(filename) {
  if (!client) return { ok: false, error: 'APP_STORAGE_NOT_CONFIGURED' };
  const result = await client.delete(objectKey(filename));
  const error = resultError(result);
  return error ? { ok: false, error } : { ok: true };
}

export function removeLocalFile(filePath) {
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (error) { console.error('[cms-storage] no se pudo limpiar temporal', error.message); }
}

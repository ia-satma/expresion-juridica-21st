import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, DATA_SCOPE } from './data-paths.mjs';
import { appStorageEnabled, uploadFile, downloadFile, listFiles } from './app-storage.mjs';

const ROOT = path.join(DATA_DIR, 'studio-state');
function keyFor(collection, id) {
  if (!['posts', 'documents', 'presentations', 'jobs', 'owners', 'submissions'].includes(collection) || !/^[a-z0-9-]{16,80}$/.test(id)) throw new Error('STUDIO_STATE_KEY_INVALID');
  return `studio-state/${collection}/${id}.json`;
}
export async function writeStudioState(collection, id, value) {
  const relative = keyFor(collection, id), local = path.join(ROOT, collection, `${id}.json`);
  await fs.mkdir(path.dirname(local), { recursive: true });
  const temporary = `${local}.${crypto.randomUUID()}.stage`; await fs.writeFile(temporary, JSON.stringify(value)); await fs.rename(temporary, local);
  if (appStorageEnabled) { const result = await uploadFile(relative, local); if (!result.ok) throw new Error('STUDIO_STORAGE_UNAVAILABLE'); }
}
export async function readStudioState(collection, id) {
  let relative;
  try { relative = keyFor(collection, id); } catch { return null; }
  if (appStorageEnabled) {
    const result = await downloadFile(relative);
    if (result.ok) return JSON.parse(result.value.toString('utf8'));
    if (/not[ _]found|no such object|404/i.test(result.error || '')) return null;
    throw new Error('STUDIO_STORAGE_UNAVAILABLE');
  }
  try { return JSON.parse(await fs.readFile(path.join(ROOT, collection, `${id}.json`), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function listStudioRecords(collection, fallback = []) {
  if (!['posts', 'documents', 'presentations', 'submissions'].includes(collection)) throw new Error('STUDIO_STATE_KEY_INVALID');
  let ids;
  if (appStorageEnabled) {
    const prefix = `studio-state/${collection}/`;
    const result = await listFiles(prefix);
    if (!result.ok) throw new Error('STUDIO_STORAGE_UNAVAILABLE');
    const scopedPrefixLength = DATA_SCOPE.length + 1 + prefix.length;
    ids = result.value.map(item => item.name.slice(scopedPrefixLength).replace(/\.json$/, '')).filter(id => /^[a-f0-9-]{36}$/.test(id));
  } else {
    ids = (await fs.readdir(path.join(ROOT, collection)).catch(error => { if (error.code === 'ENOENT') return []; throw error; })).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5));
  }
  const records = new Map(fallback.map(item => [item.id, item]));
  for (let start = 0; start < ids.length; start += 6) {
    const batch = await Promise.all(ids.slice(start, start + 6).map(id => readStudioState(collection, id)));
    for (const record of batch) if (record) records.set(record.id, record);
  }
  return [...records.values()].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}
export const listStudioPosts = fallback => listStudioRecords('posts', fallback);

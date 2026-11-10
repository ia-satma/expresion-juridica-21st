import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'ej-replit-storage-'));
const storageModule = new URL('../server/app-storage.mjs', import.meta.url).href;
const studioModule = new URL('../server/studio-state.mjs', import.meta.url).href;
const googleStorageModule = import.meta.resolve('@google-cloud/storage');

try {
  const child = spawnSync(process.execPath, ['--unhandled-rejections=strict', '--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    import fs from 'node:fs/promises';
    import { Storage } from ${JSON.stringify(googleStorageModule)};

    let lookups = 0;
    let bucketReady = false;
    globalThis.fetch = async url => {
      assert.equal(String(url), 'http://127.0.0.1:1106/object-storage/default-bucket');
      lookups += 1;
      return bucketReady ? Response.json({ bucketId: 'test-bucket' }) : new Response(null, { status: 404 });
    };

    const { downloadFile, uploadFile } = await import(${JSON.stringify(storageModule)});
    const { listStudioRecords, readStudioState, writeStudioState } = await import(${JSON.stringify(studioModule)});
    assert.deepEqual(await downloadFile('cms.json'), { ok: false, error: 'APP_STORAGE_UNAVAILABLE' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(lookups, 1, 'Importing Studio must not start a second bucket lookup');

    await assert.rejects(listStudioRecords('documents'), { message: 'STUDIO_STORAGE_UNAVAILABLE' });
    assert.equal(lookups, 2, 'A later operation must retry default bucket discovery');

    // Mock the Google boundary while keeping the Replit SDK's real result shape.
    const objects = new Map();
    Storage.prototype.bucket = function (id) {
      assert.equal(id, 'test-bucket');
      return {
        async upload(filename, { destination }) { objects.set(destination, await fs.readFile(filename)); },
        async getFiles({ prefix }) { return [[...objects.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name }))]; },
        file(name) { return { async download() { return [objects.get(name)]; } }; }
      };
    };
    bucketReady = true;
    const record = { id: '74a659f2-11e2-4ee6-9cee-081a33a89025', title: 'Presentation', createdAt: '2026-01-01T00:00:00Z' };
    await writeStudioState('presentations', record.id, record);
    assert.deepEqual(await readStudioState('presentations', record.id), record);
    assert.deepEqual(await listStudioRecords('presentations'), [record]);

    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    const imageKey = 'generated-presentations/' + record.id + '/slide-1.png';
    await fs.writeFile('slide-1.png', image);
    assert.deepEqual(await uploadFile(imageKey, 'slide-1.png'), { ok: true, key: 'test/' + imageKey });
    assert.deepEqual(await downloadFile(imageKey), { ok: true, value: image });
    assert.equal(lookups, 3, 'Successful downloads and history reuse the same bucket client');
  `], {
    cwd: fixture,
    env: { REPL_ID: 'storage-fixture', CMS_DATA_SCOPE: 'test' },
    encoding: 'utf8',
    timeout: 10000
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  console.log('check-replit-storage: PASS');
} finally {
  await fs.rm(fixture, { recursive: true, force: true });
}

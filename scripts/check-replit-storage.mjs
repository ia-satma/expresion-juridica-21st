import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'ej-replit-storage-'));
const storageModule = new URL('../server/app-storage.mjs', import.meta.url).href;
const studioModule = new URL('../server/studio-state.mjs', import.meta.url).href;

try {
  const child = spawnSync(process.execPath, ['--unhandled-rejections=strict', '--input-type=module', '--eval', `
    import assert from 'node:assert/strict';

    let lookups = 0;
    globalThis.fetch = async url => {
      assert.equal(String(url), 'http://127.0.0.1:1106/object-storage/default-bucket');
      lookups += 1;
      return new Response(null, { status: 404 });
    };

    const { downloadFile } = await import(${JSON.stringify(storageModule)});
    const { listStudioRecords } = await import(${JSON.stringify(studioModule)});
    assert.deepEqual(await downloadFile('cms.json'), { ok: false, error: 'APP_STORAGE_UNAVAILABLE' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(lookups, 1, 'Importing Studio must not start a second bucket lookup');

    await assert.rejects(listStudioRecords('documents'), { message: 'STUDIO_STORAGE_UNAVAILABLE' });
    assert.equal(lookups, 2, 'A later operation must retry default bucket discovery');
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

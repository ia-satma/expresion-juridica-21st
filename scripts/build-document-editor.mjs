import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
const result = await build({ entryPoints: ['scripts/document-editor-entry.mjs'], outfile: 'public/admin/vendor/tiptap.js', bundle: true, format: 'esm', minify: true, target: ['es2022'], legalComments: 'eof', metafile: true, banner: { js: '/* Tiptap and dependencies: see THIRD_PARTY_NOTICES.txt in this directory. */' } });
const roots = [...new Set(Object.keys(result.metafile.inputs).filter(file => file.startsWith('node_modules/')).map(file => { const parts = file.split('/'); return parts[1].startsWith('@') ? parts.slice(0, 3).join('/') : parts.slice(0, 2).join('/'); }))];
const notices = [];
for (const root of roots) {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const license = (await fs.readdir(root)).find(file => /^licen[cs]e(\.md|\.txt)?$/i.test(file));
  if (!license) throw new Error(`Missing license notice: ${pkg.name}`);
  notices.push(`${pkg.name} ${pkg.version}\n${await fs.readFile(path.join(root, license), 'utf8')}`);
}
await fs.writeFile('public/admin/vendor/THIRD_PARTY_NOTICES.txt', notices.join('\n\n---\n\n'));
console.log('Editor de documentos listo');

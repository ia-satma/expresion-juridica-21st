import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import sharp from 'sharp';
import PptxGenJS from 'pptxgenjs';
import { fileURLToPath } from 'node:url';
import { repairPresentationImageSizing } from '../server/presentation-images.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = `${root}data/local-build-work/ppt-image-check`; await fs.mkdir(output, { recursive: true });
const image = await sharp(Buffer.from('<svg width="900" height="600" xmlns="http://www.w3.org/2000/svg"><rect width="900" height="600" fill="#D9BC88"/><circle cx="450" cy="300" r="140" fill="#141A3A"/></svg>')).png().toBuffer();
const p = new PptxGenJS(); p.layout = 'LAYOUT_WIDE';
for (const [w, h] of [[3, 4], [6, 2], [4, 4]]) {
  const slide = p.addSlide(); slide.addText('Texto editable e imagen con proporciones correctas', { x: 1, y: .5, w: 10, h: .4 });
  // Reproduce the old export: it passed the frame ratio as source dimensions.
  slide.addImage({ data: `image/png;base64,${image.toString('base64')}`, x: 2, y: 1.5, w, h, sizing: { type: 'cover', w, h } });
}
const original = Buffer.from(await p.write({ outputType: 'nodebuffer' }));
const repaired = await repairPresentationImageSizing(original); assert.equal(repaired.changedPictures, 3);
const before = await JSZip.loadAsync(original), after = await JSZip.loadAsync(repaired.buffer);
for (let index = 1; index <= 3; index++) {
  const name = `ppt/slides/slide${index}.xml`, xml = await after.file(name).async('string');
  const source = xml.match(/<a:srcRect l="(\d+)" r="(\d+)" t="(\d+)" b="(\d+)"/).slice(1).map(Number);
  const extent = xml.match(/<p:pic\b[\s\S]*?<a:xfrm\b[^>]*>[\s\S]*?<a:ext cx="(\d+)" cy="(\d+)"/).slice(1).map(Number);
  const visibleRatio = 900 * (1 - (source[0] + source[1]) / 100000) / (600 * (1 - (source[2] + source[3]) / 100000));
  assert(Math.abs(visibleRatio / (extent[0] / extent[1]) - 1) < .0001, 'Visible photo and frame must have the same aspect ratio');
  assert.match(xml, /Texto editable/);
}
for (const name of Object.keys(before.files).filter(name => name.startsWith('ppt/media/') && !before.files[name].dir)) assert.deepEqual(await after.file(name).async('nodebuffer'), await before.file(name).async('nodebuffer'), 'Keep original editable image bytes');
assert.equal((await repairPresentationImageSizing(repaired.buffer)).changedPictures, 0, 'Repeated downloads must not change a corrected file');
await fs.writeFile(`${output}/image-proportions.pptx`, repaired.buffer);
console.log(JSON.stringify({ passed: true, portraitLandscapeAndSquare: true, originalMediaPreserved: true, repeatableRepair: true, output }));

import path from 'node:path';
import JSZip from 'jszip';
import sharp from 'sharp';

export function imageCoverCrop(width, height, frameWidth, frameHeight) {
  const imageRatio = width / height, frameRatio = frameWidth / frameHeight;
  const horizontal = imageRatio > frameRatio ? Math.round((1 - frameRatio / imageRatio) * 50000) : 0;
  const vertical = imageRatio < frameRatio ? Math.round((1 - imageRatio / frameRatio) * 50000) : 0;
  return { l: horizontal, r: horizontal, t: vertical, b: vertical };
}

// Repair the crop metadata only. Keep original media, editable Office objects,
// notes, fonts and the stored source file intact, including older CMS exports.
export async function repairPresentationImageSizing(buffer) {
  const zip = await JSZip.loadAsync(buffer), dimensions = new Map();
  let changedPictures = 0;
  for (const slideName of Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))) {
    const original = await zip.file(slideName).async('string');
    const relation = zip.file(`ppt/slides/_rels/${path.posix.basename(slideName)}.rels`);
    if (!relation) continue;
    const targets = new Map();
    for (const match of (await relation.async('string')).matchAll(/<Relationship\b[^>]*\/>/g)) {
      const id = match[0].match(/\bId="([^"]+)"/)?.[1], target = match[0].match(/\bTarget="([^"]+)"/)?.[1];
      if (id && target) targets.set(id, path.posix.normalize(path.posix.join('ppt/slides', target)));
    }
    let updated = original;
    for (const match of original.matchAll(/<p:pic\b[\s\S]*?<\/p:pic>/g)) {
      const picture = match[0], id = picture.match(/<a:blip\b[^>]*\br:embed="([^"]+)"/)?.[1];
      const target = targets.get(id), extent = picture.match(/<a:xfrm\b[^>]*>[\s\S]*?<a:ext\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
      if (!target?.startsWith('ppt/media/') || !extent || !zip.file(target)) continue;
      if (!dimensions.has(target)) {
        try { dimensions.set(target, await sharp(await zip.file(target).async('nodebuffer')).metadata()); }
        catch { dimensions.set(target, null); }
      }
      const image = dimensions.get(target);
      if (!image?.width || !image.height || !Number(extent[1]) || !Number(extent[2])) continue;
      const crop = imageCoverCrop(image.width, image.height, Number(extent[1]), Number(extent[2]));
      const src = `<a:srcRect l="${crop.l}" r="${crop.r}" t="${crop.t}" b="${crop.b}"/>`;
      const old = picture.match(/<a:srcRect\b[^>]*\/>/)?.[0];
      if (old && ['l', 'r', 't', 'b'].every(key => Number(old.match(new RegExp(`\\b${key}="(-?\\d+)"`))?.[1] || 0) === crop[key])) continue;
      const repaired = old ? picture.replace(old, src) : picture.replace(/(<p:blipFill\b[^>]*>[\s\S]*?)(<a:stretch\b)/, `$1${src}$2`);
      if (repaired !== picture) { updated = updated.replace(picture, repaired); changedPictures++; }
    }
    if (updated !== original) zip.file(slideName, updated);
  }
  return { buffer: changedPictures ? await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) : buffer, changedPictures };
}

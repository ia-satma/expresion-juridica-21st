import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export const EJ_BRAND = Object.freeze({
  id: 'ej-manual-2026', name: 'Expresión Jurídica · Manual institucional',
  navy: '#141A3A', night: '#0B0F1E', gold: '#D9BC88', gray: '#DADADA', paper: '#F4F4F4', white: '#FFFFFF',
  headingFont: 'Libre Caslon Text', headingItalic: true, bodyFont: 'Bahnschrift Light', bodyWeight: 300,
  pptHeadingFont: 'Libre Caslon Text', pptBodyFont: 'Bahnschrift Light',
  source: 'EJ-MANUAL.pdf · páginas 22, 24, 25 y 27; tarjeta y hoja membretada',
  rules: 'Usar el logotipo original completo y su proporción; no recolorear, estirar ni redibujar. Márgenes amplios. Títulos en Libre Caslon Text Italic. Texto en Bahnschrift Light. Azul predominante, dorado como acento, gris y blanco de apoyo. Hilo fino con un único quiebre y un punto final.'
});
let assetsPromise;
export async function presentationBrandAssets() {
  if (!assetsPromise) assetsPromise = (async () => {
    const root = process.cwd();
    const logo = await sharp(path.join(root, 'sitio/marca/logo-original.png')).resize(480, 442, { fit: 'inside' }).png().toBuffer();
    const watermark = await sharp(logo).ensureAlpha().linear([1, 1, 1, .035], [0, 0, 0, 0]).png().toBuffer();
    return {
      logo, watermark,
      fonts: [
        { path: path.join(root, 'server/assets/ej-brand/bahnschrift-light.ttf'), family: 'Bahnschrift Light', pptFamily: 'Bahnschrift Light' },
        { path: path.join(root, 'server/assets/ej-brand/libre-caslon-italic.ttf'), family: 'Libre Caslon Text', pptFamily: 'Libre Caslon Text' }
      ]
    };
  })();
  return assetsPromise;
}

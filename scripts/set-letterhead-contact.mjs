import fs from 'node:fs/promises';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import { BRAND_CONTACT } from '../server/brand-contact.mjs';

const target = process.argv[2];
if (!target) throw new Error('Provide the letterhead PDF path');
const pdf = await PDFDocument.load(await fs.readFile(target)); pdf.registerFontkit(fontkit);
const font = await pdf.embedFont(await fs.readFile(path.join(process.cwd(), 'server/assets/ej-brand/bahnschrift-light.ttf')), { subset: true });
// Original contact baseline and type size from the supplied Illustrator page.
pdf.getPage(0).drawText(BRAND_CONTACT.email, { x: 195.7437, y: 747.7464, size: 11.7889, font, color: rgb(20 / 255, 26 / 255, 58 / 255) });
await fs.writeFile(target, await pdf.save());

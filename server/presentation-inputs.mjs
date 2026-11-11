import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { PDFParse } from 'pdf-parse';
import sharp from 'sharp';

export const MAX_PRESENTATION_FILE_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_SOURCE_CHARS = 120000;
export const MAX_DOCUMENT_FILE_BYTES = MAX_PRESENTATION_FILE_BYTES;
export const MAX_DOCUMENT_TOTAL_BYTES = MAX_TOTAL_BYTES;
export const MAX_DOCUMENT_SOURCE_CHARS = 200000;
export function presentationInputError(message, code = 'PRESENTATION_INPUT_INVALID', status = 422) {
  return Object.assign(new Error(message), { code, status });
}

async function readDocument(file) {
  const extension = path.extname(file.originalname || '').toLowerCase();
  if (['.txt', '.md'].includes(extension)) return fs.readFile(file.path, 'utf8');
  if (extension === '.docx') {
    const zip = await JSZip.loadAsync(await fs.readFile(file.path));
    const entries = Object.values(zip.files);
    if (entries.length > 5000 || entries.reduce((total, item) => total + (item._data?.uncompressedSize || 0), 0) > 40 * 1024 * 1024) throw presentationInputError('El DOCX contiene demasiado contenido descomprimido. Divide el documento.');
    return (await mammoth.extractRawText({ path: file.path })).value;
  }
  if (extension === '.pdf') {
    const parser = new PDFParse({ data: new Uint8Array(await fs.readFile(file.path)), isEvalSupported: false });
    try {
      const info = await parser.getInfo();
      if (info.total > 150) throw presentationInputError('El PDF supera 150 páginas. Divide el documento antes de subirlo.');
      return (await parser.getText()).text;
    } finally { await parser.destroy(); }
  }
  throw presentationInputError('Sube documentos PDF, DOCX, TXT o Markdown.');
}

export async function prepareDocumentInputs(files = {}) {
  const documents = files.documents || [];
  if (documents.reduce((total, file) => total + file.size, 0) > MAX_DOCUMENT_TOTAL_BYTES) {
    throw presentationInputError('Los archivos superan 200 MB en total. Reduce la selección.', 'DOCUMENT_FILES_TOO_LARGE', 413);
  }
  const parts = [];
  const documentNames = [];
  for (const file of documents) {
    let extracted;
    try { extracted = await readDocument(file); } catch (error) {
      if (error?.code) throw error;
      throw presentationInputError(`No se pudo leer ${file.originalname}. Usa un DOCX o PDF con texto seleccionable.`, 'DOCUMENT_FILE_EMPTY');
    }
    const text = String(extracted || '').replace(/\u0000/g, '').trim();
    if (!text) throw presentationInputError(`No se pudo extraer texto de ${file.originalname}. Usa un DOCX o PDF con texto seleccionable.`, 'DOCUMENT_FILE_EMPTY');
    parts.push(`DOCUMENTO: ${file.originalname}\n${text}`);
    documentNames.push(file.originalname);
    if (parts.join('\n\n').length > MAX_DOCUMENT_SOURCE_CHARS) {
      throw presentationInputError('El texto de los documentos supera 200 000 caracteres. Reduce la selección.', 'DOCUMENT_INPUT_INVALID', 400);
    }
  }
  return { sourceText: parts.join('\n\n'), documentNames };
}

export async function preparePresentationInputs(files = {}) {
  const documents = files.documents || [];
  const supportImages = files.supportImages || [];
  const all = [...documents, ...supportImages];
  if (all.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_BYTES) throw presentationInputError('Los archivos superan 200 MB en total. Reduce la selección.', 'PRESENTATION_FILES_TOO_LARGE', 413);
  const parts = [];
  const documentNames = [];
  for (const file of documents) {
    const text = (await readDocument(file)).replace(/\u0000/g, '').trim();
    if (text.length < 15) throw presentationInputError(`No se pudo leer texto de ${file.originalname}. Usa un documento con texto seleccionable.`);
    parts.push(`DOCUMENTO: ${file.originalname}\n${text}`);
    documentNames.push(file.originalname);
    if (parts.join('\n\n').length > MAX_SOURCE_CHARS) throw presentationInputError('El texto de los documentos supera 120 000 caracteres. Reduce la selección.');
  }
  const images = [];
  for (const file of supportImages) {
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(file.originalname || '').toLowerCase())) throw presentationInputError('Las imágenes de apoyo deben ser PNG, JPG o WebP.');
    const buffer = await sharp(file.path, { limitInputPixels: 40000000 }).rotate().resize(1600, 900, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    images.push({ buffer, name: file.originalname });
  }
  return { sourceText: parts.join('\n\n'), documentNames, supportImages: images };
}

export async function cleanupPresentationInputs(files = {}) {
  await Promise.all(Object.values(files).flat().map(file => fs.unlink(file.path).catch(() => {})));
}

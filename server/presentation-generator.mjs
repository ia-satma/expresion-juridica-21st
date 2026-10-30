import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import PptxGenJSImport from 'pptxgenjs';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { appStorageEnabled, uploadFile } from './app-storage.mjs';

const PptxGenJS = PptxGenJSImport?.default ?? PptxGenJSImport;
const WORK_DIR = path.join(process.cwd(), 'data', 'generated-presentations');
const COLORS = { navy: '#0C112B', gold: '#A98245', cream: '#F7F4EE', paper: '#FFFDFA', ink: '#16191D', muted: '#646A70' };
const clean = (v, n = 10000) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, n);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const color = (v) => /^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toUpperCase() : COLORS.gold;
const slug = (v) => clean(v, 70).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 55) || 'presentacion';
function lines(v, n = 60, max = 5) {
  const out = []; let line = '';
  for (const word of clean(v, 1200).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > n && line) { out.push(line); line = word; } else line = next;
    if (out.length >= max) break;
  }
  if (line && out.length < max) out.push(line);
  return out;
}
function fallback(topic, source, count, lang) {
  const title = clean(topic, 160) || (lang === 'en' ? 'Strategic presentation' : 'Presentación estratégica');
  const pieces = clean(source, 60000).split(/\n{2,}|(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ])/).map((x) => clean(x, 500)).filter(Boolean);
  const base = pieces.length ? pieces : ['Contexto y oportunidad que deben revisarse.', 'Propuesta organizada en acciones claras y medibles.', 'Impacto esperado, responsables y siguiente paso.'];
  const slides = [{ kind: 'title', eyebrow: 'EXPRESIÓN JURÍDICA', title, body: lang === 'en' ? 'OpenAI assisted outline · human review required' : 'Esquema asistido por OpenAI · requiere revisión humana', bullets: [] }];
  for (let i = 1; i < count - 1; i += 1) slides.push({ kind: 'content', eyebrow: `0${i}`, title: lang === 'en' ? `Key point ${i}` : `Punto clave ${i}`, body: base[(i - 1) % base.length], bullets: [lang === 'en' ? 'Review the source and confirm the claim.' : 'Revisar la fuente y confirmar la afirmación.', lang === 'en' ? 'Define the next action.' : 'Definir el siguiente paso.'] });
  slides.push({ kind: 'closing', eyebrow: 'SIGUIENTE PASO', title: lang === 'en' ? 'Review, adjust and share' : 'Revisar, ajustar y compartir', body: lang === 'en' ? 'Generated files remain in CMS history.' : 'Los archivos quedan en el historial del CMS.', bullets: [] });
  return { title, subtitle: lang === 'en' ? 'Generated with review first' : 'Generada con revisión humana', slides };
}
const schema = { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, subtitle: { type: 'string' }, slides: { type: 'array', minItems: 3, maxItems: 20, items: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', enum: ['title', 'content', 'closing'] }, eyebrow: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, bullets: { type: 'array', maxItems: 5, items: { type: 'string' } } }, required: ['kind', 'eyebrow', 'title', 'body', 'bullets'] } } }, required: ['title', 'subtitle', 'slides'] };
function normalize(o, fb, count) {
  if (!o || !Array.isArray(o.slides)) return fb;
  const slides = o.slides.slice(0, count).map((s, i) => ({ kind: ['title', 'content', 'closing'].includes(s.kind) ? s.kind : (i === 0 ? 'title' : i === count - 1 ? 'closing' : 'content'), eyebrow: clean(s.eyebrow, 80), title: clean(s.title, 180), body: clean(s.body, 700), bullets: Array.isArray(s.bullets) ? s.bullets.map((x) => clean(x, 180)).filter(Boolean).slice(0, 5) : [] })).filter((s) => s.title || s.body);
  while (slides.length < count) slides.push(...fb.slides.slice(slides.length, count));
  return { title: clean(o.title, 180) || fb.title, subtitle: clean(o.subtitle, 260) || fb.subtitle, slides };
}
async function outline({ topic, source, count, lang }) {
  const fb = fallback(topic, source, count, lang);
  const key = process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!key) return { outline: fb, aiUsed: false, model: null, warning: 'OPENAI_API_KEY_MISSING' };
  const base = (process.env.OPENAI_BASE_URL || process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.OPENAI_PRESENTATION_MODEL || process.env.OPENAI_MODEL || 'gpt-5.4-mini';
  const system = lang === 'en' ? 'Create an accurate corporate presentation outline. Do not invent facts. Return JSON only.' : 'Crea un esquema corporativo preciso. No inventes hechos. Devuelve solo JSON.';
  const body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify({ topic, source: clean(source, 60000), slideCount: count, language: lang, outputSchema: schema }) }], response_format: { type: 'json_object' } };
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 60000);
  try {
    const r = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal: ctl.signal });
    if (!r.ok) throw new Error(`OPENAI_HTTP_${r.status}`);
    const p = await r.json(); const text = p.choices?.[0]?.message?.content || '';
    return { outline: normalize(JSON.parse(text.replace(/^```json|```$/gi, '').trim()), fb, count), aiUsed: true, model };
  } catch (e) {
    console.warn('[presentation-agent] OpenAI fallback', e.message);
    return { outline: fb, aiUsed: false, model, warning: e.name === 'AbortError' ? 'OPENAI_TIMEOUT' : e.message };
  } finally { clearTimeout(timer); }
}
function svg({ s, i, total, title, accent, style }) {
  const dark = style === 'dark' || (style === 'auto' && i % 3 === 2); const bg = dark ? COLORS.navy : (i % 2 ? COLORS.paper : COLORS.cream); const fg = dark ? '#FFFFFF' : COLORS.ink; const muted = dark ? '#C8CBD4' : COLORS.muted; let y = s.kind === 'title' ? 385 : 275;
  const t = [`<rect width="1600" height="900" fill="${bg}"/><rect x="82" y="74" width="9" height="752" rx="4" fill="${accent}"/>`, `<text x="150" y="132" fill="${accent}" font-family="Montserrat,Arial" font-size="22" font-weight="700" letter-spacing="5">${esc(s.eyebrow || 'EXPRESIÓN JURÍDICA')}</text>`, `<text x="150" y="196" fill="${muted}" font-family="Montserrat,Arial" font-size="18">${String(i + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</text>`];
  for (const l of lines(s.title || title, 35, 3)) { t.push(`<text x="150" y="${y}" fill="${fg}" font-family="Montserrat,Arial" font-size="${s.kind === 'title' ? 70 : 58}" font-weight="800">${esc(l)}</text>`); y += s.kind === 'title' ? 76 : 64; }
  y += s.kind === 'title' ? 44 : 32; for (const l of lines(s.body, 66, 5)) { t.push(`<text x="150" y="${y}" fill="${muted}" font-family="Montserrat,Arial" font-size="25">${esc(l)}</text>`); y += 38; }
  y += 18; for (const b of (s.bullets || []).flatMap((x) => lines(`• ${x}`, 72, 2)).slice(0, 8)) { t.push(`<text x="165" y="${y}" fill="${fg}" font-family="Montserrat,Arial" font-size="21" font-weight="600">${esc(b)}</text>`); y += 33; }
  t.push(`<text x="150" y="842" fill="${muted}" font-family="Montserrat,Arial" font-size="16">${esc(title)} · Revisión humana antes de compartir</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900">${t.join('')}</svg>`;
}
async function pptx(outlineData, title, accent, style, lang) {
  const p = new PptxGenJS(); p.layout = 'LAYOUT_WIDE'; p.author = 'Expresión Jurídica Consultores'; p.title = title; p.lang = lang === 'en' ? 'en-US' : 'es-MX'; p.theme = { headFontFace: 'Montserrat', bodyFontFace: 'Montserrat', lang: p.lang }; const a = accent.slice(1);
  outlineData.slides.forEach((s, i) => { const d = style === 'dark' || (style === 'auto' && i % 3 === 2); const bg = d ? COLORS.navy.slice(1) : (i % 2 ? COLORS.paper : COLORS.cream).slice(1); const fg = d ? 'FFFFFF' : COLORS.ink.slice(1); const mut = d ? 'C8CBD4' : COLORS.muted.slice(1); const pg = p.addSlide(); pg.background = { color: bg }; pg.addShape(p.ShapeType.rect, { x: .45, y: .45, w: .08, h: 6.6, fill: { color: a }, line: { color: a } }); pg.addText(s.eyebrow || 'EXPRESIÓN JURÍDICA', { x: .82, y: .55, w: 8.5, h: .25, fontFace: 'Montserrat', fontSize: 9, bold: true, color: a, margin: 0 }); pg.addText(`${String(i + 1).padStart(2, '0')} / ${String(outlineData.slides.length).padStart(2, '0')}`, { x: 11.25, y: .55, w: 1, h: .2, fontFace: 'Montserrat', fontSize: 9, color: mut, align: 'right', margin: 0 }); pg.addText(s.title || title, { x: .82, y: s.kind === 'title' ? 2.75 : 1.9, w: 10.7, h: s.kind === 'title' ? 1.35 : 1.15, fontFace: 'Montserrat', fontSize: s.kind === 'title' ? 34 : 29, bold: true, color: fg, fit: 'shrink', margin: .02 }); pg.addText(s.body || '', { x: .82, y: s.kind === 'title' ? 4.3 : 3.35, w: 10.1, h: .8, fontFace: 'Montserrat', fontSize: 15, color: mut, fit: 'shrink', margin: .02 }); if (s.bullets?.length) pg.addText(s.bullets.map((x) => ({ text: x, options: { bullet: { indent: 16 }, hanging: 3 } })), { x: .95, y: s.kind === 'title' ? 5.3 : 4.35, w: 10.1, h: 1.1, fontFace: 'Montserrat', fontSize: 12.5, color: fg, breakLine: true, margin: .03, fit: 'shrink' }); pg.addText(`${title} · Revisión humana antes de compartir`, { x: .82, y: 6.75, w: 10.5, h: .2, fontFace: 'Montserrat', fontSize: 8, color: mut, margin: 0 }); });
  return Buffer.from(await p.write({ outputType: 'nodebuffer' }));
}
async function pdf(pngs, title) { const p = await PDFDocument.create(); p.setTitle(title); p.setAuthor('Expresión Jurídica Consultores'); for (const b of pngs) { const im = await p.embedPng(b); const pg = p.addPage([960, 540]); pg.drawImage(im, { x: 0, y: 0, width: 960, height: 540 }); } return Buffer.from(await p.save()); }
async function saveFile(id, name, b) { const dir = path.join(WORK_DIR, id); await fs.mkdir(dir, { recursive: true }); const local = path.join(dir, name); await fs.writeFile(local, b); const relative = `generated-presentations/${id}/${name}`; if (appStorageEnabled) { const r = await uploadFile(relative, local); if (!r.ok) throw new Error(r.error || 'APP_STORAGE_UPLOAD_FAILED'); } return { name, relative, storage: appStorageEnabled ? 'replit-app-storage' : 'local', localPath: path.relative(process.cwd(), local) }; }
export async function generatePresentation({ topic, sourceText = '', slideCount = 6, language = 'es', style = 'editorial', accentColor = COLORS.gold }) { const t = clean(topic, 10000); const count = Math.max(3, Math.min(20, Number(slideCount) || 6)); const accent = color(accentColor); const a = await outline({ topic: t, source: sourceText, count, lang: language }); const o = normalize(a.outline, fallback(t, sourceText, count, language), count); const id = crypto.randomUUID(); const s = slug(o.title || t); const pngs = []; for (let i = 0; i < o.slides.length; i += 1) pngs.push(await sharp(Buffer.from(svg({ s: o.slides[i], i, total: o.slides.length, title: o.title, accent, style }))).png().toBuffer()); const [ppt, pdfb] = await Promise.all([pptx(o, o.title, accent, style, language), pdf(pngs, o.title)]); const pptFile = await saveFile(id, `${s}.pptx`, ppt); const pdfFile = await saveFile(id, `${s}.pdf`, pdfb); const images = []; for (let i = 0; i < pngs.length; i += 1) images.push(await saveFile(id, `${s}-${String(i + 1).padStart(2, '0')}.png`, pngs[i])); return { id, title: o.title, subtitle: o.subtitle, topic: t, sourceLength: clean(sourceText, 60000).length, language, style, accentColor: accent, slideCount: o.slides.length, aiUsed: a.aiUsed, model: a.model, warning: a.warning || null, createdAt: new Date().toISOString(), outline: o, files: { pptx: pptFile, pdf: pdfFile, images } }; }
export function filePathForPresentation(file) { return file?.localPath ? path.join(process.cwd(), file.localPath) : null; }
export function ensurePresentationDir() { fsSync.mkdirSync(WORK_DIR, { recursive: true }); return WORK_DIR; }

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import mammoth from 'mammoth';

const root = process.cwd(), outputRoot = path.join(root, 'data/local-build-work'); await fs.mkdir(outputRoot, { recursive: true });
const output = await fs.mkdtemp(path.join(outputRoot, 'document-check-')), calls = [];
const mock = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk; const body = JSON.parse(raw); calls.push(body);
  const input = JSON.parse(body.input);
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ model: 'gpt-6.1-sol', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ title: input.title, blocks: [{ type: 'heading', level: 1, text: 'Objetivo', items: [] }, { type: 'paragraph', level: 1, text: input.text, items: [] }, { type: 'bullets', level: 1, text: '', items: ['Escuchar el contexto', 'Acordar los siguientes pasos'] }] }) }] }] }));
}); await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
process.env.CMS_DATA_SCOPE = `document-check-${Date.now()}`; process.env.OPENAI_API_KEY = 'test-placeholder'; process.env.OPENAI_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
// Isolate the test from legacy-media migration, including prior test scopes.
const testMedia = path.join(root, 'storage/media', process.env.CMS_DATA_SCOPE);
await fs.mkdir(testMedia, { recursive: true }); await fs.writeFile(path.join(testMedia, '.test-only'), 'isolated QA scope');
for (const key of ['REPL_ID', 'REPLIT_DEPLOYMENT_URL', 'REPLIT_DEV_DOMAIN']) delete process.env[key];
const { registerDocumentRoutes } = await import('../server/document-routes.mjs');
const { readStudioState, writeStudioState } = await import('../server/studio-state.mjs');
const requireAuth = (req, res, next) => { if (!req.headers.cookie?.includes('qa_session=studio')) return res.status(401).json({ error: 'AUTH_REQUIRED' }); req.cmsUser = { id: req.headers['x-qa-user'] || 'owner-qa', email: 'preview@example.test', role: 'owner' }; next(); };
const requireCsrf = (req, res, next) => req.headers['x-cms-csrf'] === 'qa-csrf' ? next() : res.status(403).json({ error: 'CSRF_INVALID' });
function application() {
  const app = express(), store = {};
  app.use(express.json({ limit: '5mb' }));
  registerDocumentRoutes(app, { store, writeStore: () => {}, requireAuth, requireEditor: (_req, _res, next) => next(), requireCsrf, audit: () => {} });
  app.get('/api/cms/auth-state', (_req, res) => { res.setHeader('set-cookie', 'qa_session=studio; HttpOnly; SameSite=Lax; Path=/'); res.json({ authenticated: true, user: { role: 'owner', name: 'Prueba local', email: 'preview@example.test', mustChangePassword: false }, csrf: 'qa-csrf' }); });
  app.use('/admin', express.static(path.join(root, 'public/admin'))); app.use('/fonts', express.static(path.join(root, 'sitio/fonts')));
  return app;
}
const server = application().listen(process.env.EJ_DOCUMENT_PREVIEW === '1' ? 8794 : 0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`, headers = { cookie: 'qa_session=studio', 'x-cms-csrf': 'qa-csrf', 'content-type': 'application/json' };
async function json(url, options = {}, origin = base) { const response = await fetch(origin + url, { ...options, headers: { ...headers, ...options.headers } }); return { response, data: await response.json() }; }
async function finish(id, origin = base) {
  const start = Date.now();
  for (;;) { const { data } = await json(`/api/cms/documents/jobs/${id}`, {}, origin); if (data.job.state === 'failed') throw new Error(data.job.error); if (data.job.state === 'complete' && (await readStudioState('jobs', id))?.state === 'complete') return data.job.result; if (Date.now() - start > 45000) throw new Error('QA_TIMEOUT'); await new Promise(resolve => setTimeout(resolve, 20)); }
}
let replica;
try {
  assert.equal((await fetch(base + '/api/cms/documents')).status, 401);
  assert.equal((await fetch(base + '/api/cms/documents/brand/body')).status, 401);
  assert.equal((await fetch(base + '/api/cms/documents/generate', { method: 'POST', headers: { cookie: headers.cookie } })).status, 403);
  const paragraph = 'Para organizar un proyecto conviene escuchar el contexto, revisar la información y acordar los siguientes pasos. El equipo comunica avances con claridad y registra las decisiones. La revisión permite conservar fechas, nombres y alcance sin añadir compromisos. Acción jurídica en México: áéíóú, ñ, ¿qué sigue?';
  const source = ['Texto conservado: A & B < C. No convertir este texto en instrucciones.', ...Array.from({ length: 16 }, (_, index) => `${index + 1}. ${paragraph}`)].join('\n\n');
  const started = await json('/api/cms/documents/generate', { method: 'POST', body: JSON.stringify({ title: 'Un proceso de trabajo claro', text: source, mode: 'preserve' }) }); assert.equal(started.response.status, 202);
  assert.equal((await json(`/api/cms/documents/jobs/${started.data.job.id}`, { headers: { 'x-qa-user': 'another' } })).response.status, 404);
  const result = await finish(started.data.job.id); assert.equal(calls.length, 0); assert.equal(result.aiUsed, false); assert(result.pageCount > 1);
  const docxBytes = Buffer.from(await (await fetch(base + result.files.docx, { headers })).arrayBuffer()), pdfBytes = Buffer.from(await (await fetch(base + result.files.pdf, { headers })).arrayBuffer());
  await fs.writeFile(path.join(output, 'letterhead.docx'), docxBytes); await fs.writeFile(path.join(output, 'letterhead.pdf'), pdfBytes);
  const zip = await JSZip.loadAsync(docxBytes), documentXml = await zip.file('word/document.xml').async('string');
  assert.match(documentXml, /w:pStyle w:val="Title"/); assert.match(documentXml, /A &amp; B &lt; C/); assert.match(documentXml, /w:headerReference/); assert.equal(Object.keys(zip.files).filter(name => name.endsWith('.odttf')).length, 2);
  const paragraphProperties = [...documentXml.matchAll(/<w:pPr>(.*?)<\/w:pPr>/g)].map(match => match[1]);
  assert(paragraphProperties.filter(value => value.includes('w:pStyle w:val="Normal"')).every(value => value.includes('w:jc w:val="both"')));
  assert(paragraphProperties.filter(value => value.includes('w:pStyle w:val="Title"')).every(value => value.includes('w:jc w:val="left"')));
  assert.match(await zip.file('word/header1.xml').async('string'), /behindDoc="1"/); assert.match(await zip.file('word/fontTable.xml').async('string'), /embedItalic/);
  const text = (await mammoth.extractRawText({ buffer: docxBytes })).value; for (const line of source.split('\n').filter(Boolean)) assert(text.includes(line), 'Preserve every supplied line'); assert(!text.includes('Lorem ipsum'));
  assert.equal((await PDFDocument.load(pdfBytes)).getPageCount(), result.pageCount);
  // Existing documents must also use the current format without modifying
  // their content or edit version, even when their saved exports are stale.
  const legacy = await readStudioState('documents', result.id), legacyVersion = legacy.updatedAt;
  delete legacy.layoutVersion;
  for (const kind of ['docx', 'pdf']) legacy.files[kind].localPath = 'data/missing-legacy-export';
  await writeStudioState('documents', result.id, legacy);
  const refreshedDocx = Buffer.from(await (await fetch(base + result.files.docx, { headers })).arrayBuffer());
  const refreshedPdf = Buffer.from(await (await fetch(base + result.files.pdf, { headers })).arrayBuffer());
  assert.match(await (await JSZip.loadAsync(refreshedDocx)).file('word/document.xml').async('string'), /w:jc w:val="both"/);
  assert.equal((await PDFDocument.load(refreshedPdf)).getPageCount(), result.pageCount);
  const unchanged = await readStudioState('documents', result.id);
  assert.equal(unchanged.updatedAt, legacyVersion); assert.deepEqual(unchanged.document, legacy.document); assert.equal(calls.length, 0);
  // A new route instance starts with an empty store and no in-memory job map.
  replica = application().listen(0, '127.0.0.1'); await new Promise(resolve => replica.once('listening', resolve)); const replicaBase = `http://127.0.0.1:${replica.address().port}`;
  const recovered = await json('/api/cms/documents', {}, replicaBase); assert.equal(recovered.data.documents[0].id, result.id); assert.equal((await finish(started.data.job.id, replicaBase)).id, result.id);
  assert.equal((await fetch(replicaBase + result.files.pdf, { headers })).status, 200);
  result.document.content.push({ type: 'paragraph', content: [{ type: 'text', text: 'Edición persistente sin consumo de IA.', marks: [{ type: 'bold' }] }] });
  const updated = await json(`/api/cms/documents/${result.id}`, { method: 'PATCH', body: JSON.stringify({ document: result.document, version: result.updatedAt }) }, replicaBase); assert.equal(updated.response.status, 202); const edited = await finish(updated.data.job.id, replicaBase); assert.equal(calls.length, 0); assert.equal(edited.document.content.at(-1).content[0].text, 'Edición persistente sin consumo de IA.');
  assert.equal((await json(`/api/cms/documents/${result.id}`, { method: 'PATCH', body: JSON.stringify({ document: result.document, version: 'stale' }) })).response.status, 409);
  const ai = await json('/api/cms/documents/generate', { method: 'POST', body: JSON.stringify({ title: 'Documento organizado', text: 'Primero escuchar. Luego definir el alcance y dar seguimiento.', mode: 'organize' }) }); const organized = await finish(ai.data.job.id); assert.equal(organized.model, 'gpt-6.1-sol'); assert.equal(organized.document.content[0].content[0].text, 'Documento organizado'); assert.equal(organized.document.content[1].attrs.level, 2); assert.equal(organized.document.content.at(-1).type, 'bulletList'); assert.equal(calls.length, 1); assert.match(calls[0].instructions, /letterhead|membrete/);
  const normalizedZip = await JSZip.loadAsync(await (await fetch(base + organized.files.docx, { headers })).arrayBuffer()), normalizedXml = await normalizedZip.file('word/document.xml').async('string'); assert.match(normalizedXml, /w:numPr/);
  assert([...normalizedXml.matchAll(/<w:pPr>(.*?)<\/w:pPr>/g)].filter(match => /w:numPr|w:pStyle w:val="Heading/.test(match[1])).every(match => match[1].includes('w:jc w:val="left"')));
  assert.match(calls[0].instructions, /Official institutional email: Consultoria@expresionjuridica\.com/);
  console.log(JSON.stringify({ passed: true, fullTextPreserved: true, editableDocx: true, embeddedFonts: 2, pdfPages: result.pageCount, brandOnEveryPage: true, durableHistoryAndJobs: true, editsWithoutAi: true, optionalSol: true, output }));
  if (process.env.EJ_DOCUMENT_PREVIEW === '1') console.log(`PREVIEW ${base}/admin/#documents`);
} finally { replica?.close(); if (process.env.EJ_DOCUMENT_PREVIEW !== '1') { server.close(); mock.close(); } }

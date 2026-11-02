import fs from 'node:fs/promises';
import path from 'node:path';
import { createStudioJobs } from './studio-jobs.mjs';
import { listStudioRecords, readStudioState, writeStudioState } from './studio-state.mjs';
import { generateDocument, renderDocument, readDocumentFile, normalizeDocument, LETTERHEAD_DIR } from './document-generator.mjs';
import { presentationModels } from './presentation-generator.mjs';

export function registerDocumentRoutes(app, { store, writeStore, requireAuth, requireEditor, requireCsrf, audit }) {
  store.documents = Array.isArray(store.documents) ? store.documents : [];
  const publicRecord = item => ({ id: item.id, title: item.title, document: item.document, pageCount: item.pageCount, aiUsed: item.aiUsed, model: item.model, brandProfile: item.brandProfile, createdAt: item.createdAt, updatedAt: item.updatedAt, files: { docx: `/api/cms/documents/${item.id}/file/docx`, pdf: `/api/cms/documents/${item.id}/file/pdf` } });
  const jobs = createStudioJobs('documents', publicRecord);
  const get = async id => await readStudioState('documents', id) || store.documents.find(item => item.id === id);
  async function save(item) { await writeStudioState('documents', item.id, item); store.documents = [item, ...store.documents.filter(record => record.id !== item.id)]; writeStore(); }
  function fail(res, error) { res.status(error.status || 500).json({ error: error.code || 'DOCUMENT_GENERATION_FAILED', detail: error.message }); }
  app.get('/api/cms/documents', requireAuth, async (req, res) => {
    try { store.documents = await listStudioRecords('documents', store.documents); res.set('Cache-Control', 'private, no-store').json({ documents: store.documents.map(publicRecord), generator: presentationModels(), activeJob: await jobs.active(req) }); }
    catch (error) { fail(res, error); }
  });
  app.get('/api/cms/documents/brand/:asset', requireAuth, async (req, res, next) => {
    const assets = { letterhead: ['letterhead.png', 'image/png'], body: ['bahnschrift-light.ttf', 'font/ttf'], heading: ['libre-caslon-italic.ttf', 'font/ttf'] };
    const asset = assets[req.params.asset]; if (!asset) return res.status(404).end();
    try { res.set('Cache-Control', 'private, max-age=3600').type(asset[1]).send(await fs.readFile(path.join(LETTERHEAD_DIR, asset[0]))); } catch (error) { next(error); }
  });
  app.get('/api/cms/documents/jobs/:id', requireAuth, async (req, res) => {
    try { const job = await jobs.read(req, req.params.id); if (!job) return res.status(404).json({ error: 'DOCUMENT_JOB_NOT_FOUND' }); res.set('Cache-Control', 'private, no-store').json({ job }); } catch (error) { fail(res, error); }
  });
  app.post('/api/cms/documents/generate', requireAuth, requireEditor, requireCsrf, async (req, res) => {
    try {
      const { text, title = '', instructions = '', mode = 'preserve' } = req.body || {};
      if (typeof text !== 'string' || !text.trim() || text.length > 200000) return res.status(400).json({ error: 'DOCUMENT_INPUT_INVALID', detail: 'Pega el texto del documento. Se admiten hasta 200 000 caracteres.' });
      const job = await jobs.enqueue(req, async progress => {
        const result = await generateDocument({ text, title: String(title).slice(0, 180), instructions: String(instructions).slice(0, 5000), mode: mode === 'organize' ? 'organize' : 'preserve' }, progress);
        const record = { ...result, createdBy: req.cmsUser.email }; await save(record); audit('document.create', req.cmsUser, { documentId: record.id, aiUsed: record.aiUsed, model: record.model }); return record;
      });
      res.status(202).json({ job });
    } catch (error) { fail(res, error); }
  });
  app.patch('/api/cms/documents/:id', requireAuth, requireEditor, requireCsrf, async (req, res) => {
    try {
      const original = await get(req.params.id); if (!original) return res.status(404).json({ error: 'DOCUMENT_NOT_FOUND' });
      if (req.body.version !== original.updatedAt) return res.status(409).json({ error: 'DOCUMENT_VERSION_CHANGED', detail: 'El documento cambió en otra edición. Abre la versión más reciente del historial.' });
      const document = normalizeDocument(req.body.document);
      const job = await jobs.enqueue(req, async progress => {
        const record = await renderDocument({ ...original, title: String(req.body.title || original.title).slice(0, 180), document }, progress);
        const latest = await get(original.id); if (latest.updatedAt !== original.updatedAt) throw new Error('DOCUMENT_VERSION_CHANGED');
        await save(record); audit('document.update', req.cmsUser, { documentId: record.id }); return record;
      }); res.status(202).json({ job });
    } catch (error) { fail(res, error); }
  });
  app.get('/api/cms/documents/:id/file/:kind', requireAuth, async (req, res, next) => {
    try {
      const item = await get(req.params.id), kind = req.params.kind;
      if (!item || !['docx', 'pdf'].includes(kind)) return res.status(404).json({ error: 'DOCUMENT_FILE_NOT_FOUND' });
      res.set('Cache-Control', 'private, no-store').set('X-Content-Type-Options', 'nosniff');
      res.type(kind === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.set('Content-Disposition', `${kind === 'pdf' && req.query.preview === '1' ? 'inline' : 'attachment'}; filename="${item.files[kind].name.replace(/[^a-zA-Z0-9._-]/g, '-')}"`);
      res.send(await readDocumentFile(item.files[kind]));
    } catch (error) { if (error.code === 'ENOENT' || error.message === 'DOCUMENT_FILE_NOT_FOUND') res.status(404).end(); else next(error); }
  });
}

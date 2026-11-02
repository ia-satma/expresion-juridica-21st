import crypto from 'node:crypto';
import { writeStudioState, readStudioState, listStudioPosts } from './studio-state.mjs';
import { generateSocialSet, normalizeSocialEdits, regenerateSocialCopy, renderSocialSet, readSocialFile, socialModels, SOCIAL_SIZES } from './social-generator.mjs';
import { preparePresentationInputs, cleanupPresentationInputs, presentationInputError } from './presentation-inputs.mjs';

export function registerSocialRoutes(app, { store, writeStore, requireAuth, requireEditor, requireCsrf, receivePresentationInputs, audit }) {
  store.socialPosts = Array.isArray(store.socialPosts) ? store.socialPosts : [];
  const jobs = new Map();
  const publicSet = item => ({
    id: item.id, title: item.title, topic: item.topic, count: item.count, mode: item.mode, size: item.size,
    direction: item.direction, language: item.language, aiUsed: item.aiUsed, model: item.model,
    imageModel: item.imageModel, generatedImageCount: item.generatedImageCount, brandProfile: item.brandProfile,
    createdAt: item.createdAt, updatedAt: item.updatedAt, sources: item.sources || [], copies: item.copies,
    posts: item.posts.map(({ artwork, imagePrompt, ...post }) => ({ ...post, hasArtwork: Boolean(artwork) })),
    files: { png: item.files.png.map((_, index) => `/api/cms/posts/${item.id}/file/png?piece=${index}`), html: item.files.html.map((_, index) => `/api/cms/posts/${item.id}/file/html?piece=${index}`), pack: `/api/cms/posts/${item.id}/file/pack`, copy: `/api/cms/posts/${item.id}/file/copy` }
  });
  const userKey = req => String(req.cmsUser.id || req.cmsUser.email);
  const jobPayload = job => ({ id: job.id, state: job.state, message: job.message, completed: job.completed, total: job.total, result: job.result || null, error: job.error || null });
  const ownerKey = req => crypto.createHash('sha256').update(userKey(req)).digest('hex');
  const persistJob = (job, force = false) => {
    const now = Date.now();
    if (!force && now - (job.persistedAt || 0) < 1500) return job.writeChain || Promise.resolve();
    job.persistedAt = now; job.updatedAt = now;
    const snapshot = { ...jobPayload(job), owner: job.owner, created: job.created, updatedAt: job.updatedAt, finished: job.finished || null };
    job.writeChain = (job.writeChain || Promise.resolve()).catch(() => {}).then(() => writeStudioState('jobs', job.id, snapshot));
    return job.writeChain;
  };
  async function getJob(req, id) {
    const job = jobs.get(id) || await readStudioState('jobs', id);
    if (!job || job.owner !== userKey(req)) return null;
    if (['queued', 'running'].includes(job.state) && Date.now() - (job.updatedAt || job.created) > 180000) {
      Object.assign(job, { state: 'failed', message: 'La generación se interrumpió. Vuelve a intentarlo.', error: 'POST_JOB_INTERRUPTED', finished: Date.now() });
      await persistJob(job, true);
    }
    return job;
  }
  async function getRecord(id) { return await readStudioState('posts', id) || store.socialPosts.find(record => record.id === id); }
  async function saveRecord(record) {
    await writeStudioState('posts', record.id, record);
    store.socialPosts = [record, ...store.socialPosts.filter(item => item.id !== record.id)];
  }
  async function enqueue(req, work) {
    const owner = userKey(req);
    if ([...jobs.values()].some(job => job.owner === owner && ['queued', 'running'].includes(job.state))) throw presentationInputError('Ya hay una generación en curso. Espera a que termine.', 'POST_JOB_ACTIVE', 409);
    const pointer = await readStudioState('owners', ownerKey(req));
    const active = pointer?.jobId ? await getJob(req, pointer.jobId) : null;
    if (active && ['queued', 'running'].includes(active.state)) throw presentationInputError('Ya hay una generación en curso. Espera a que termine.', 'POST_JOB_ACTIVE', 409);
    const job = { id: crypto.randomUUID(), owner, state: 'queued', message: 'Preparando el estudio', completed: 0, total: 1, created: Date.now() };
    jobs.set(job.id, job);
    await Promise.all([persistJob(job, true), writeStudioState('owners', ownerKey(req), { jobId: job.id })]);
    const progress = (message, completed = 0, total = 1) => { Object.assign(job, { state: 'running', message, completed, total, updatedAt: Date.now() }); persistJob(job).catch(error => console.error('[social-job-state]', error.message)); };
    const heartbeat = setInterval(() => { job.updatedAt = Date.now(); persistJob(job, true).catch(error => console.error('[social-heartbeat]', error.message)); }, 20000); heartbeat.unref();
    Promise.resolve().then(() => work(progress)).then(async record => {
      Object.assign(job, { state: 'complete', result: publicSet(record), message: 'Diseños y copy listos', completed: record.count, total: record.count, finished: Date.now() });
      await persistJob(job, true);
    }).catch(async error => {
      console.error('[social-agent]', error.code || error.message);
      Object.assign(job, { state: 'failed', message: 'No se pudo completar la generación', error: error.message, finished: Date.now() });
      await persistJob(job, true).catch(failure => console.error('[social-job-state]', failure.message));
    }).finally(() => clearInterval(heartbeat));
    return job;
  }
  const purge = setInterval(() => { for (const [id, job] of jobs) if (job.finished && Date.now() - job.finished > 3600000) jobs.delete(id); }, 120000);
  purge.unref();
  function fail(res, error) { res.status(error.status || 500).json({ error: error.code || 'POST_GENERATION_FAILED', detail: error.message }); }

  app.get('/api/cms/posts', requireAuth, async (req, res) => {
    try {
      store.socialPosts = await listStudioPosts(store.socialPosts);
      const pointer = await readStudioState('owners', ownerKey(req));
      const job = pointer?.jobId ? await getJob(req, pointer.jobId) : null;
      res.json({ posts: store.socialPosts.map(publicSet), generator: socialModels(), activeJob: job && ['queued', 'running'].includes(job.state) ? jobPayload(job) : null });
    } catch (error) { fail(res, error); }
  });
  app.get('/api/cms/posts/jobs/:id', requireAuth, async (req, res) => {
    try {
      const job = await getJob(req, req.params.id);
      if (!job) return res.status(404).json({ error: 'POST_JOB_NOT_FOUND', detail: 'La generación ya no está activa. Revisa el historial o vuelve a intentarlo.' });
      res.set('Cache-Control', 'private, no-store').json({ job: jobPayload(job) });
    } catch (error) { fail(res, error); }
  });
  app.post('/api/cms/posts/generate', requireAuth, requireEditor, requireCsrf, receivePresentationInputs, async (req, res) => {
    try {
      const body = req.body || {};
      const inputs = await preparePresentationInputs(req.files);
      const topic = String(body.topic || '').trim();
      if (topic.length > 10000) throw presentationInputError('El tema admite hasta 10 000 caracteres.');
      if (topic.length < 3 && !inputs.documentNames.length && String(body.sourceText || '').trim().length < 3) throw presentationInputError('Escribe un tema, pega información o sube un documento.');
      const sourceText = [String(body.sourceText || '').trim(), inputs.sourceText].filter(Boolean).join('\n\n');
      if (sourceText.length > 120000) throw presentationInputError('El material supera 120 000 caracteres. Reduce el texto o los documentos.');
      const count = body.mode === 'single' ? 1 : Number(body.count || 5);
      if (!Number.isInteger(count) || count < 1 || count > 20) throw presentationInputError('Elige entre 1 y 20 piezas.');
      const size = body.size || 'portrait';
      if (!SOCIAL_SIZES[size]) throw presentationInputError('Elige un formato de imagen disponible.');
      const enabled = value => value === true || value === 'true';
      const job = await enqueue(req, async progress => {
        const result = await generateSocialSet({ topic: topic || 'Publicación basada en documentos', sourceText, count, size, direction: String(body.direction || 'varied').slice(0, 100), language: body.language === 'en' ? 'en' : 'es', includeImages: enabled(body.includeImages), webSearch: enabled(body.webSearch), supportImages: inputs.supportImages, documentNames: inputs.documentNames }, progress);
        const record = { ...result, createdBy: req.cmsUser.email };
        await saveRecord(record);
        audit('social.create', req.cmsUser, { campaignId: record.id, count, model: record.model, brandProfile: record.brandProfile });
        writeStore(); return record;
      });
      res.status(202).json({ job: jobPayload(job) });
    } catch (error) { fail(res, error); }
    finally { await cleanupPresentationInputs(req.files); }
  });
  app.patch('/api/cms/posts/:id', requireAuth, requireEditor, requireCsrf, async (req, res) => {
    const original = await getRecord(req.params.id);
    if (!original) return res.status(404).json({ error: 'POST_NOT_FOUND' });
    try {
      if (req.body.version && req.body.version !== original.updatedAt) throw presentationInputError('Otra edición cambió este diseño. Actualiza el historial y abre la versión más reciente.', 'POST_VERSION_CHANGED', 409);
      const edited = normalizeSocialEdits(original, req.body);
      const job = await enqueue(req, async progress => {
        const record = await renderSocialSet(edited, new Map(), progress);
        const latest = await getRecord(original.id);
        if (!latest || latest.updatedAt !== original.updatedAt) throw new Error('POST_VERSION_CHANGED');
        await saveRecord(record); audit('social.update', req.cmsUser, { campaignId: record.id }); writeStore(); return record;
      });
      res.status(202).json({ job: jobPayload(job) });
    } catch (error) { fail(res, error); }
  });
  app.post('/api/cms/posts/:id/copy', requireAuth, requireEditor, requireCsrf, async (req, res) => {
    const original = await getRecord(req.params.id);
    if (!original) return res.status(404).json({ error: 'POST_NOT_FOUND' });
    try {
      const job = await enqueue(req, async progress => {
        progress('Sol está actualizando el copy para cada red', 0, 1);
        const copies = await regenerateSocialCopy(original);
        const record = await renderSocialSet({ ...original, copies }, new Map(), progress);
        const latest = await getRecord(original.id);
        if (!latest || latest.updatedAt !== original.updatedAt) throw new Error('POST_VERSION_CHANGED');
        await saveRecord(record); audit('social.copy', req.cmsUser, { campaignId: record.id, model: socialModels().textModel }); writeStore(); return record;
      });
      res.status(202).json({ job: jobPayload(job) });
    } catch (error) { fail(res, error); }
  });
  app.get('/api/cms/posts/:id/file/:kind', requireAuth, async (req, res, next) => {
    const item = await getRecord(req.params.id);
    if (!item) return res.status(404).json({ error: 'POST_NOT_FOUND' });
    const index = Number(req.query.piece || 0), kind = req.params.kind;
    const file = ['png', 'html'].includes(kind) ? Number.isInteger(index) ? item.files[kind]?.[index] : null : ['pack', 'copy'].includes(kind) ? item.files[kind] : null;
    if (!file) return res.status(404).json({ error: 'POST_FILE_NOT_FOUND' });
    const mime = { png: 'image/png', html: 'text/html; charset=utf-8', pack: 'application/zip', copy: 'text/plain; charset=utf-8' };
    const inline = ['png', 'html'].includes(kind) && req.query.download !== '1';
    res.set('Cache-Control', 'private, no-store'); res.set('X-Content-Type-Options', 'nosniff'); res.set('Content-Type', mime[kind]);
    res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}"`);
    if (kind === 'html') res.set('Content-Security-Policy', "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'");
    try { res.send(await readSocialFile(file)); } catch (error) { if (error.message === 'POST_FILE_NOT_FOUND' || error.code === 'ENOENT') res.status(404).end(); else next(error); }
  });
}

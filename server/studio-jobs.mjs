import crypto from 'node:crypto';
import { readStudioState, writeStudioState } from './studio-state.mjs';
import { safeErrorCode, safeLog } from './security-logging.mjs';

// Metadata and job pointers live in App Storage, so a refresh or another
// deployment replica can retrieve the same result. No source text in pointers.
export function createStudioJobs(namespace, serialize = value => value) {
  const jobs = new Map();
  const owner = req => String(req.cmsUser.id || req.cmsUser.email);
  const ownerId = req => crypto.createHash('sha256').update(`${namespace}:${owner(req)}`).digest('hex');
  const payload = job => ({ id: job.id, state: job.state, stage:job.stage, created:job.created, message: job.message, completed: job.completed, total: job.total, result: job.result || null, error: job.error ? safeErrorCode(job.error, 'DOCUMENT_GENERATION_FAILED') : null });
  function persist(job, force = false) {
    if (!force && Date.now() - (job.persistedAt || 0) < 1500) return job.writeChain || Promise.resolve();
    job.persistedAt = Date.now(); job.updatedAt = Date.now();
    const snapshot = { ...payload(job), namespace, owner: job.owner, created: job.created, updatedAt: job.updatedAt, finished: job.finished || null };
    job.writeChain = (job.writeChain || Promise.resolve()).catch(() => {}).then(() => writeStudioState('jobs', job.id, snapshot));
    return job.writeChain;
  }
  async function read(req, id) {
    const job = jobs.get(id) || await readStudioState('jobs', id);
    if (!job || job.namespace !== namespace || job.owner !== owner(req)) return null;
    if (['queued', 'running'].includes(job.state) && Date.now() - (job.updatedAt || job.created) > 180000) {
      Object.assign(job, { state: 'failed', message: 'La generación se interrumpió. Vuelve a intentarlo.', error: 'STUDIO_JOB_INTERRUPTED', finished: Date.now() });
      await persist(job, true);
    }
    return payload(job);
  }
  async function active(req) {
    const pointer = await readStudioState('owners', ownerId(req));
    const job = pointer?.jobId ? await read(req, pointer.jobId) : null;
    return job && ['queued', 'running'].includes(job.state) ? job : null;
  }
  async function enqueue(req, work) {
    if ([...jobs.values()].some(job => job.owner === owner(req) && ['queued', 'running'].includes(job.state)) || await active(req)) {
      throw Object.assign(new Error('Ya hay una generación en curso. Espera a que termine.'), { code: 'STUDIO_JOB_ACTIVE', status: 409 });
    }
    const job = { id: crypto.randomUUID(), namespace, owner: owner(req), state: 'queued', stage:'prepare', message: 'Revisando los insumos', completed: 0, total: 1, created: Date.now() };
    jobs.set(job.id, job);
    await Promise.all([persist(job, true), writeStudioState('owners', ownerId(req), { jobId: job.id })]);
    const progress = (message, completed = 0, total = 1, stage='content') => { Object.assign(job, { state: 'running', stage, message, completed, total }); persist(job).catch(error => console.error('[studio-job-state]', error.message)); };
    const heartbeat = setInterval(() => persist(job, true).catch(error => console.error('[studio-heartbeat]', error.message)), 20000); heartbeat.unref();
    Promise.resolve().then(() => work(progress)).then(async record => {
      Object.assign(job, { state: 'complete', stage:'save', result: serialize(record), message: 'Archivos guardados y listos', completed: 1, total: 1, finished: Date.now() });
      await persist(job, true);
    }).catch(async error => {
      safeLog('error', 'studio.generation.failed', error);
      Object.assign(job, { state: 'failed', message: 'No se pudo completar la generación', error: safeErrorCode(error, 'DOCUMENT_GENERATION_FAILED'), finished: Date.now() });
      await persist(job, true).catch(failure => console.error('[studio-job-state]', failure.message));
    }).finally(() => { clearInterval(heartbeat); setTimeout(() => jobs.delete(job.id), 3600000).unref(); });
    return payload(job);
  }
  return { enqueue, active, read };
}

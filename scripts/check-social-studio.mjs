import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import JSZip from 'jszip';
import { load } from 'cheerio';

const root = process.cwd();
const outputRoot = process.env.EJ_TEST_OUTPUT_DIR || path.join(root, 'data/local-build-work');
await fs.mkdir(outputRoot, { recursive: true });
const output = await fs.mkdtemp(path.join(outputRoot, 'social-check-'));
const image = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#D9BC88' } }).png().toBuffer();
const requests = [];
const networks = ['instagram', 'facebook', 'linkedin', 'x', 'threads', 'tiktok'];
const layouts = ['split', 'typographic', 'editorial', 'quote', 'steps', 'photographic', 'frame', 'closing'];
const makePost = index => ({ eyebrow: 'EXPRESIÓN JURÍDICA', headline: index === 0 ? 'La claridad empieza al escuchar' : `De la consulta a la acción ${index + 1}`, body: 'Un proceso claro permite ordenar la información, definir prioridades y dar seguimiento.', bullets: index === 1 ? ['Escuchar el contexto', 'Ordenar prioridades', 'Acordar próximos pasos'] : [], cta: 'Conversemos sobre tu proyecto', layout: layouts[index % layouts.length], imagePrompt: 'Equipo de profesionales conversando en una oficina de México, fotografía documental.', altText: 'Pieza institucional sobre un proceso de trabajo claro.' });
const copies = suffix => Object.fromEntries(networks.map(network => [network, `${network}: una idea clara para compartir. ${suffix} #ExpresiónJurídica`]));
const mock = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); requests.push({ url: req.url, body });
  res.setHeader('content-type', 'application/json');
  if (req.url === '/images/generations') return res.end(JSON.stringify({ data: [{ b64_json: image.toString('base64') }] }));
  if (req.url === '/responses') {
    const input = Array.isArray(body.input)?JSON.parse(body.input[0].content[0].text):JSON.parse(body.input);
    const data = body.text.format.name==='social_art_direction'?{notes:'Portada con más aire y fotografías con jerarquía lateral.',pieces:input.posts.map((post,index)=>({layout:index%2?'photo-side':'photo-editorial',design:{palette:'ivory',spacing:'generous',headlineScale:'expressive'}}))}:body.text.format.name === 'social_copy' ? copies('Copy actualizado.') : { title: 'Una estrategia jurídica clara', posts: Array.from({ length: input.pieces }, (_, index) => makePost(index)), copies: copies('Copy inicial.') };
    return res.end(JSON.stringify({ model: 'gpt-6.1-sol', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data), annotations: body.tools ? [{ type: 'url_citation', title: 'Fuente de prueba', url: 'https://example.com/source' }] : [] }] }] }));
  }
  res.statusCode = 404; res.end('{}');
});
await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
process.env.CMS_DATA_SCOPE = `social-check-${Date.now()}`; process.env.OPENAI_API_KEY = 'test-placeholder'; process.env.OPENAI_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
for (const key of ['REPL_ID', 'REPLIT_DEPLOYMENT_URL', 'REPLIT_DEV_DOMAIN']) delete process.env[key];
const { registerSocialRoutes } = await import('../server/social-routes.mjs');
const { renderSocialSet, readSocialFile } = await import('../server/social-generator.mjs');
const { SOCIAL_PALETTES }=await import('../server/social-design.mjs');
const { SOCIAL_FORMATS,SOCIAL_SIZES }=await import('../public/admin/social-formats.js');
const { SOCIAL_DESIGN_SKILL_ID }=await import('../server/editorial-skill.mjs');
const store = { socialPosts: [] };
const app = express(); app.use(express.json({ limit: '5mb' }));
const requireAuth = (req, res, next) => {
  if (!req.headers.cookie?.includes('qa_session=studio')) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  req.cmsUser = { id: req.headers['x-qa-user'] || 'owner-qa', email: 'preview@example.test', role: req.headers['x-qa-role'] || 'owner' }; next();
};
const requireEditor = (req, res, next) => ['owner', 'editor'].includes(req.cmsUser.role) ? next() : res.status(403).json({ error: 'EDITOR_REQUIRED' });
const requireCsrf = (req, res, next) => req.headers['x-cms-csrf'] === 'qa-csrf' ? next() : res.status(403).json({ error: 'CSRF_INVALID' });
const uploads = path.join(output, 'uploads'); await fs.mkdir(uploads);
const receive = multer({ dest: uploads, limits: { files: 30, fileSize: 100 * 1048576 } }).fields([{ name: 'documents', maxCount: 20 }, { name: 'supportImages', maxCount: 10 }]);
app.get('/api/cms/auth-state', (_req, res) => { res.setHeader('set-cookie', 'qa_session=studio; HttpOnly; SameSite=Lax; Path=/'); res.json({ authenticated: true, user: { role: 'owner', name: 'Prueba local', email: 'preview@example.test', mustChangePassword: false }, csrf: 'qa-csrf' }); });
app.get('/api/cms/presentations', requireAuth, (_req, res) => res.json({ presentations: [], generator: { aiConfigured: true, textModel: 'gpt-6.1-sol', imageModel: 'gpt-image-2' } }));
registerSocialRoutes(app, { store, writeStore: () => fs.writeFile(path.join(output, 'store.json'), JSON.stringify(store)), requireAuth, requireEditor, requireCsrf, receivePresentationInputs: receive, audit: () => {} });
app.use('/admin', express.static(path.join(root, 'public/admin'))); app.use('/fonts', express.static(path.join(root, 'sitio/fonts')));
const server = app.listen(process.env.EJ_SOCIAL_PREVIEW === '1' ? 8793 : 0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const headers = { cookie: 'qa_session=studio', 'x-cms-csrf': 'qa-csrf' };
async function json(url, options = {}) { const response = await fetch(base + url, { ...options, headers: { ...headers, ...options.headers } }); return { response, data: await response.json() }; }
async function finish(id) {
  const start = Date.now();
  for (;;) {
    const { data } = await json(`/api/cms/posts/jobs/${id}`);
    if (data.job.state === 'failed') throw new Error(data.job.error);
    if (data.job.state === 'complete') return data.job.result;
    if (Date.now() - start > 45000) throw new Error('QA_JOB_TIMEOUT');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
try {
  assert.equal((await fetch(base + '/api/cms/posts')).status, 401);
  assert.equal((await fetch(base + '/api/cms/posts/generate', { method: 'POST', headers: { cookie: headers.cookie } })).status, 403);
  const form = new FormData();
  Object.entries({ topic: 'Expresión Jurídica: diagnóstico, estrategia y seguimiento.', mode: 'carousel', count: 3, size: 'portrait', palette:'mixed', includeImages: true, webSearch: true }).forEach(([key, value]) => form.append(key, String(value)));
  form.append('documents', new Blob(['Material público de prueba. Primero escuchar, luego ordenar prioridades y dar seguimiento.']), 'insumo.txt');
  form.append('supportImages', new Blob([image], { type: 'image/png' }), 'apoyo.png');
  const started = await json('/api/cms/posts/generate', { method: 'POST', body: form });
  assert.equal(started.response.status, 202);
  assert.equal((await json(`/api/cms/posts/jobs/${started.data.job.id}`, { headers: { 'x-qa-user': 'another-user' } })).response.status, 404);
  const result = await finish(started.data.job.id);
  assert.equal(result.count, 3); assert.equal(result.files.png.length, 3); assert.equal(result.files.html.length, 3);
  assert.equal(result.generatedImageCount, 2); assert.equal(result.brandProfile, 'ej-manual-2026'); assert.equal(result.model, 'gpt-6.1-sol'); assert.equal(result.imageModel, 'gpt-image-2');
  assert.equal(result.designSkill,SOCIAL_DESIGN_SKILL_ID);
  const capabilities=(await json('/api/cms/posts')).data.generator;
  assert.deepEqual(capabilities.sizes,SOCIAL_SIZES);assert.equal(Object.keys(capabilities.formats).length,9);
  assert.deepEqual(Object.keys(result.copies), networks); assert.equal(result.sources.length, 1);
  assert.equal(result.requestedPalette,'mixed');assert(new Set(result.posts.map(post=>post.design.palette)).size>1);
  assert.equal(requests.filter(request => request.url === '/images/generations').length, 2);
  assert.match(requests.find(request => request.url === '/responses').body.instructions, /Mexico|Mexican|México/);
  const campaignInstructions=requests.find(request=>request.body?.text?.format?.name==='social_campaign').body.instructions;
  assert.match(campaignInstructions,/Anthropic's frontend-design and canvas-design/);assert.match(campaignInstructions,/Preserve facts and the selected brand/);
  assert.match(campaignInstructions,/1080 × 1350/);assert.match(campaignInstructions,/Libre Caslon/);
  assert(requests.filter(request => request.url === '/images/generations').every(request => /Documentary|documentary/.test(request.body.prompt) && /Mexico|México/.test(request.body.prompt)));
  const htmls = [];
  for (const [index, url] of result.files.html.entries()) {
    const response = await fetch(base + url, { headers }); assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
    const html = await response.text(); htmls.push(html); const $ = load(html);
    assert.equal($('script').length, 0); assert($('[data-field="headline"][contenteditable="true"]').length); assert.match(html, /font\/ttf;base64/);
    assert.match($('[data-field="headline"]').text(), /claridad|consulta/);
    assert.equal(html.includes('Imagen generada con IA'), index > 0);
  }
  const png = await (await fetch(base + result.files.png[0], { headers })).arrayBuffer();
  const individual=await fetch(base+result.files.png[1]+'&download=1',{headers});assert.match(individual.headers.get('content-type'),/image\/png/);assert.match(individual.headers.get('content-disposition'),/^attachment;/);assert.equal(individual.status,200);
  const metadata = await sharp(Buffer.from(png)).metadata(); assert.equal(metadata.width, 1080); assert.equal(metadata.height, 1350);
  const pack = await JSZip.loadAsync(await (await fetch(base + result.files.pack, { headers })).arrayBuffer());
  assert.equal(Object.keys(pack.files).filter(name => name.endsWith('.png')).length, 3); assert.equal(Object.keys(pack.files).filter(name => name.endsWith('.html')).length, 3); assert(pack.file('copy-por-red.txt'));
  const requestCount = requests.length;
  result.posts[0].headline = 'Una edición con acentos: acción jurídica'; result.posts[0].layout = 'quote'; result.copies.linkedin = 'Copy editado manualmente.';
  const changed = await json(`/api/cms/posts/${result.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ posts: result.posts, copies: result.copies, version: result.updatedAt }) });
  assert.equal(changed.response.status, 202); const edited = await finish(changed.data.job.id);
  assert.equal(edited.posts[0].headline, result.posts[0].headline); assert.equal(edited.posts[0].layout, 'quote'); assert.equal(edited.copies.linkedin, 'Copy editado manualmente.'); assert.equal(requests.length, requestCount, 'Editing must not consume AI calls');
  assert.equal((await fs.readdir(uploads)).length, 0, 'Temporary input files must be cleaned');
  const stale = await json(`/api/cms/posts/${result.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ posts: edited.posts, copies: edited.copies, version: 'stale' }) }); assert.equal(stale.response.status, 409);
  const renewed = await json(`/api/cms/posts/${result.id}/copy`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); const recaptioned = await finish(renewed.data.job.id); assert.match(recaptioned.copies.linkedin, /actualizado/); assert.equal(requests.length, requestCount + 1);
  const finalHtml = await (await fetch(base + recaptioned.files.html[0], { headers })).text(); assert.match(finalHtml, /Una edición/);
  const replicaApp = express(); replicaApp.use(express.json({ limit: '5mb' }));
  registerSocialRoutes(replicaApp, { store: {}, writeStore: () => {}, requireAuth, requireEditor, requireCsrf, receivePresentationInputs: receive, audit: () => {} });
  const replica = replicaApp.listen(0, '127.0.0.1'); await new Promise(resolve => replica.once('listening', resolve));
  try {
    const origin = `http://127.0.0.1:${replica.address().port}`;
    const recovered = await (await fetch(origin + '/api/cms/posts', { headers })).json(); assert.equal(recovered.posts[0].id, result.id); assert.equal(recovered.posts[0].posts[0].headline, edited.posts[0].headline);
    assert.equal((await (await fetch(origin + `/api/cms/posts/jobs/${renewed.data.job.id}`, { headers })).json()).job.state, 'complete');
    assert.equal((await fetch(origin + recaptioned.files.html[0], { headers })).status, 200);
  } finally { replica.close(); }
  const redesignedRequest=await json(`/api/cms/posts/${result.id}/redesign`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:recaptioned.updatedAt,palette:'ivory',instructions:'Más espacio y fotografías laterales.'})});
  assert.equal(redesignedRequest.response.status,202);const redesigned=await finish(redesignedRequest.data.job.id);
  assert.notEqual(redesigned.id,result.id);assert.equal(redesigned.referenceId,result.id);assert.equal(redesigned.model,'gpt-6.1-sol');assert(redesigned.posts.every(post=>post.design.palette==='ivory'));
  assert.deepEqual(redesigned.posts.map(({layout,design,hasArtwork,...post})=>post),recaptioned.posts.map(({layout,design,hasArtwork,...post})=>post));assert.deepEqual(redesigned.copies,recaptioned.copies);
  const designCall=requests.find(call=>call.body?.text?.format?.name==='social_art_direction');assert(designCall.body.input[0].content.some(item=>item.type==='input_image'));assert.equal(designCall.body.model,'gpt-6.1-sol');assert.match(designCall.body.instructions,/graphic designer|art director/);
  assert.match(designCall.body.instructions,/Anthropic's frontend-design and canvas-design/);
  assert.equal((await json(`/api/cms/posts/${redesigned.id}`,{method:'DELETE',headers:{'x-cms-csrf':''}})).response.status,403);
  assert.equal((await json(`/api/cms/posts/${redesigned.id}`,{method:'DELETE',headers:{'x-qa-role':'viewer'}})).response.status,403);
  const removed=await json(`/api/cms/posts/${redesigned.id}`,{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({version:redesigned.updatedAt})});assert.equal(removed.response.status,200);assert.equal(removed.data.recoverable,true);
  assert(!(await json('/api/cms/posts')).data.posts.some(item=>item.id===redesigned.id));assert((await json('/api/cms/posts?includeDeleted=1')).data.posts.some(item=>item.id===redesigned.id&&item.deletedAt));assert.equal((await fetch(base+redesigned.files.png[0],{headers})).status,404);
  const restored=await json(`/api/cms/posts/${redesigned.id}/restore`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:removed.data.record.updatedAt})});assert.equal(restored.response.status,200);assert.equal((await fetch(base+redesigned.files.png[0],{headers})).status,200);
  for(const [palette,colors] of Object.entries(SOCIAL_PALETTES)){
    const themed=await renderSocialSet({...store.socialPosts[0],count:1,posts:[{...makePost(0),layout:'typographic',design:{palette},artwork:null}]});
    const bytes=await readSocialFile(themed.files.png[0]),pixel=await sharp(bytes).extract({left:0,top:0,width:1,height:1}).removeAlpha().raw().toBuffer();assert.equal('#'+pixel.toString('hex'),colors.background.toLowerCase());
    await fs.writeFile(path.join(output,`palette-${palette}.png`),bytes);
  }
  const variants = await renderSocialSet({ ...store.socialPosts[0], id: 'qa-variants', count: 8, posts: layouts.map((layout, index) => ({ ...makePost(index), layout, artwork: null })) });
  for (const [index, file] of variants.files.png.entries()) await fs.writeFile(path.join(output, `variant-${layouts[index]}.png`), await readSocialFile(file));
  for (const [size, dimensions] of Object.entries(SOCIAL_SIZES)) {
    const rendered = await renderSocialSet({ ...store.socialPosts[0], id: `qa-${size}`, count: 1, size, posts: [{ ...makePost(0), headline: 'Una idea clara', body: 'Escuchar. Definir prioridades. Dar seguimiento.', bullets: [], layout: 'typographic', artwork: null }] });
    const image = await readSocialFile(rendered.files.png[0]); const info = await sharp(image).metadata(); assert.deepEqual([info.width, info.height], dimensions); await fs.writeFile(path.join(output, `size-${size}.png`), image);
    const html=await readSocialFile(rendered.files.html[0]);const $=load(html.toString());assert(!$('[data-node]').toArray().some(node=>/01\s*\/\s*01/.test($(node).text())),'A standalone post must not show a carousel counter');
    const title=$('[data-field="headline"]');const style=Object.fromEntries(title.attr('style').split(';').filter(Boolean).map(part=>part.split(':')));
    assert(Number.parseFloat(style['font-size'])>3,'Increasing export resolution must preserve the visual type scale');
    if(SOCIAL_FORMATS[size].safeArea){
      for(const node of $('[data-field]').toArray()){
        const css=Object.fromEntries($(node).attr('style').split(';').filter(Boolean).map(part=>part.split(':')));
        const top=Number.parseFloat(css.top)*dimensions[0]/100,box=Number.parseFloat(css['min-height'])*dimensions[0]/100;
        assert(top>=160&&top+box<=dimensions[1]-250,'Essential story content must stay inside the safe area');
      }
    }
  }
  const single=await renderSocialSet({...store.socialPosts[0],count:1,posts:[{...makePost(0),eyebrow:'',layout:'editorial',artwork:null}]});
  const singleHtml=load((await readSocialFile(single.files.html[0])).toString());
  assert.equal(singleHtml('[data-field="eyebrow"]').text(),'');assert(!singleHtml('[data-node]').toArray().some(node=>singleHtml(node).text()==='01'));
  const extraFormat=new FormData();Object.entries({topic:'Cómo preparar una consulta',count:1,size:'pinterest',includeImages:false}).forEach(([key,value])=>extraFormat.append(key,String(value)));
  const extraStart=await json('/api/cms/posts/generate',{method:'POST',body:extraFormat});assert.equal(extraStart.response.status,202);
  const extraResult=await finish(extraStart.data.job.id);assert.equal(extraResult.size,'pinterest');
  const formatCall=requests.filter(request=>request.body?.text?.format?.name==='social_campaign').at(-1);assert.match(formatCall.body.instructions,/1000 × 1500/);assert.match(formatCall.body.instructions,/Pinterest/);
  assert(JSON.stringify(store).length < 90000, 'Store metadata must not contain embedded binary data');
  console.log(JSON.stringify({ passed: true, asyncJobs: true, authAndCsrf: true, uploadFirst: true, pngAndEditableHtml: true, individualPngDownload:true, persistedEditsWithoutAi: true, visualRedesignWithSol:true, adaptedAnthropicSkills:true,storySafeArea:true,originalPreserved:true,palettes:4,recoverableDelete:true, networkCopies: 6, layouts: 10, sizes: Object.keys(SOCIAL_SIZES).length, output }));
  if (process.env.EJ_SOCIAL_PREVIEW === '1') console.log(`PREVIEW ${base}/admin/#posts`);
} finally {
  if (process.env.EJ_SOCIAL_PREVIEW !== '1') { server.close(); mock.close(); }
}

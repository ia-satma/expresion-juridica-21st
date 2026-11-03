import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import JSZip from 'jszip';
import { load } from 'cheerio';

const root=path.dirname(fileURLToPath(new URL('../package.json',import.meta.url))),originalCwd=process.cwd();
const isolated=await fs.mkdtemp(path.join(os.tmpdir(),'ej-social-studio-v2-'));
for(const folder of ['server','public','sitio','firma-cms','node_modules'])await fs.symlink(path.join(root,folder),path.join(isolated,folder),'dir');
process.chdir(isolated);
const outputRoot = process.env.EJ_TEST_OUTPUT_DIR || path.join(root, 'data/local-build-work');
await fs.mkdir(outputRoot, { recursive: true });
const output = await fs.mkdtemp(path.join(outputRoot, 'social-check-'));
const image = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#D9BC88' } }).png().toBuffer();
const requests=[],reviewInputs=[],draftObservations=[];let reviewFailures=0,writeCount=0,rejectPreservingReview=0,copyGate=null;
const fixtureUrl='https://example.com/source/consulta-y-seguimiento-institucional';
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const design=index=>({palette:['navy-gold','editorial','ivory','graphite'][index%4],spacing:'generous',headlineScale:'balanced',background:'solid',imagePosition:'auto',imageShare:'balanced',align:'left',panel:'plain'});
const networks = ['instagram', 'facebook', 'linkedin', 'x', 'threads', 'tiktok'];
const layouts = ['split', 'typographic', 'editorial', 'quote', 'steps', 'photographic', 'frame', 'closing'];
const makePost = index => ({ eyebrow: 'EXPRESIÓN JURÍDICA', headline: index === 0 ? 'La claridad empieza al escuchar' : `De la consulta a la acción ${index + 1}`, body: 'Un proceso claro permite ordenar la información, definir prioridades y dar seguimiento.', bullets: index === 1 ? ['Escuchar el contexto', 'Ordenar prioridades', 'Acordar próximos pasos'] : [], cta: 'Conversemos sobre tu proyecto', layout: layouts[index % layouts.length], imagePrompt: 'Equipo de profesionales conversando en una oficina de México, fotografía documental.', altText: 'Pieza institucional sobre un proceso de trabajo claro.' });
const copies = suffix => Object.fromEntries(networks.map(network => [network, `${network}: una idea clara para compartir. ${suffix} #ExpresiónJurídica`]));
const mock = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); requests.push({ url: req.url, body });
  res.setHeader('content-type', 'application/json');
  if(req.url==='/images/generations'){const record=store.socialPosts[0];draftObservations.push({exists:Boolean(record),copies:Boolean(record?.copies?.linkedin),png:record?.files?.png?.length||0,html:record?.files?.html?.length||0});return res.end(JSON.stringify({data:[{b64_json:image.toString('base64')}]}));}
  if (req.url === '/responses') {
    const input = Array.isArray(body.input)?JSON.parse(body.input[0].content[0].text):JSON.parse(body.input);
    let data;
    if(body.text.format.name==='social_visual_review'){
      reviewInputs.push(structuredClone(input));
      const record=store.socialPosts[0];draftObservations.push({exists:Boolean(record),copies:Boolean(record?.copies?.linkedin),png:record?.files?.png?.length||0,html:record?.files?.html?.length||0});
      if(reviewFailures>0){reviewFailures--;res.statusCode=503;return res.end(JSON.stringify({error:{code:'fixture_review_unavailable',message:'Synthetic reviewer failure.'}}));}
      const forcePreservingChange=rejectPreservingReview>0&&!input.allowTextChanges;
      if(forcePreservingChange)rejectPreservingReview--;
      const itemSchema=body.text.format.schema.properties.pieces.items;
      for(const field of ['eyebrow','headline','body','bullets','cta'])assert.equal(Object.hasOwn(itemSchema.properties,field),input.allowTextChanges,'Read-only review must not request rewritten text fields');
      data={pieces:input.pieces.map(({piece,post,geometry},index)=>{
        const force=forcePreservingChange&&index===0,approved=geometry.valid===true&&!force;
        const corrected=force?{...post,design:{...post.design,spacing:post.design.spacing==='generous'?'balanced':'generous'}}:approved||!input.allowTextChanges?post:{...post,eyebrow:'',headline:'Una idea clara',body:'Revisa los antecedentes antes de decidir.',bullets:[],cta:'Conversemos',layout:'typographic',design:design(piece-1)};
        const decision={piece,approved,issues:approved?'':force?'Ajustar los márgenes para dar más aire.':'El texto supera la composición; simplificar el mensaje gráfico.',layout:corrected.layout,design:corrected.design};
        if(input.allowTextChanges)for(const field of ['eyebrow','headline','body','bullets','cta'])decision[field]=corrected[field];
        return decision;
      })};
    }else if(body.text.format.name==='social_art_direction')data={notes:'Portada con más aire y fotografías con jerarquía lateral.',pieces:input.posts.map((post,index)=>({layout:index%2?'photo-side':'photo-editorial',design:{...design(index),palette:'ivory',background:'tonal',imagePosition:index%2?'right':'left',panel:'curved'}}))};
    else if(body.text.format.name==='social_copy'){
      if(copyGate){const gate=copyGate;copyGate=null;gate.entered();await gate.wait;}
      data=copies('Copy actualizado.');
    }
    else {const posts=Array.from({length:input.pieces},(_,index)=>({...makePost(index),design:design(index)}));posts[0].body+=` (${fixtureUrl})`;if(String(input.topic).includes('Dense review fixture'))posts[3]={...posts[3],eyebrow:'Contexto del asunto',headline:'Una explicación extensa del contexto y sus consideraciones para tomar una decisión informada',body:'Información del contexto para ordenar los antecedentes y sus efectos. '.repeat(5).slice(0,300),bullets:Array.from({length:3},()=>('La explicación y sus condiciones requieren una lectura completa antes de definir el siguiente paso.').slice(0,100)),cta:'Revisa las condiciones del contexto antes de definir el siguiente paso del proceso',layout:'typographic'};data={title:String(input.topic).includes('Dense review fixture')?'Dense review fixture':'Una estrategia jurídica clara',posts,copies:copies('Copy inicial.')};}
    return res.end(JSON.stringify({ model: 'gpt-6.1-sol', service_tier:'fast', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data), annotations: body.tools ? [{ type: 'url_citation', title: 'Fuente de prueba', url: 'https://example.com/source' }] : [] }] }] }));
  }
  res.statusCode = 404; res.end('{}');
});
await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
process.env.CMS_DATA_SCOPE = `social-check-${Date.now()}`; process.env.OPENAI_API_KEY = 'test-placeholder'; process.env.OPENAI_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
process.env.OPENAI_TEXT_SERVICE_TIER='fast';
for(const key of ['REPL_ID','REPLIT_DEPLOYMENT_URL','REPLIT_DEV_DOMAIN','REPLIT_OBJECT_STORAGE_BUCKET_ID','DEFAULT_OBJECT_STORAGE_BUCKET_ID','OPENAI_IMAGE_MODEL'])delete process.env[key];
const { registerSocialRoutes } = await import('../server/social-routes.mjs');
const {renderSocialSet,readSocialFile,SOCIAL_DIR}=await import('../server/social-generator.mjs');
const {composeSocialPiece,loadSocialTypography,svgSocialCanvas}=await import('../server/social-compositor.mjs');
const { SOCIAL_PALETTES }=await import('../server/social-design.mjs');
const { SOCIAL_FORMATS,SOCIAL_SIZES }=await import('../public/admin/social-formats.js');
const { SOCIAL_DESIGN_SKILL_ID }=await import('../server/editorial-skill.mjs');
const store = { socialPosts: [] };
const app = express(); app.use(express.json({ limit: '5mb' }));
const requireAuth = (req, res, next) => {
  if (!req.headers.cookie?.includes('qa_session=studio')) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  // BetterAuth's account role differs from the CMS authorization role in production.
  req.cmsUser={id:req.headers['x-qa-user']||'owner-qa',email:'preview@example.test',role:'user'};
  req.cmsAdmin={role:req.headers['x-qa-role']||'owner'};next();
};
const requireEditor = (req,res,next)=>['owner','editor'].includes(req.cmsAdmin?.role||req.cmsUser.role)?next():res.status(403).json({error:'EDITOR_REQUIRED'});
const requireCsrf = (req, res, next) => req.headers['x-cms-csrf'] === 'qa-csrf' ? next() : res.status(403).json({ error: 'CSRF_INVALID' });
const uploads = path.join(output, 'uploads'); await fs.mkdir(uploads);
const receive = multer({ dest: uploads, limits: { files: 30, fileSize: 100 * 1048576 } }).fields([{ name: 'documents', maxCount: 20 }, { name: 'supportImages', maxCount: 10 }]);
app.get('/api/cms/auth-state', (_req, res) => { res.setHeader('set-cookie', 'qa_session=studio; HttpOnly; SameSite=Lax; Path=/'); res.json({ authenticated: true, user: { role: 'owner', name: 'Prueba local', email: 'preview@example.test', mustChangePassword: false }, csrf: 'qa-csrf' }); });
app.get('/api/cms/presentations', requireAuth, (_req, res) => res.json({ presentations: [], generator: { aiConfigured: true, textModel: 'gpt-6.1-sol', imageModel: 'gpt-image-2.5-sunburst' } }));
registerSocialRoutes(app, { store, writeStore: async()=>{writeCount++;await fs.writeFile(path.join(output,'store.json'),JSON.stringify(store));}, requireAuth, requireEditor, requireCsrf, receivePresentationInputs: receive, audit: () => {} });
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
async function settle(id,user='owner-qa') {
  const start=Date.now();
  for(;;){
    const {data}=await json(`/api/cms/posts/jobs/${id}`,{headers:{'x-qa-user':user}});
    if(['complete','failed'].includes(data.job.state))return data.job;
    if(Date.now()-start>45000)throw Error('QA_JOB_TIMEOUT');
    await new Promise(resolve=>setTimeout(resolve,20));
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
  let result = await finish(started.data.job.id);
  assert.equal(result.renderStatus,'ready');assert.equal(result.layoutVersion,2);assert.equal(result.layoutValidation.valid,true);assert.equal(result.visualReview.state,'approved');assert.deepEqual(result.serviceTier,{requested:'fast',served:'fast',fallback:false});assert(draftObservations.every(item=>item.exists&&item.copies&&item.png===0&&item.html===0));
  assert.equal(result.count, 3); assert.equal(result.files.png.length, 3); assert.equal(result.files.html.length, 3);
  assert.equal(result.generatedImageCount, 2); assert.equal(result.brandProfile, 'ej-manual-2026'); assert.equal(result.model, 'gpt-6.1-sol'); assert.equal(result.imageModel, 'gpt-image-2.5-sunburst');
  assert.equal(result.designSkill,SOCIAL_DESIGN_SKILL_ID);
  const capabilities=(await json('/api/cms/posts')).data.generator;
  assert.deepEqual(capabilities.sizes,SOCIAL_SIZES);assert.equal(Object.keys(capabilities.formats).length,9);assert.equal(capabilities.textServiceTier,'fast');
  assert.deepEqual(Object.keys(result.copies), networks); assert(result.sources.some(item=>item.url===fixtureUrl));assert(result.posts.every(item=>!JSON.stringify([item.headline,item.body,item.bullets]).includes('https://')));
  assert.equal(result.requestedPalette,'mixed');assert(new Set(result.posts.map(post=>post.design.palette)).size>1);
  assert.equal(requests.filter(request => request.url === '/images/generations').length, 2);
  assert.match(requests.find(request => request.url === '/responses').body.instructions, /Mexico|Mexican|México/);
  const campaignInstructions=requests.find(request=>request.body?.text?.format?.name==='social_campaign').body.instructions;
  const graphicSchema=requests.find(request=>request.body?.text?.format?.name==='social_campaign').body.text.format.schema.properties.posts.items.properties.design;
  assert.deepEqual([...graphicSchema.required].sort(),Object.keys(design(0)).sort());assert.equal(result.designSkill,'ej-social-design-v2');
  assert.match(campaignInstructions,/Anthropic's frontend-design and canvas-design/);assert.match(campaignInstructions,/Preserve facts and the selected brand/);
  assert.match(campaignInstructions,/1080 × 1350/);assert.match(campaignInstructions,/Libre Caslon/);
  assert(requests.filter(request=>request.url==='/images/generations').every(request=>/documentary|editorial photograph|fotograf[ií]a documental/i.test(request.body.prompt)&&/Mexico|México/.test(request.body.prompt)&&/No text, letters, logos/.test(request.body.prompt)&&request.body.model==='gpt-image-2.5-sunburst'));
  const htmls = [];
  for (const [index, url] of result.files.html.entries()) {
    const response = await fetch(base + url, { headers }); assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
    const html = await response.text(); htmls.push(html); const $ = load(html);
    assert.equal($('script').length, 0); assert($('svg g[data-field="headline"] text').length);assert.equal($('[contenteditable="true"]').length,0); assert.match(html, /font\/ttf;base64/);
    assert.match($('[data-field="headline"]').text(), /claridad|consulta/);
    assert.equal(html.includes('Imagen generada con IA'), index > 0);
  }
  const png = await (await fetch(base + result.files.png[0], { headers })).arrayBuffer();
  const individual=await fetch(base+result.files.png[1]+'&download=1',{headers});assert.match(individual.headers.get('content-type'),/image\/png/);assert.match(individual.headers.get('content-disposition'),/^attachment;/);assert.equal(individual.status,200);
  const metadata = await sharp(Buffer.from(png)).metadata(); assert.equal(metadata.width, 1080); assert.equal(metadata.height, 1350);
  const pack = await JSZip.loadAsync(await (await fetch(base + result.files.pack, { headers })).arrayBuffer());
  assert.equal(Object.keys(pack.files).filter(name => name.endsWith('.png')).length, 3); assert.equal(Object.keys(pack.files).filter(name => name.endsWith('.html')).length, 3); assert(pack.file('copy-por-red.txt'));
  const reviewCount=requests.filter(item=>item.body?.text?.format?.name==='social_visual_review').length;
  const beforeCopy=structuredClone(result),cachedCopy=await json(`/api/cms/posts/${result.id}/copy`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(cachedCopy.response.status,202);result=await finish(cachedCopy.data.job.id);assert.deepEqual(result.files.png,beforeCopy.files.png);assert.deepEqual(result.files.html,beforeCopy.files.html);assert.deepEqual(result.visualReview,beforeCopy.visualReview);assert.equal(requests.filter(item=>item.body?.text?.format?.name==='social_visual_review').length,reviewCount);
  const cachedReview=await json(`/api/cms/posts/${result.id}/review`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:result.updatedAt})});assert.equal(cachedReview.response.status,202);result=await finish(cachedReview.data.job.id);assert.equal(result.renderStatus,'ready');assert.equal(requests.filter(item=>item.body?.text?.format?.name==='social_visual_review').length,reviewCount);
  // Match the real browser: publicSet intentionally omits imagePrompt/artwork.
  assert(result.posts.every(post=>!Object.hasOwn(post,'imagePrompt')));
  const beforePublicCopy=structuredClone(store.socialPosts.find(item=>item.id===result.id)),callsBeforePublicCopy=requests.length;
  assert(beforePublicCopy.posts.every(post=>post.imagePrompt));
  const publicCaptions={...result.copies,linkedin:'Caption editado desde el payload público del CMS.'};
  const captionSave=await json(`/api/cms/posts/${result.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({posts:result.posts,copies:publicCaptions,version:result.updatedAt})});
  assert.equal(captionSave.response.status,202);result=await finish(captionSave.data.job.id);
  const afterPublicCopy=store.socialPosts.find(item=>item.id===result.id);
  assert.deepEqual(afterPublicCopy.posts.map(post=>post.imagePrompt),beforePublicCopy.posts.map(post=>post.imagePrompt));
  assert.deepEqual(afterPublicCopy.files.png,beforePublicCopy.files.png,'Caption edits must preserve the actual artifact references, not just public URLs');
  assert.deepEqual(afterPublicCopy.files.html,beforePublicCopy.files.html);assert.deepEqual(afterPublicCopy.visualReview,beforePublicCopy.visualReview);
  assert.equal(afterPublicCopy.manualRevision,beforePublicCopy.manualRevision);assert.equal(afterPublicCopy.allowReviewTextChanges,beforePublicCopy.allowReviewTextChanges);
  assert.equal(requests.length,callsBeforePublicCopy,'Manual captions must not call AI');
  assert.match(await (await fetch(base+result.files.copy,{headers})).text(),/Caption editado desde el payload público/);
  const previewUrl=`/api/cms/posts/${result.id}/preview`,previewPost={...result.posts[0],eyebrow:'Una vista previa',headline:'Un mensaje claro',body:'El cambio todavía no se ha guardado.',bullets:[],layout:'photo-editorial',design:{...design(0),background:'tonal',imagePosition:'left'}};
  const preview=async(body,extra={})=>json(previewUrl,{method:'POST',headers:{'content-type':'application/json',...extra},body:JSON.stringify(body)});
  assert.equal((await fetch(base+previewUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:result.updatedAt})})).status,401);assert.equal((await preview({version:result.updatedAt},{'x-cms-csrf':''})).response.status,403);assert.equal((await preview({version:'stale'})).response.status,409);
  const oldStore=JSON.stringify(store),oldWrites=writeCount,oldCalls=requests.length,oldFiles=(await fs.readdir(SOCIAL_DIR,{recursive:true})).sort();
  const full=await preview({version:result.updatedAt,piece:0,post:previewPost,includeAssets:true});assert.equal(full.response.status,200);assert.match(full.response.headers.get('cache-control'),/no-store/);assert.equal(full.data.validation.valid,true);assert(full.data.assets.fonts.heading);assert(Object.keys(full.data.assets.images).length>0);assert(!JSON.stringify(full.data.scene).includes('data:image'));
  const compact=await preview({version:result.updatedAt,piece:0,post:previewPost});assert.equal(compact.response.status,200);assert(!compact.data.assets);assert.deepEqual(compact.data.scene,full.data.scene);assert.equal(compact.data.hash,full.data.hash);assert(JSON.stringify(full.data).length>JSON.stringify(compact.data).length+10000);
  const originalPreview=await preview({version:result.updatedAt,piece:0}),viewer=await preview({version:result.updatedAt,piece:0,post:{...previewPost,headline:'Un visor no puede introducir este cambio'}},{'x-qa-role':'viewer'});assert.equal(viewer.response.status,200);assert.equal(viewer.data.hash,originalPreview.data.hash);
  const editorPreview=await preview({version:result.updatedAt,piece:0,post:previewPost},{'x-qa-role':'editor'});
  assert.equal(editorPreview.response.status,200);assert.equal(editorPreview.data.hash,full.data.hash,'A BetterAuth user with the CMS editor role must preview edits');
  assert.notEqual(full.data.hash,originalPreview.data.hash,'A BetterAuth user with the CMS owner role must preview edits');
  assert.equal(JSON.stringify(store),oldStore);assert.equal(writeCount,oldWrites);assert.equal(requests.length,oldCalls);assert.deepEqual((await fs.readdir(SOCIAL_DIR,{recursive:true})).sort(),oldFiles);assert.equal((await json('/api/cms/posts')).data.posts.find(item=>item.id===result.id).updatedAt,result.updatedAt);
  const fonts=await loadSocialTypography(),canvas={...full.data.scene,assetMap:Object.fromEntries(Object.entries(full.data.assets.images).map(([id,data])=>[id,Buffer.from(data,'base64')]))};assert.deepEqual(full.data.assets.fonts,fonts.data);
  const own=store.socialPosts.find(item=>item.id===result.id),direct=await composeSocialPiece({post:{...previewPost,artwork:own.posts[0].artwork},index:0,total:result.count,size:result.size,artwork:await readSocialFile(own.posts[0].artwork)});assert.equal(hash(await sharp(Buffer.from(svgSocialCanvas(canvas,fonts))).png().toBuffer()),hash(await sharp(Buffer.from(svgSocialCanvas(direct.canvas,fonts))).png().toBuffer()));
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
  const preservingReviewStart=reviewInputs.length;rejectPreservingReview=1;
  const redesignedRequest=await json(`/api/cms/posts/${result.id}/redesign`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:recaptioned.updatedAt,palette:'ivory',instructions:'Más espacio y fotografías laterales.'})});
  assert.equal(redesignedRequest.response.status,202);const redesigned=await finish(redesignedRequest.data.job.id);
  assert.notEqual(redesigned.id,result.id);assert.equal(redesigned.referenceId,result.id);assert.equal(redesigned.model,'gpt-6.1-sol');assert(redesigned.posts.every(post=>post.design.palette==='ivory'));
  assert.deepEqual(redesigned.posts.map(({layout,design,hasArtwork,...post})=>post),recaptioned.posts.map(({layout,design,hasArtwork,...post})=>post));assert.deepEqual(redesigned.copies,recaptioned.copies);
  const preservingPasses=reviewInputs.slice(preservingReviewStart);assert(preservingPasses.length===2);
  assert(preservingPasses.every(input=>input.allowTextChanges===false));assert.equal(preservingPasses[1].pieces.length,1);
  assert.equal(store.socialPosts.find(item=>item.id===redesigned.id).allowReviewTextChanges,false);
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
    assert.equal(rendered.renderStatus,'ready');const title=$('[data-field="headline"]');assert(Number(title.attr('font-size'))/dimensions[0]>.035,'Increasing export resolution must preserve the visual type scale');
    if(SOCIAL_FORMATS[size].safeArea){
      for(const node of $('[data-field]').toArray()){
        const measured=JSON.parse($(node).attr('data-box'));const top=measured.y,box=measured.h;
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
  const requestBeforeLong=requests.length,longPosts=structuredClone(recaptioned.posts);longPosts[0].body='Texto íntegro para revisar las condiciones y el contexto antes de decidir. '.repeat(20).slice(0,700);longPosts[0].bullets=Array.from({length:4},()=>('Un detalle que el cliente necesita conservar y editar sin perder el contenido. ').repeat(3).slice(0,180));
  const tooLong=await json(`/api/cms/posts/${result.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({posts:longPosts,copies:recaptioned.copies,version:recaptioned.updatedAt})});assert.equal(tooLong.response.status,202);const longSaved=await finish(tooLong.data.job.id);assert.equal(longSaved.renderStatus,'needs-adjustment');assert.equal(longSaved.posts[0].body,longPosts[0].body);assert.equal(longSaved.posts[0].body.length,700);assert.equal((await fetch(base+`/api/cms/posts/${result.id}/file/png?piece=0&download=1`,{headers})).status,409);assert.equal(requests.length,requestBeforeLong);
  const fix=await json(`/api/cms/posts/${result.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({posts:recaptioned.posts,copies:recaptioned.copies,version:longSaved.updatedAt})});assert.equal(fix.response.status,202);assert.equal((await finish(fix.data.job.id)).renderStatus,'ready');assert.equal(requests.length,requestBeforeLong);
  async function extraCampaign(topic,{includeImages=true,size='portrait'}={}){const input=new FormData();Object.entries({topic,count:5,mode:'carousel',size,includeImages,background:'solid'}).forEach(([key,value])=>input.append(key,String(value)));const start=await json('/api/cms/posts/generate',{method:'POST',body:input});assert.equal(start.response.status,202);return finish(start.data.job.id);}
  reviewFailures=1;const pending=await extraCampaign('Reviewer failure fixture');assert.equal(pending.renderStatus,'review-pending');assert.equal(pending.visualReview.state,'unavailable');assert.equal(pending.files.png.length,0);assert.equal(pending.files.html.length,0);assert.equal(pending.generatedImageCount,5);assert(store.socialPosts.find(item=>item.id===pending.id).posts.every(item=>item.artwork));assert(store.socialPosts.find(item=>item.id===pending.id).copies.linkedin);assert.equal((await fetch(base+`/api/cms/posts/${pending.id}/file/png?piece=0`,{headers})).status,409);
  const persistedPending=JSON.parse(await fs.readFile(path.join(output,'store.json'),'utf8')).socialPosts.find(item=>item.id===pending.id);assert.equal(persistedPending.renderStatus,'review-pending');assert.equal(persistedPending.visualReview.state,'unavailable');assert(persistedPending.posts.every(item=>item.artwork));assert(persistedPending.copies.linkedin);
  const imageCount=requests.filter(item=>item.url==='/images/generations').length,reviewStart=reviewInputs.length;const resume=await json(`/api/cms/posts/${pending.id}/review`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:pending.updatedAt})});assert.equal(resume.response.status,202);const resumed=await finish(resume.data.job.id);assert.equal(resumed.renderStatus,'ready');assert.equal(resumed.visualReview.state,'approved');assert.deepEqual(resumed.visualReview.pieces.map(item=>item.piece),[0,1,2,3,4]);assert(reviewInputs.slice(reviewStart).some(input=>input.pieces.some(item=>item.piece===4)&&input.pieces.some(item=>item.piece===5)));assert.equal(requests.filter(item=>item.url==='/images/generations').length,imageCount);
  const beforeDense=reviewInputs.length;const dense=await extraCampaign('Dense review fixture',{includeImages:false,size:'square'}),passes=reviewInputs.slice(beforeDense);assert.equal(dense.renderStatus,'ready');assert.equal(passes.length,2);assert.deepEqual(passes[0].pieces.map(item=>item.piece),[1,2,3,4,5]);assert(passes[0].pieces.some(item=>item.piece===4&&!item.geometry.valid));assert.equal(passes[1].round,1);assert.deepEqual(passes[1].pieces.map(item=>item.piece),[4]);assert.equal(dense.posts[3].body,'Revisa los antecedentes antes de decidir.');
  // Different CMS users may mutate the same record: only one base revision wins.
  const fixture=async()=>((await json('/api/cms/posts?includeDeleted=1')).data.posts.find(item=>item.id===extraResult.id));
  const patchAs=(user,record,body)=>json(`/api/cms/posts/${record.id}`,{method:'PATCH',headers:{'content-type':'application/json','x-qa-user':user},body:JSON.stringify({posts:record.posts.map((post,index)=>index?post:{...post,body}),copies:record.copies,version:record.updatedAt})});
  const terminalMutation=async(start,user)=>start.response.status===202?settle(start.data.job.id,user):{state:'rejected',error:start.data.error};
  const raceBase=await fixture(),callsBeforeRace=requests.length;
  const concurrent=await Promise.all([patchAs('mutex-patch-a',raceBase,'Contexto A.'),patchAs('mutex-patch-b',raceBase,'Contexto B.')]);
  assert(concurrent.every(item=>[202,409].includes(item.response.status)));
  const outcomes=await Promise.all(concurrent.map((item,index)=>terminalMutation(item,index?'mutex-patch-b':'mutex-patch-a')));
  assert.equal(outcomes.filter(item=>item.state==='complete').length,1,'Two editors must not commit the same base revision');
  assert(outcomes.filter(item=>item.state!=='complete').every(item=>item.error==='POST_VERSION_CHANGED'));
  const afterRace=await fixture();assert(['Contexto A.','Contexto B.'].includes(afterRace.posts[0].body));
  const mixed=await Promise.all([patchAs('mutex-patch-c',afterRace,'Contexto C.'),json(`/api/cms/posts/${afterRace.id}`,{method:'DELETE',headers:{'content-type':'application/json','x-qa-user':'mutex-trash'},body:JSON.stringify({version:afterRace.updatedAt})})]);
  assert([202,409,404].includes(mixed[0].response.status));assert([200,409].includes(mixed[1].response.status));
  const patchOutcome=await terminalMutation(mixed[0],'mutex-patch-c'),deleted=mixed[1].response.status===200;
  assert.notEqual(patchOutcome.state==='complete',deleted,'A checkpoint and trash mutation must have one winner');
  let afterMixed=await fixture();assert.equal(Boolean(afterMixed.deletedAt),deleted);
  if(deleted){const restored=await json(`/api/cms/posts/${afterMixed.id}/restore`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:afterMixed.updatedAt})});assert.equal(restored.response.status,200);afterMixed=restored.data.record;}
  assert.equal(requests.length,callsBeforeRace,'Concurrent manual edits and trash must not call AI');
  // Hold only the fictitious provider. A deletion during copy generation must
  // remain deleted when the old copy result eventually reaches its checkpoint.
  let releaseCopy,copyEntered;
  const entered=new Promise(resolve=>copyEntered=resolve),wait=new Promise(resolve=>releaseCopy=resolve);
  copyGate={entered:copyEntered,wait};
  const lateCopy=await json(`/api/cms/posts/${afterMixed.id}/copy`,{method:'POST',headers:{'content-type':'application/json','x-qa-user':'mutex-copy'},body:'{}'});
  assert.equal(lateCopy.response.status,202);await entered;
  let deletion;
  try{deletion=await json(`/api/cms/posts/${afterMixed.id}`,{method:'DELETE',headers:{'content-type':'application/json','x-qa-user':'mutex-delete'},body:JSON.stringify({version:afterMixed.updatedAt})});assert.equal(deletion.response.status,200);}finally{releaseCopy();}
  const lateOutcome=await settle(lateCopy.data.job.id,'mutex-copy');assert.equal(lateOutcome.state,'failed');assert.equal(lateOutcome.error,'POST_VERSION_CHANGED');
  const deletedFinal=await fixture();assert(deletedFinal.deletedAt);assert.equal(deletedFinal.updatedAt,deletion.data.record.updatedAt,'Late copy cannot overwrite or resurrect a deleted record');
  assert(requests.filter(item=>item.url==='/responses').every(item=>item.body.service_tier==='fast'));assert(requests.filter(item=>item.url==='/images/generations').every(item=>!Object.hasOwn(item.body,'service_tier')));assert(!JSON.stringify(store).includes('data:image'));assert(store.socialPosts.every(item=>JSON.stringify(item).length<120000));
  console.log(JSON.stringify({ passed: true, asyncJobs: true, authAndCsrf: true, uploadFirst: true, pngAndEditableHtml: true, individualPngDownload:true, persistedEditsWithoutAi: true, visualRedesignWithSol:true, adaptedAnthropicSkills:true,previewReadOnlyAndCompact:true,realCmsRoleShape:true,viewerCannotEditPreview:true,previewAssetRoundtrip:true,draftBeforeExports:true,overfullManualTextPreserved:true,unsafeDownloadBlocked:true,reviewAllFive:true,reviewFailureResumable:true,noNewImagesOnReview:true,cachedApprovedReviewReused:true,copyPreservesArtworkAndReview:true,publicCopyOnlyPreservesPrivatePrompt:true,preservingReviewOmitsTextSchema:true,concurrentCheckpointsSerialized:true,checkpointTrashMutex:true,lateCopyCannotResurrect:true,boundedChangedHashReview:true,isolatedTemporaryCwd:true,paidApiCalls:false,storySafeArea:true,originalPreserved:true,palettes:4,recoverableDelete:true, networkCopies: 6, layouts: 10, sizes: Object.keys(SOCIAL_SIZES).length, output }));
  if (process.env.EJ_SOCIAL_PREVIEW === '1') console.log(`PREVIEW ${base}/admin/#posts`);
} finally {
  if(process.env.EJ_SOCIAL_PREVIEW!=='1'){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));mock.closeAllConnections();await new Promise(resolve=>mock.close(resolve));process.chdir(originalCwd);await fs.rm(isolated,{recursive:true,force:true});}
}

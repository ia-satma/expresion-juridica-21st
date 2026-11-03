import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { load } from 'cheerio';
import express from 'express';
import { buildInventory } from '../server/inventory.mjs';
import { contentCatalog, plainMarkup, replaceTemplateText, pendingFieldIds, registerContentEditorRoutes, editablePages } from '../server/content-editor.mjs';
import { registerContactFormRoute } from '../server/contact-form.mjs';
import { securityMiddleware } from '../server/web-security.mjs';
import { cmsRequestAllowed } from '../server/cms-permissions.mjs';

const inventory=buildInventory(), store={draftOverrides:{},publishedOverrides:{},submissions:[]};
let coveredVisibleTextNodes=0;
assert.equal(editablePages(inventory).length,17);assert(!editablePages(inventory).some(page=>page.page==='/areas/civil-y-mercantil/'),'Redirects must not appear as duplicate editable pages');
const allowed=(role,url,method='GET',rolePermissions)=>cmsRequestAllowed({cmsAdmin:{role},originalUrl:url,method},{rolePermissions});
assert(allowed('owner','/api/cms/users','POST'));assert(allowed('editor','/api/cms/content','POST'));assert(allowed('viewer','/api/cms/content'));
assert(!allowed('viewer','/api/cms/content','POST'));assert(!allowed('viewer','/api/cms/submissions'));assert(!allowed('editor','/api/cms/posts','POST'));
assert(!allowed('editor','/api/cms/content','POST',{editor:[]}));assert(allowed('editor','/api/cms/posts','POST',{editor:['agents']}));
for(const page of inventory.pages) {
  const catalog=contentCatalog(inventory,store,page.page);
  assert(catalog.fields.length>0);
  assert(catalog.fields.every(field=>!/<\/?(?:span|em|svg|div|p)\b/i.test(field.value)),'Editors receive text rather than template markup');
  assert.equal(new Set(catalog.fields.flatMap(field=>[field.id,...field.aliases])).size,catalog.fields.flatMap(field=>[field.id,...field.aliases]).length);
  const $=load(fs.readFileSync(page.file,'utf8')), ids=new Set(catalog.fields.flatMap(field=>[field.id,...field.aliases])), html=new Set(),direct=new Set();
  for(const field of inventory.fields.filter(field=>field.page===page.page&&ids.has(field.id))){if(field.attribute==='html')html.add($(field.selector)[0]);if(field.attribute==='text')direct.add($(field.selector)[0]);}
  function visit(node){if(node.type==='text'&&node.data.trim()){const parent=$(node.parent);if(!parent.closest('body').length||parent.closest('script,style,svg,noscript,template,.sr-only,.visually-hidden,[hidden]').length)return;coveredVisibleTextNodes++;assert(direct.has(node.parent)||parent.parents().addBack().toArray().some(node=>html.has(node)),`Visible copy must be editable on ${page.page}`);}for(const child of node.children||[])visit(child);}
  visit($.root()[0]);
}
const template='<span class="sr-only">Derecho administrativo.</span><span aria-hidden="true" class="revela"><span style="--i:0">Derecho</span> <span style="--i:1"><em>administrativo.</em></span></span>';
for(const value of ['Defensa administrativa.','Asesoría jurídica en México.','Un nuevo título','Línea uno\nLínea dos','Texto <em>literal</em>']) {
  const markup=replaceTemplateText(template,value), $=load(markup,null,false);
  assert.equal(plainMarkup(markup),value);assert.equal($('.sr-only').text(),value);
  assert.equal($('.revela span[style]').length,2);assert.equal($('em').length,1);
  assert.equal($('script').length,0);
}
const direct=load(replaceTemplateText('Antes <a href="/ruta/">enlace</a> después','Inicio y final',true),null,false);
assert.equal(direct('a').attr('href'),'/ruta/');assert.equal(direct('a').text(),'enlace');
assert.equal(direct.root().contents().toArray().filter(n=>n.type==='text').map(n=>n.data).join(''),'Inicio y final');

let base='', writes=0, failWrite=false;
const app=express();app.use(securityMiddleware({getCanonicalBase:()=>base,env:{NODE_ENV:'test'}}));app.use(express.json());
const auth=(req,_res,next)=>{req.cmsUser={id:'fixture',role:'owner',email:'fixture@invalid.test'};next();};
const csrf=(req,res,next)=>req.get('x-cms-csrf')==='fixture-csrf'?next():res.status(403).json({error:'CSRF_INVALID'});
const writeStore=async()=>{await new Promise(resolve=>setTimeout(resolve,20));if(failWrite)throw new Error('Synthetic storage failure');writes++;};
registerContentEditorRoutes(app,{getInventory:()=>inventory,store,writeStore,requireAuth:auth,requireEditor:auth,requireCsrf:csrf,audit:()=>{}});
registerContactFormRoute(app,{store,writeStore});
app.get('/api/cms/auth-state',(_req,res)=>res.json({authenticated:true,user:{id:'fixture',role:'owner',email:'fixture@invalid.test'},csrf:'fixture-csrf'}));
app.get('/api/cms/summary',(_req,res)=>res.json({pages:inventory.pages.length,fields:inventory.fields.length,draftFields:pendingFieldIds(store).length,media:0,submissions:store.submissions.length}));
app.get('/api/cms/pages',(_req,res)=>res.json({pages:editablePages(inventory).map(page=>({...page,category:page.page.startsWith('/areas/')?'Áreas de práctica':page.page.startsWith('/analisis')?'Análisis':'Páginas de la firma'}))}));
app.get('/api/cms/public',(_req,res)=>res.json({overrides:{},settings:{cookie:{version:'fixture'},analytics:{enabled:false}}}));
app.get('/api/cms/submissions',(_req,res)=>res.json({submissions:store.submissions}));
app.get('/api/cms/media',(_req,res)=>res.json({media:[],folders:[],storage:{provider:'local',scope:'fixture'}}));
app.get('/cms-bridge.js',(_req,res)=>res.sendFile(path.resolve('public/cms-bridge.js')));
app.use('/admin',express.static(path.resolve('public/admin')));
app.get('/contacto/',(_req,res)=>{const $=load(fs.readFileSync('sitio/contacto/index.html','utf8'));$('form').attr('data-cms-open-mail','false');$('body').append('<script src="/cms-bridge.js" data-cms-open-mail="false" defer></script>');res.send($.html());});
app.use(express.static(path.resolve('sitio')));
app.use((_error,_req,res,_next)=>res.status(500).json({error:'INTERNAL_ERROR'}));
const server=app.listen(process.env.EJ_CMS_PREVIEW==='1'?8799:0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;
if(process.env.EJ_CMS_PREVIEW==='1'){console.log(JSON.stringify({fixture:true,url:base+'/admin/',syntheticAuthentication:true,paidApiCalls:false}));}
else try {
  const call=async(changes,token='fixture-csrf')=>{const response=await fetch(base+'/api/cms/content',{method:'POST',headers:{'content-type':'application/json','x-cms-csrf':token,origin:base},body:JSON.stringify({changes,confirmed:true})});return {status:response.status,data:await response.json()};};
  const page='/areas/administrativo/', catalog=await(await fetch(base+'/api/cms/content?page='+encodeURIComponent(page))).json();
  const title=catalog.fields.find(field=>field.label==='Título principal');assert(title);assert(!title.value.includes('<'));
  assert.equal((await call([{id:title.id,value:'Asesoría administrativa en México.'}],'wrong')).status,403);
  assert.equal((await call([{id:title.id,value:'Asesoría administrativa en México.'},{id:'missing',value:'invalid'}])).status,400);assert.equal(Object.keys(store.draftOverrides).length,0,'Batch validation must be atomic');
  assert.equal((await call([{id:title.id,value:'Asesoría administrativa en México.'}])).status,200);
  const $=load(store.draftOverrides[title.id],null,false);assert.equal($('.sr-only').text(),'Asesoría administrativa en México.');assert($('em').length);assert.equal(plainMarkup($.html()),'Asesoría administrativa en México.');
  assert.equal(store.publishedOverrides[title.id],store.draftOverrides[title.id],'Confirmed save is visible without a separate publish step');assert.equal(pendingFieldIds(store).length,0);
  const home=contentCatalog(inventory,store,'/');const duplicate=home.fields.find(field=>field.aliases.length&&field.category==='text'&&!field.shared&&field.value.length>80);assert(duplicate,'Responsive copies must be grouped');
  const value='Texto de prueba para todas las vistas de la página.';assert.equal((await call([{id:duplicate.id,value}])).status,200);
  for(const id of [duplicate.id,...duplicate.aliases])assert.equal(plainMarkup(store.draftOverrides[id]),value);
  assert.equal((await call([{id:duplicate.id,value:duplicate.originalValue}])).status,200);for(const id of [duplicate.id,...duplicate.aliases])assert(!Object.hasOwn(store.draftOverrides,id),'Restoring source copy must restore exact markup');
  assert.equal(pendingFieldIds(store).length,0,'Confirmed saves have no pending publish step');
  assert.equal((await call([{id:title.id,value:title.originalValue}])).status,200);assert.equal(pendingFieldIds(store).length,0,'Restoring source is also saved publicly in one step');assert(!Object.hasOwn(store.publishedOverrides,title.id));
  const unrelated=catalog.fields.find(field=>field.label==='Párrafo'&&field.kind==='html'&&!field.shared);
  store.draftOverrides[unrelated.id]='Un cambio anterior que todavía requiere aprobación.';
  assert.equal((await call([{id:title.id,value:'Otra asesoría de prueba.'}])).status,200);
  assert(!Object.hasOwn(store.publishedOverrides,unrelated.id),'Saving approved changes must not publish an unrelated pending edit');
  assert.equal(store.draftOverrides[unrelated.id],'Un cambio anterior que todavía requiere aprobación.');
  const originalHeading=inventory.fields.find(field=>field.id===title.id);
  const legacyChild=inventory.fields.find(field=>field.page===page&&field.attribute==='html'&&field.original==='Derecho'&&field.selector.startsWith(originalHeading.selector+' > '));assert(legacyChild);
  store.draftOverrides[legacyChild.id]='Asesoría';
  const withLegacy=await(await fetch(base+'/api/cms/content?page='+encodeURIComponent(page))).json();
  const pendingHeading=withLegacy.pendingChanges.find(field=>field.id===title.id);assert(pendingHeading&&pendingHeading.value.includes('Asesoría'),'Previous child edits must be shown in the new parent editor');
  assert.equal((await call([{id:title.id,value:pendingHeading.value}])).status,200);assert(!Object.hasOwn(store.draftOverrides,legacyChild.id));assert(!Object.hasOwn(store.publishedOverrides,legacyChild.id));
  assert(!Object.hasOwn(store.publishedOverrides,unrelated.id));
  const previous=JSON.stringify({draft:store.draftOverrides,published:store.publishedOverrides});failWrite=true;
  assert.equal((await call([{id:title.id,value:'Este texto no debe guardarse si falla el disco.'}])).status,500);failWrite=false;assert.equal(JSON.stringify({draft:store.draftOverrides,published:store.publishedOverrides}),previous,'Failed writes must roll back both public and working state');
  const nav=home.fields.find(field=>field.shared&&field.category==='text'&&field.kind==='html'&&field.originalValue==='La firma');assert(nav);
  const sharedPages=inventory.pages.filter(page=>contentCatalog(inventory,store,page.page).fields.some(field=>field.shared&&field.originalValue==='La firma'));
  assert.equal((await call([{id:nav.id,value:'La firma institucional'}])).status,200);
  for(const page of sharedPages)assert(contentCatalog(inventory,store,page.page).fields.some(field=>field.shared&&field.originalValue==='La firma'&&field.savedValue==='La firma institucional'),`Shared navigation saved on ${page.page}`);
  const invalidLink=catalog.fields.find(field=>field.kind==='link');assert.equal((await call([{id:invalidLink.id,value:'javascript:alert(1)'}])).status,400);
  const contact={nombre:'Persona de prueba',correo:'contact-fixture@invalid.test',materia:'Administrativo',mensaje:'Texto de prueba completo con acentos: asesoría jurídica.',privacidad:true,requestKey:'00000000-0000-4000-8000-000000000001'};
  const send=async data=>{const response=await fetch(base+'/api/public/contact',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify(data)});return {status:response.status,data:await response.json()};};
  const receipt=await send(contact);assert.equal(receipt.status,201);assert.equal(receipt.data.contactEmail,'Consultoria@expresionjuridica.com');assert.equal(store.submissions[0].message,contact.mensaje);
  assert.equal((await send(contact)).status,200);assert.equal(store.submissions.length,1,'Retries keep one copy');
  failWrite=true;assert.equal((await send({...contact,requestKey:'00000000-0000-4000-8000-000000000002'})).status,500);assert.equal(store.submissions.length,1,'Failed persistence must not claim success');failWrite=false;
  assert.equal((await send({...contact,mensaje:'x'.repeat(601)})).status,422);
  console.log(JSON.stringify({passed:true,pages:inventory.pages.length,coveredVisibleTextNodes,plainTextEditors:true,styledAccessibleHeadings:true,responsiveCopies:duplicate.aliases.length+1,atomicBatchSave:true,csrfEnforced:true,exactRestore:true,confirmedSaveImmediatelyPublic:true,unrelatedDraftsPreserved:true,legacyEditsReviewable:true,sharedNavigationSaved:true,failedSaveRolledBack:true,contactSavedBeforeReceipt:true,contactRetryDeduplicated:true,contactStorageFailureReported:true,writes}));
} finally {await new Promise(resolve=>server.close(resolve));}

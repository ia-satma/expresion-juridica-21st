import { createGenerationProgress } from './generation-progress.js?v=20261103-layout6';
import { confirmLibraryRemoval } from './library-actions.js?v=20261103-layout6';
import { SOCIAL_FORMATS, SOCIAL_SIZES as SIZES, SOCIAL_SIZE_LABELS as SIZE_LABELS } from './social-formats.js?v=20261103-layout6';
const NETWORKS = { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', x: 'X', threads: 'Threads', tiktok: 'TikTok' };

export function createSocialStudio({ api, state, notify, escapeHtml: h, formatDate }) {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  if (!$('#posts-form')) return { load: async () => {} };
  const studio = { library: [], saved: null, draft: null, index: 0, network: 'linkedin', busy: false, dirty: false, polling: null, configured: false, trash:false, previewValidations:new Map(),v2Pieces:new Set() };
  let previewTimer,previewToken=0,previewController,frameReady=null;
  let previewAssets={fonts:{},images:{}},previewAssetPieces=new Set(),editingField=null,currentScene=null;
  const progress=createGenerationProgress($('#posts-progress'),'social');
  $('#posts-size').innerHTML=Object.entries(SOCIAL_FORMATS).map(([id,format])=>`<option value="${id}">${h(format.label)} · ${format.dimensions.join(' × ')}</option>`).join('');
  function formatHelp(){const format=SOCIAL_FORMATS[$('#posts-size').value];$('#posts-format-help').textContent=`Recomendado para ${format.recommended}. ${format.note}`;}
  $('#posts-size').addEventListener('change',formatHelp);formatHelp();
  const paletteLabels={'navy-gold':'Azul y dorado',editorial:'Blanco editorial',ivory:'Marfil y azul',graphite:'Grafito y dorado'};
  const paletteColors={'navy-gold':['#141A3A','#D9BC88','#F4F4F4'],editorial:['#FFFFFF','#141A3A','#D9BC88'],ivory:['#F7F2E8','#141A3A','#B08D57'],graphite:['#0B0F1E','#F4F4F4','#D9BC88']};
  function palettePreview(){const colors=paletteColors[$('#posts-palette').value]||['#141A3A','#D9BC88','#FFFFFF','#F7F2E8','#0B0F1E'];$('#posts-palette-preview').innerHTML=colors.map(color=>`<i style="background:${color}"></i>`).join('');}
  const attachments = { documents: [], supportImages: [] };
  const canEdit = () => ['owner', 'editor'].includes(state.user?.role);
  const clone = value => JSON.parse(JSON.stringify(value));
  const fieldLabels={headline:'Título',body:'Texto',eyebrow:'Encabezado breve',bullets:'Puntos clave',cta:'Llamada a la acción'};
  const filesOf=record=>({png:record?.files?.png||[],html:record?.files?.html||[],pack:record?.files?.pack||null,copy:record?.files?.copy||null});
  function downloadsReady(record=studio.saved){
    if(!record)return false;
    return !['needs-adjustment','review-pending','review-needs-attention'].includes(record.renderStatus)&&record.layoutValidation?.valid!==false&& !['pending','needs-review','unavailable'].includes(record.visualReview?.state);
  }
  function setFileLink(element,url,download=false){if(url)element.href=url+(download?(url.includes('?')?'&':'?')+'download=1':'');else element.removeAttribute('href');}
  function issueMessage(issue){
    if(typeof issue==='string'&&!/^[A-Z_]+$/.test(issue))return issue;
    if(issue?.message)return issue.message;
    const field=fieldLabels[issue?.field]||'el contenido';
    return /SMALL|SIZE|READAB/i.test(issue?.code||issue||'')?`El texto de ${field.toLowerCase()} necesita más espacio para leerse bien.`:/OVERLAP|COLLISION/i.test(issue?.code||issue||'')?`Hay elementos demasiado juntos en ${field.toLowerCase()}.`:`Ajusta ${field.toLowerCase()} o elige una composición con más espacio.`;
  }
  function renderFeedback(previewValidation){
    const record=studio.saved;if(!record)return;
    const validation=previewValidation||studio.previewValidations.get(studio.index)||record.layoutValidation;
    const issues=validation?.issues||[];
    const invalid=validation?.valid===false,reviewState=record.visualReview?.state;
    const needsReview=['pending','needs-review','unavailable'].includes(reviewState)||['review-pending','review-needs-attention'].includes(record.renderStatus);
    const banner=$('#posts-layout-feedback');banner.hidden=!invalid&&!needsReview&&record.renderStatus!=='needs-adjustment';
    banner.dataset.state=invalid||record.renderStatus==='needs-adjustment'?'adjustment':needsReview?'review':'ready';
    $('#posts-layout-feedback-title').textContent=invalid||record.renderStatus==='needs-adjustment'?(studio.dirty?'Esta pieza necesita un ajuste':'Guardado: falta ajustar la composición'):'Guardado: revisión visual pendiente';
    $('#posts-layout-feedback-message').textContent=invalid||record.renderStatus==='needs-adjustment'?'Tu texto está conservado. Puedes acortarlo, moverlo al copy o cambiar la composición. Guarda los ajustes; las descargas estarán disponibles cuando el diseño quede listo.':reviewState==='needs-review'?'La revisión visual encontró detalles que conviene corregir. Puedes ajustar el diseño y volver a revisarlo.':'El diseño está guardado. Puedes reintentar la revisión visual para preparar las descargas.';
    const list=$('#posts-layout-issues');list.replaceChildren();
    for(const issue of issues.slice(0,5)){const item=document.createElement('li');item.textContent=issueMessage(issue);list.append(item);}
    list.hidden=!issues.length;
    $('#posts-retry-review').hidden=!needsReview||invalid||record.renderStatus==='needs-adjustment';
  }
  function error(message = '') { $('#posts-error').textContent = message; $('#posts-error').hidden = !message; }
  function markDirty() {
    studio.dirty = true;
    $('#posts-edit-state').textContent = 'Cambios sin aplicar';
    $('#posts-copy-note').textContent = 'Aplica los cambios para actualizar el kit y las descargas. Puedes copiar el texto de esta red inmediatamente.';
    syncButtons();
  }
  function syncButtons() {
    $('#posts-generate').disabled = studio.busy || !canEdit();
    $('#posts-save').disabled = studio.busy || !canEdit() || !studio.draft;
    $('#posts-save-copy').disabled = studio.busy || !canEdit() || !studio.draft;
    $('#posts-regenerate-copy').disabled = studio.busy || !canEdit() || !studio.configured || !studio.draft;
    $('#posts-redesign').disabled=studio.busy||!canEdit()||!studio.configured||!studio.draft||studio.dirty;
    $('#posts-redesign-instructions').disabled=studio.busy||!canEdit();
    $('#posts-redesign-palette').disabled=studio.busy||!canEdit();
    $('#posts-retry-review').disabled=studio.busy||!canEdit()||!studio.configured||!studio.saved||studio.dirty;
    $('#posts-revert').disabled = studio.busy || !studio.draft;
    $('#posts-count').disabled = studio.busy || !canEdit() || $('#posts-mode').value === 'single';
    for (const control of $$('#posts-form input, #posts-form select, #posts-form textarea')) {
      if (control.id !== 'posts-count') control.disabled = studio.busy || !canEdit();
    }
    for (const control of $$('#posts-edit-form input, #posts-edit-form select, #posts-edit-form textarea')) control.disabled = studio.busy || !canEdit();
    $('#posts-copy-text').readOnly = studio.busy || !canEdit();
    $('#posts-canvas-editor-text').readOnly=studio.busy||!canEdit();
    for (const element of $('#posts-canvas').contentDocument?.querySelectorAll('[data-field]') || []) element.setAttribute('contenteditable','false');
    for (const link of $$('#posts-result a[download]')) {
      const disabled=studio.busy||studio.dirty||!downloadsReady()||!link.hasAttribute('href');
      link.setAttribute('aria-disabled',String(disabled));link.classList.toggle('social-download-pending',disabled);
    }
    $('#posts-copy-html').disabled=studio.busy||studio.dirty||!downloadsReady()||!filesOf(studio.draft).html[studio.index];
    $('#posts-generate').textContent = studio.busy ? 'El agente está trabajando…' : studio.configured ? $('#posts-mode').value === 'single' ? 'Generar post y copy' : 'Generar carrusel y copy' : 'Generar prueba de diseño';
  }
  function renderFiles(field) {
    const list = $(field === 'documents' ? '#posts-documents-list' : '#posts-support-list');
    list.innerHTML = attachments[field].map((file, index) => `<li><span>${h(file.name)} <small>${(file.size / 1048576).toFixed(1)} MB</small></span><button class="text-action" type="button" data-file-index="${index}" aria-label="Quitar ${h(file.name)}">Quitar</button></li>`).join('');
    for (const button of list.querySelectorAll('button')) button.addEventListener('click', () => { if (!studio.busy) { attachments[field].splice(Number(button.dataset.fileIndex), 1); renderFiles(field); } });
  }
  function addFiles(event, field) {
    const selected = [...(event.target.files || [])]; event.target.value = '';
    if (studio.busy) return;
    const allowed = field === 'documents' ? /\.(pdf|docx|txt|md)$/i : /\.(png|jpe?g|webp)$/i;
    const next = [...attachments[field]];
    for (const file of selected) {
      if (!allowed.test(file.name)) return error('Ese formato no está admitido. Revisa los tipos de archivo junto al botón.');
      if (file.size > 100 * 1048576) return error('Cada archivo admite hasta 100 MB.');
      if (!next.some(item => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) next.push(file);
    }
    if (next.length > (field === 'documents' ? 20 : 10)) return error(`Puedes subir hasta ${field === 'documents' ? '20 documentos' : '10 imágenes de apoyo'}.`);
    const other = attachments[field === 'documents' ? 'supportImages' : 'documents'];
    if ([...next, ...other].reduce((sum, file) => sum + file.size, 0) > 200 * 1048576) return error('La selección supera 200 MB en total.');
    attachments[field] = next; renderFiles(field); error();
  }
  function renderLibrary() {
    const items=studio.library.filter(item=>Boolean(item.deletedAt)===studio.trash);
    $('#posts-trash-toggle').textContent=studio.trash?'Volver a diseños':'Ver papelera';$('#posts-trash-toggle').setAttribute('aria-pressed',String(studio.trash));
    $('#posts-history').innerHTML = items.map(item => `<article class="social-history-row">${studio.trash||!downloadsReady(item)||!filesOf(item).png[0]?'<div class="social-trash-thumbnail" aria-hidden="true">EJ</div>':`<img src="${h(filesOf(item).png[0])}&v=${encodeURIComponent(item.updatedAt)}" alt="${h(item.posts[0]?.altText || item.title)}" loading="lazy"/>`}<div><small>${h(formatDate(item.updatedAt))}</small><h3>${h(item.title)}</h3><p>${item.count} ${item.count === 1 ? 'pieza' : 'piezas'} · ${h(SIZE_LABELS[item.size] || item.size)} · ${item.aiUsed ? h(item.model) : 'Prueba sin IA'}${!downloadsReady(item)?' · Requiere revisión':''}</p></div><div class="library-row-actions">${studio.trash?`<button type="button" class="button button-secondary" data-restore-post="${h(item.id)}" ${!canEdit()?'disabled':''}>Restaurar</button>`:`<button type="button" class="button button-secondary" data-open-post="${h(item.id)}">Abrir estudio</button><button type="button" class="text-action library-trash-action" data-delete-post="${h(item.id)}" ${!canEdit()?'disabled':''}>Eliminar</button>`}</div></article>`).join('') || `<div class="empty-state"><strong>${studio.trash?'La papelera está vacía.':'Aún no hay diseños'}</strong><span>${studio.trash?'Los diseños eliminados aparecerán aquí.':'Genera un post o carrusel para abrir el estudio.'}</span></div>`;
    for (const button of $$('#posts-history [data-open-post]')) button.addEventListener('click', () => {
      if (studio.busy) return;
      const item = studio.library.find(record => record.id === button.dataset.openPost);
      if (item) { openRecord(item); $('#posts-result').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
    for(const button of $$('#posts-history [data-delete-post],#posts-history [data-restore-post]'))button.addEventListener('click',async()=>{
      if(studio.busy)return;const restore=Boolean(button.dataset.restorePost),id=button.dataset.restorePost||button.dataset.deletePost,item=studio.library.find(record=>record.id===id);
      if(!item||!restore&&!await confirmLibraryRemoval(item.title))return;
      studio.busy=true;syncButtons();button.disabled=true;
      try{await api(`/api/cms/posts/${id}${restore?'/restore':''}`,{method:restore?'POST':'DELETE',body:{version:item.updatedAt}});if(studio.saved?.id===id){studio.saved=null;studio.draft=null;studio.dirty=false;$('#posts-result').hidden=true;}notify(restore?'Diseño restaurado.':'Diseño movido a la papelera.');await load();}catch{error('No se pudo actualizar el diseño. Vuelve a intentarlo.');}finally{studio.busy=false;syncButtons();}
    });
  }
  function captionCount() {
    const text = $('#posts-copy-text').value;
    $('#posts-copy-count').textContent = `${[...text].length.toLocaleString('es-MX')} caracteres${studio.network === 'x' ? ' · X' : studio.network === 'threads' ? ' · Threads' : ''}`;
  }
  function renderCopy() {
    $('#posts-copy-tabs').innerHTML = Object.entries(NETWORKS).map(([id, label]) => `<button type="button" role="tab" aria-selected="${studio.network === id}" data-network="${id}">${label}</button>`).join('');
    for (const button of $$('#posts-copy-tabs button')) button.addEventListener('click', () => { studio.network = button.dataset.network; renderCopy(); });
    $('#posts-copy-text').value = studio.draft?.copies[studio.network] || ''; captionCount();
  }
  function readInspector() {
    if (!studio.draft) return;
    const post = studio.draft.posts[studio.index];
    Object.assign(post, { layout: $('#posts-edit-layout').value, design:{...(post.design||{}),palette:$('#posts-edit-palette').value,background:$('#posts-edit-background').value,imagePosition:$('#posts-edit-image-position').value,imageShare:$('#posts-edit-image-share').value,align:$('#posts-edit-alignment').value,panel:$('#posts-edit-panel').value}, eyebrow: $('#posts-edit-eyebrow').value, headline: $('#posts-edit-headline').value, body: $('#posts-edit-body').value, bullets: $('#posts-edit-bullets').value.split('\n').map(value => value.trim()).filter(Boolean), cta: $('#posts-edit-cta').value, altText: $('#posts-edit-alt').value });
  }
  function fillInspector() {
    const post = studio.draft.posts[studio.index];
    for (const key of ['layout', 'eyebrow', 'headline', 'body', 'cta']) $(`#posts-edit-${key}`).value = post[key] || '';
    $('#posts-edit-palette').value=post.design?.palette||(['typographic','steps','frame'].includes(post.layout)?'navy-gold':'editorial');
    for(const [id,key,fallback] of [['background','background','auto'],['image-position','imagePosition','auto'],['image-share','imageShare','balanced'],['alignment','align','left'],['panel','panel','plain']])$(`#posts-edit-${id}`).value=post.design?.[key]||fallback;
    $('#posts-edit-bullets').value = (post.bullets || []).join('\n'); $('#posts-edit-alt').value = post.altText || '';
    $('#posts-piece-label').textContent = `Pieza ${studio.index + 1} de ${studio.draft.count}`;
    setFileLink($('#posts-download-png'),filesOf(studio.draft).png[studio.index],true);
    setFileLink($('#posts-download-html'),filesOf(studio.draft).html[studio.index],true);
  }
  function closeCanvasEditor(){editingField=null;$('#posts-canvas-editor').hidden=true;}
  function editField(field,box){
    if(!canEdit()||studio.busy||!studio.draft)return;
    const post=studio.draft.posts[studio.index];
    if(!['headline','body','eyebrow','bullets','cta'].includes(field)&&!/^bullet-\d+$/.test(field))return;
    editingField=field;const input=$('#posts-canvas-editor-text');
    input.value=field==='bullets'?(post.bullets||[]).join('\n'):field.startsWith('bullet-')?(post.bullets||[])[Number(field.slice(7))]||'':post[field]||'';
    $('#posts-canvas-editor-label').textContent=`Editar ${field.startsWith('bullet-')?'punto clave':(fieldLabels[field]||'texto').toLowerCase()}`;
    $('#posts-canvas-editor').hidden=false;positionCanvasEditor(box);input.focus();
  }
  function positionCanvasEditor(box){
    if(!editingField)return;
    const wrap=$('#posts-canvas-wrap'),panel=$('#posts-canvas-editor');
    const scale=wrap.clientWidth/(currentScene?.w||SIZES[studio.draft?.size]?.[0]||1080);
    const desired=box?Math.max(12,box.y*scale-26):24;
    panel.style.top=`${Math.max(12,Math.min(desired,wrap.clientHeight-panel.offsetHeight-12))}px`;
  }
  function bindLegacyFields(){
    const frame=$('#posts-canvas'),doc=frame.contentDocument;if(!doc)return;
    for(const element of doc.querySelectorAll('[data-field]')){
      element.contentEditable='false';element.style.cursor=canEdit()?'text':'default';
      element.onclick=()=>{const rect=element.getBoundingClientRect();const native=SIZES[studio.draft.size]?.[0]||1080;editField(element.dataset.field,{x:rect.x/frame.clientWidth*native,y:rect.y/frame.clientWidth*native,w:rect.width/frame.clientWidth*native,h:rect.height/frame.clientWidth*native});};
      element.onkeydown=event=>{if(event.key==='Enter'&&canEdit()){event.preventDefault();element.click();}};
      element.tabIndex=canEdit()?0:-1;
    }
  }
  function stopPreview(){clearTimeout(previewTimer);previewTimer=null;previewController?.abort();previewController=null;previewToken++;}
  function requestPreview(immediate=false){
    if(!studio.draft||studio.busy)return;
    stopPreview();studio.v2Pieces.add(studio.index);
    const index=studio.index,id=studio.draft.id,token=previewToken;
    const run=()=>loadSolvedPreview({id,index,token});
    if(immediate)run();else previewTimer=setTimeout(run,300);
  }
  async function sceneDocument(){
    const frame=$('#posts-canvas');
    if(frame.dataset.sceneMode==='v2'&&frame.contentDocument?.getElementById('social-scene-root'))return frame.contentDocument;
    if(frameReady)return frameReady;
    frame.dataset.sceneMode='v2';
    frameReady=new Promise(resolve=>{
      frame.addEventListener('load',()=>resolve(frame.contentDocument),{once:true});
      frame.removeAttribute('src');
      frame.srcdoc='<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f4f4f4}svg{display:block;width:100%;height:100%}[data-field]{cursor:text}[data-field]:focus{outline:1px dashed #b08d57;outline-offset:4px}text{font-kerning:none;font-variant-ligatures:none;font-feature-settings:"kern" 0,"liga" 0,"clig" 0,"rlig" 0;white-space:pre}</style></head><body><svg id="social-scene-root" xmlns="http://www.w3.org/2000/svg" role="group" aria-label="Vista del diseño"></svg></body></html>';
    });
    return frameReady;
  }
  const svgNamespace='http://www.w3.org/2000/svg';
  const base64=value=>typeof value==='string'&&/^[A-Za-z0-9+/=\s]+$/.test(value)?value.replace(/\s+/g,''):null;
  const number=value=>Number.isFinite(Number(value))?Number(value):0;
  function color(value,fallback='#141A3A'){return /^#[a-f\d]{3,8}$/i.test(String(value))||['none','transparent'].includes(value)?value:fallback;}
  async function renderScene(scene,token){
    if(!scene||!Array.isArray(scene.nodes)||!Number.isFinite(scene.w)||!Number.isFinite(scene.h)||scene.w<=0||scene.h<=0)throw Error('PREVIEW_INVALID');
    const doc=await sceneDocument();if(token!==previewToken)return;
    const svg=doc.getElementById('social-scene-root');svg.setAttribute('viewBox',`0 0 ${scene.w} ${scene.h}`);
    svg.setAttribute('aria-label',studio.draft.posts[studio.index].altText||studio.draft.posts[studio.index].headline||'Diseño de la pieza');
    let fonts=doc.getElementById('social-scene-fonts');if(!fonts){fonts=doc.createElement('style');fonts.id='social-scene-fonts';doc.head.append(fonts);}
    const heading=base64(previewAssets.fonts.heading),body=base64(previewAssets.fonts.body);
    if(!heading||!body)throw Error('PREVIEW_ASSETS_UNAVAILABLE');
    if(!fonts.textContent)fonts.textContent=`@font-face{font-family:EJCaslon;src:url(data:font/ttf;base64,${heading}) format('truetype');font-style:italic;font-weight:400}@font-face{font-family:EJBahnschrift;src:url(data:font/ttf;base64,${body}) format('truetype');font-weight:300}`;
    const element=(tag,attributes={})=>{const node=doc.createElementNS(svgNamespace,tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));return node;};
    const fragment=doc.createDocumentFragment(),defs=element('defs'),gradientIds=new Set();
    for(const gradient of scene.gradients||[]){
      if(!/^[a-z][\w-]{0,120}$/i.test(gradient.id)||!['linear','radial'].includes(gradient.type))continue;
      const node=element(gradient.type==='radial'?'radialGradient':'linearGradient',{id:gradient.id,gradientUnits:'userSpaceOnUse'});
      for(const key of gradient.type==='radial'?['cx','cy','r']:['x1','y1','x2','y2'])node.setAttribute(key,number(gradient[key]));
      for(const stop of gradient.stops||[])node.append(element('stop',{offset:Math.max(0,Math.min(1,number(stop.offset))), 'stop-color':color(stop.color),'stop-opacity':stop.opacity===undefined?1:Math.max(0,Math.min(1,number(stop.opacity)))}));
      defs.append(node);gradientIds.add(gradient.id);
    }
    fragment.append(defs);
    function fill(value){const match=/^url\(#([a-z][\w-]{0,120})\)$/i.exec(String(value));return match&&gradientIds.has(match[1])?value:color(value,'none');}
    for(const item of scene.nodes){
      let node;
      if(item.type==='rect')node=element('rect',{x:number(item.x),y:number(item.y),width:number(item.w),height:number(item.h),rx:number(item.rx||item.radius),fill:fill(item.fill)});
      else if(item.type==='circle')node=element('circle',{cx:number(item.cx??number(item.x)+number(item.r)),cy:number(item.cy??number(item.y)+number(item.r)),r:number(item.r),fill:fill(item.fill)});
      else if(item.type==='line')node=element('line',{x1:number(item.x??item.x1),y1:number(item.y??item.y1),x2:number(item.x2),y2:number(item.y2),stroke:color(item.color||item.stroke),'stroke-width':number(item.strokeWidth||1.5)});
      else if(item.type==='path'){
        if(typeof item.d!=='string'||item.d.length>20000||!/^[MmZzLlHhVvCcSsQqTtAa0-9+.,\s-]+$/.test(item.d))continue;
        node=element('path',{d:item.d,fill:fill(item.fill)});if(item.stroke)node.setAttribute('stroke',color(item.stroke));if(item.strokeWidth)node.setAttribute('stroke-width',number(item.strokeWidth));
        if(/^scale\(\d+(?:\.\d+)?\)$/.test(item.transform||''))node.setAttribute('transform',item.transform);
      }else if(item.type==='image'){
        const source=base64(previewAssets.images[item.assetId]);if(!source)throw Error('PREVIEW_ASSETS_UNAVAILABLE');
        node=element('image',{x:number(item.x),y:number(item.y),width:number(item.w),height:number(item.h),href:`data:image/png;base64,${source}`,preserveAspectRatio:item.fit==='contain'?'xMidYMid meet':'xMidYMid slice'});
      }else if(item.type==='text'){
        node=element('g');
        for(const line of item.lines||[]){const run=element('text',{x:number(line.x),y:number(line.baseline),'font-family':item.font==='heading'?'EJCaslon':'EJBahnschrift','font-size':number(item.size),'font-style':item.font==='heading'?'italic':'normal','font-weight':item.font==='heading'?400:300,fill:color(item.color),'xml:space':'preserve'});run.textContent=String(line.text||'');node.append(run);}
        if(item.field){
          const hit=item.bounds||item.box;if(hit&&hit.w>0&&hit.h>0){const area=element('rect',{x:number(hit.x)-3,y:number(hit.y)-3,width:number(hit.w)+6,height:number(hit.h)+6,fill:'transparent','pointer-events':'all'});node.prepend(area);}
          node.dataset.field=item.field;node.setAttribute('role','button');node.setAttribute('tabindex',canEdit()?'0':'-1');node.setAttribute('aria-label',`Editar ${(fieldLabels[item.field]||'texto').toLowerCase()}`);
          node.onclick=()=>editField(item.field,item.box||item.bounds);node.onkeydown=event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();editField(item.field,item.box||item.bounds);}};
        }
      }
      if(!node)continue;if(item.id)node.dataset.nodeId=String(item.id);if(item.opacity!==undefined)node.setAttribute('opacity',Math.max(0,Math.min(1,number(item.opacity))));fragment.append(node);
    }
    await Promise.all([doc.fonts.load('italic 400 16px EJCaslon'),doc.fonts.load('300 16px EJBahnschrift')]);if(token!==previewToken)return;
    svg.replaceChildren(fragment);currentScene=scene;
    if(editingField){const active=scene.nodes.find(node=>node.field===editingField);positionCanvasEditor(active?.box||active?.bounds);}
  }
  async function loadSolvedPreview({id,index,token}){
    if(token!==previewToken||studio.draft?.id!==id||studio.index!==index)return;
    const frame=$('#posts-canvas'),preview=$('#posts-preview-state');preview.hidden=false;preview.dataset.mode=studio.loadingRecord?'loading':frame.dataset.sceneMode?'updating':'loading';preview.textContent='Ajustando la composición…';frame.setAttribute('aria-busy','true');
    previewController=new AbortController();const signal=previewController.signal;
    const payload={version:studio.saved.updatedAt,piece:index,post:clone(studio.draft.posts[index]),includeAssets:!previewAssetPieces.has(index)||!previewAssets.fonts.heading};
    try{
      let result=await api(`/api/cms/posts/${encodeURIComponent(id)}/preview`,{method:'POST',body:payload,signal});
      if(token!==previewToken)return;
      function mergeAssets(assets){if(!assets)return;Object.assign(previewAssets.fonts,assets.fonts||{});Object.assign(previewAssets.images,assets.images||{});}
      mergeAssets(result.assets);
      const missing=()=>!previewAssets.fonts.heading||!previewAssets.fonts.body||(result.scene?.nodes||[]).some(node=>node.type==='image'&&!previewAssets.images[node.assetId]);
      if(missing()&&!payload.includeAssets){result=await api(`/api/cms/posts/${encodeURIComponent(id)}/preview`,{method:'POST',body:{...payload,includeAssets:true},signal});if(token!==previewToken)return;mergeAssets(result.assets);}
      if(missing())throw Error('PREVIEW_ASSETS_UNAVAILABLE');
      previewAssetPieces.add(index);studio.previewValidations.set(index,result.validation||{valid:false,issues:[]});
      await renderScene(result.scene,token);if(token!==previewToken)return;
      frame.dataset.layoutVersion=String(result.layoutVersion||2);frame.dataset.previewHash=String(result.hash||'');
      preview.hidden=true;frame.style.visibility='';studio.loadingRecord=false;frame.removeAttribute('aria-busy');renderFeedback(result.validation);syncButtons();
    }catch(failure){
      if(token!==previewToken||failure.name==='AbortError')return;
      preview.dataset.mode=studio.loadingRecord?'loading':'updating';preview.textContent=failure.code==='POST_VERSION_CHANGED'?'Este diseño cambió en otra pestaña. Tu texto se conserva; guarda una versión actualizada desde la biblioteca.':'No se pudo actualizar la vista. Tu texto se conserva; vuelve a modificar un campo o selecciona de nuevo la pieza.';frame.removeAttribute('aria-busy');
    }
  }
  async function selectPiece(index) {
    if(studio.busy||!studio.draft?.posts[index])return;
    readInspector();closeCanvasEditor();stopPreview();studio.index=index;
    for(const button of $$('#posts-piece-strip button'))button.setAttribute('aria-pressed',String(Number(button.dataset.piece)===index));
    fillInspector();renderFeedback();
    const [width,height]=SIZES[studio.draft.size]||SIZES.portrait;$('#posts-canvas-wrap').style.aspectRatio=`${width}/${height}`;
    const html=filesOf(studio.draft).html[index];
    if(Number(studio.draft.layoutVersion)>=2||studio.v2Pieces.has(index)||!html){syncButtons();requestPreview(true);return;}
    const frame=$('#posts-canvas'),token=previewToken,preview=$('#posts-preview-state');preview.hidden=false;preview.dataset.mode='loading';preview.textContent='Cargando diseño guardado…';frame.setAttribute('aria-busy','true');frame.dataset.sceneMode='legacy';frameReady=null;currentScene=null;
    try{
      const response=await fetch(`${html}&v=${encodeURIComponent(studio.draft.updatedAt)}`,{credentials:'include'});
      if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))throw Error('POST_PREVIEW_UNAVAILABLE');
      const source=await response.text();if(token!==previewToken)return;
      frame.onload=async()=>{if(token!==previewToken)return;bindLegacyFields();await frame.contentDocument?.fonts?.ready;if(token!==previewToken)return;preview.hidden=true;frame.style.visibility='';studio.loadingRecord=false;frame.removeAttribute('aria-busy');};frame.removeAttribute('src');frame.srcdoc=source;
    }catch{if(token===previewToken){preview.textContent='No se pudo cargar la vista. Selecciona de nuevo la pieza o actualiza el historial.';frame.removeAttribute('aria-busy');}}
    syncButtons();
  }
  function openRecord(record, preserveSelection = false) {
    const index = preserveSelection ? Math.min(studio.index, record.count - 1) : 0;
    stopPreview();closeCanvasEditor();
    if(studio.saved?.id!==record.id){previewAssets={fonts:{},images:{}};previewAssetPieces=new Set();}
    studio.previewValidations.clear();studio.v2Pieces.clear();
    studio.saved = clone(record); studio.draft = clone(record); studio.dirty = false;
    studio.loadingRecord=true;$('#posts-canvas').style.visibility='hidden';
    $('#posts-result').hidden = false;
    $('#posts-result-title').textContent = record.title;
    $('#posts-design-notes').textContent=record.designNotes||'';$('#posts-design-notes').hidden=!record.designNotes;
    $('#posts-redesign-palette').value=record.requestedPalette||'auto';
    $('#posts-result-meta').textContent = `${record.count} ${record.count === 1 ? 'pieza' : 'piezas'} · ${SIZES[record.size]?.join(' × ') || record.size} · ${record.aiUsed ? `Contenido: ${record.model}` : 'Prueba sin IA'}${record.imageModel ? ` · Fotos: ${record.imageModel}` : ''}`;
    setFileLink($('#posts-download-pack'),filesOf(record).pack);setFileLink($('#posts-download-copy'),filesOf(record).copy);
    $('#posts-edit-state').textContent = downloadsReady(record)?'Guardado':'Guardado · pendiente de ajuste o revisión'; $('#posts-copy-note').textContent = 'Puedes ajustar y copiar el texto de cada red. Las descargas se preparan cuando el diseño queda listo.';
    $('#posts-piece-strip').innerHTML = record.posts.map((post,piece)=>{const url=downloadsReady(record)?filesOf(record).png[piece]:null;return `<div class="social-piece-tile"><button type="button" data-piece="${piece}" aria-label="Editar pieza ${piece+1}" aria-pressed="${piece===index}">${url?`<img src="${h(url)}&v=${encodeURIComponent(record.updatedAt)}" alt="${h(post.altText||'')}" loading="lazy"/>`:'<div class="social-piece-placeholder" aria-hidden="true">EJ<small>Diseño en revisión</small></div>'}<span>${String(piece+1).padStart(2,'0')} · ${h(paletteLabels[post.design?.palette]||'EJ')}</span></button><a class="social-piece-download" ${url?`href="${h(url)}&download=1"`:''} download aria-label="Descargar imagen ${piece+1} en PNG">Descargar PNG</a></div>`;}).join('');
    for (const button of $$('#posts-piece-strip [data-piece]')) button.addEventListener('click', () => selectPiece(Number(button.dataset.piece)));
    $('#posts-editorial-details').hidden=!record.editorialDetails?.length;$('#posts-editorial-details-text').textContent=(record.editorialDetails||[]).map(item=>`Pieza ${item.piece+1}\n${[item.headline,item.body,...(item.bullets||[]),item.cta].filter(Boolean).join('\n')}`).join('\n\n');
    $('#posts-result-meta').dataset.requestedTier=record.serviceTier?.requested||'';$('#posts-result-meta').dataset.servedTier=record.serviceTier?.served||'';
    const sources = (record.sources || []).filter(source => /^https?:\/\//i.test(source.url || ''));
    $('#posts-sources').hidden = !sources.length;
    $('#posts-sources').innerHTML = sources.length ? `<strong>Fuentes consultadas</strong><ul>${sources.map(source => `<li><a href="${h(source.url)}" target="_blank" rel="noopener noreferrer">${h(source.title || source.url)}</a></li>`).join('')}</ul>` : '';
    // Set fields before selecting, so the previous record cannot overwrite the draft.
    studio.index = index; fillInspector(); selectPiece(index); renderCopy(); syncButtons();
  }
  async function waitJob(id) {
    if (studio.polling) return studio.polling;
    studio.busy = true; error(); syncButtons();if($('#posts-progress').hidden||$('#posts-progress').dataset.state!=='running')progress.start({includeImages:false});
    studio.polling = (async () => {
      for (;;) {
        const { job } = await api(`/api/cms/posts/jobs/${encodeURIComponent(id)}`);
        progress.update(job);
        if (job.state === 'failed') throw new Error(job.error || 'No se pudo completar el trabajo.');
        if (job.state === 'complete') return job.result;
        await new Promise(resolve => setTimeout(resolve, 1800));
      }
    })();
    try {
      const record = await studio.polling;
      progress.finish(downloadsReady(record)?'Diseños y copy guardados y listos para descargar':'Tu contenido está guardado; revisa los ajustes indicados abajo');
      studio.busy = false; openRecord(record, true);
      studio.library = [record, ...studio.library.filter(item => item.id !== record.id)]; renderLibrary();
      $('#posts-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
      notify(downloadsReady(record)?'Diseños y copy guardados.':'Contenido guardado. Falta ajustar o revisar el diseño.'); return record;
    } catch (failure) {
      const message = failure.message === 'POST_JOB_INTERRUPTED' ? 'La generación se interrumpió. Puedes volver a intentarlo.' : failure.message?.startsWith('OPENAI_') ? 'OpenAI no pudo completar el trabajo. Revisa los créditos y el acceso a los modelos e inténtalo de nuevo.' : failure.detail || failure.message;
      error(message || 'No se pudo completar el trabajo.'); notify(message || 'No se pudo completar el trabajo.', 'error');
      progress.fail(message||'No se pudo completar el trabajo.');
    } finally { studio.busy = false; studio.polling = null; syncButtons(); }
  }
  async function load() {
    try {
      const response = await api('/api/cms/posts?includeDeleted=1'); studio.library = response.posts || []; studio.configured = Boolean(response.generator?.aiConfigured);
      $('#posts-config').textContent = studio.configured ? `Sol (${response.generator.textModel}) · Fotografías: ${response.generator.imageModel} · ${response.generator.textServiceTier==='fast'?'Fast solicitado · ':''}Identidad EJ activa` : 'Añade OPENAI_API_KEY en Secrets de Replit para activar el agente. Puedes probar las plantillas sin IA.';
      renderLibrary(); syncButtons();
      if (response.activeJob && !studio.polling) waitJob(response.activeJob.id);
    } catch (failure) { if (failure.code !== 'AUTH_REQUIRED') error('No se pudo cargar el estudio. Pulsa Actualizar para reintentar.'); }
  }
  async function generate(event) {
    event.preventDefault(); if (studio.busy) return;
    const topic = $('#posts-topic').value.trim(), source = $('#posts-source').value.trim();
    if (topic.length < 3 && source.length < 3 && !attachments.documents.length) return error('Escribe un tema, pega información o sube un documento.');
    const body = new FormData();
    const values = { topic, sourceText: source, mode: $('#posts-mode').value, count: $('#posts-count').value, size: $('#posts-size').value, palette:$('#posts-palette').value, background:$('#posts-background').value, direction: $('#posts-direction').value, language: $('#posts-language').value, includeImages: $('#posts-include-images').checked, webSearch: $('#posts-web-search').checked };
    Object.entries(values).forEach(([key, value]) => body.append(key, String(value)));
    for (const field of ['documents', 'supportImages']) attachments[field].forEach(file => body.append(field, file));
    studio.busy = true; syncButtons(); error();
    progress.start({includeImages:values.includeImages});$('#posts-progress').scrollIntoView({behavior:'smooth',block:'center'});
    try { const response = await api('/api/cms/posts/generate', { method: 'POST', body }); await waitJob(response.job.id); }
    catch (failure) {
      studio.busy = false; syncButtons();
      const messages = { CSRF_INVALID: 'La sesión se actualizó en otra pestaña. Tu texto se conserva; vuelve a pulsar Generar.', STUDIO_STORAGE_UNAVAILABLE: 'No se pudo conectar con el almacenamiento. Tu texto se conserva; vuelve a intentarlo.' };
      console.error('[social-start]', Number(failure.status) || 0);
      error(messages[failure.code] || failure.detail || 'No se pudo iniciar la generación. Inténtalo de nuevo.');
      progress.fail('No se pudo iniciar la generación. Tus insumos se conservan.');
    }
  }
  async function save(event) {
    event?.preventDefault(); if (studio.busy || !studio.draft) return;
    readInspector();stopPreview();closeCanvasEditor();studio.busy = true; syncButtons(); error();
    progress.start({includeImages:false,title:'Aplicando tus cambios de diseño',message:'Preparando la composición y las descargas…'});
    try {
      const response = await api(`/api/cms/posts/${studio.draft.id}`, { method: 'PATCH', body: { title: studio.draft.title, posts: studio.draft.posts, copies: studio.draft.copies, version: studio.saved.updatedAt } });
      await waitJob(response.job.id);
    } catch (failure) { studio.busy = false; syncButtons(); error(failure.detail || 'No se pudieron guardar los cambios.');progress.fail(); }
  }
  async function copyText(text, label) {
    try { await navigator.clipboard.writeText(text); notify(`${label} copiado.`); }
    catch { notify('No se pudo copiar. Selecciona el texto o descarga el archivo.', 'error'); }
  }
  $('#posts-form').addEventListener('submit', generate);
  $('#posts-edit-form').addEventListener('submit', save);
  $('#posts-save-copy').addEventListener('click', save);
  $('#posts-mode').addEventListener('change', syncButtons);
  $('#posts-palette').addEventListener('change',palettePreview);palettePreview();
  $('#posts-trash-toggle').addEventListener('click',()=>{studio.trash=!studio.trash;renderLibrary();});
  $('#posts-piece-strip').addEventListener('click',event=>{const link=event.target.closest('a[download]');if(link&&(studio.dirty||studio.busy||!downloadsReady()||!link.hasAttribute('href'))){event.preventDefault();notify('Guarda los ajustes y completa la revisión del diseño antes de descargar.','error');}});
  $('#posts-documents').addEventListener('change', event => addFiles(event, 'documents'));
  $('#posts-support-images').addEventListener('change', event => addFiles(event, 'supportImages'));
  $('#posts-refresh').addEventListener('click', load);
  $('#posts-revert').addEventListener('click', () => { if (studio.saved && !studio.busy) openRecord(studio.saved, true); });
  for (const field of $$('#posts-edit-form input, #posts-edit-form textarea, #posts-edit-form select')) field.addEventListener('input', () => { readInspector();markDirty();requestPreview(); });
  $('#posts-canvas-editor-close').addEventListener('click',closeCanvasEditor);
  $('#posts-canvas-editor-text').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeCanvasEditor();}});
  $('#posts-canvas-editor-text').addEventListener('input',event=>{
    if(!editingField||studio.busy||!studio.draft)return;
    const post=studio.draft.posts[studio.index],field=editingField,value=event.target.value;
    if(field==='bullets')post.bullets=value.split('\n').map(text=>text.trim()).filter(Boolean);
    else if(field.startsWith('bullet-')){post.bullets=post.bullets||[];post.bullets[Number(field.slice(7))]=value;}
    else post[field]=value;
    const control=field==='bullets'||field.startsWith('bullet-')?$('#posts-edit-bullets'):$(`#posts-edit-${field}`);
    if(control)control.value=field==='bullets'||field.startsWith('bullet-')?post.bullets.join('\n'):value;
    markDirty();requestPreview();
  });
  $('#posts-copy-text').addEventListener('input', () => { if (studio.draft) { studio.draft.copies[studio.network] = $('#posts-copy-text').value; markDirty(); captionCount(); } });
  $('#posts-copy-caption').addEventListener('click', () => copyText($('#posts-copy-text').value, 'Texto'));
  $('#posts-copy-html').addEventListener('click', async () => {
    const file=filesOf(studio.draft).html[studio.index];
    if (!studio.draft || studio.dirty||!downloadsReady()||!file) return notify('Guarda los ajustes y completa la revisión para copiar el HTML.', 'error');
    try { const response = await fetch(file, { credentials: 'include' }); if (!response.ok) throw new Error('HTML_UNAVAILABLE'); await copyText(await response.text(), 'HTML'); }
    catch { notify('No se pudo copiar el HTML. Puedes descargarlo desde el botón HTML editable.', 'error'); }
  });
  $('#posts-regenerate-copy').addEventListener('click', async () => {
    if (!studio.draft || studio.busy) return;
    if (studio.dirty) return notify('Aplica los cambios antes de actualizar el copy con IA.', 'error');
    studio.busy = true; syncButtons();
    progress.start({includeImages:false,title:'Actualizando el copy',message:'Sol está preparando los textos para cada red…'});
    try { const response = await api(`/api/cms/posts/${studio.draft.id}/copy`, { method: 'POST', body: {} }); await waitJob(response.job.id); }
    catch (failure) { studio.busy = false; syncButtons(); error(failure.detail || 'No se pudo actualizar el copy.');progress.fail(); }
  });
  $('#posts-redesign').addEventListener('click',async()=>{
    if(!studio.saved||studio.busy||studio.dirty)return;studio.busy=true;syncButtons();error();
    progress.start({includeImages:false,title:'Sol está mejorando tu diseño',message:'Revisando las piezas existentes y preparando otra dirección visual…'});$('#posts-progress').scrollIntoView({behavior:'smooth',block:'center'});
    try{const response=await api(`/api/cms/posts/${studio.saved.id}/redesign`,{method:'POST',body:{version:studio.saved.updatedAt,instructions:$('#posts-redesign-instructions').value,palette:$('#posts-redesign-palette').value}});await waitJob(response.job.id);}catch(failure){studio.busy=false;syncButtons();error(failure.detail||'No se pudo crear la versión mejorada.');progress.fail();}
  });
  $('#posts-retry-review').addEventListener('click',async()=>{
    if(!studio.saved||studio.busy||studio.dirty||!studio.configured)return;
    stopPreview();closeCanvasEditor();studio.busy=true;syncButtons();error();
    progress.start({includeImages:false,includeReview:true,title:'Revisando el diseño guardado',message:'Comprobando la composición y preparando la revisión visual…'});
    try{const response=await api(`/api/cms/posts/${encodeURIComponent(studio.saved.id)}/review`,{method:'POST',body:{version:studio.saved.updatedAt}});await waitJob(response.job.id);}
    catch(failure){studio.busy=false;syncButtons();error(failure.detail||'No se pudo completar la revisión. El diseño sigue guardado.');progress.fail('El diseño sigue guardado. Puedes volver a intentar la revisión.');}
  });
  for (const link of $$('#posts-result a[download]')) link.addEventListener('click', event => { if (studio.dirty || studio.busy||!downloadsReady()||!link.hasAttribute('href')) { event.preventDefault(); notify('Guarda los ajustes y completa la revisión del diseño antes de descargar.', 'error'); } });
  window.addEventListener('pagehide',stopPreview);
  window.addEventListener('resize',()=>{if(editingField){const active=currentScene?.nodes.find(node=>node.field===editingField);positionCanvasEditor(active?.box||active?.bounds);}});
  return { load };
}

import fs from 'node:fs';
import { load } from 'cheerio';
import { fileForRoute } from './inventory.mjs';
import { cmsModuleAllowed } from './cms-permissions.mjs';
import { canonicalPage } from './site-optimization.mjs';

const blocks = 'h1,h2,h3,h4,h5,h6,p,li,dt,dd,figcaption,address,blockquote,button,label,summary,caption,legend,th,td,option';
const hiddenCopy = '.sr-only,.visually-hidden,[hidden],script,style,svg';
const sectionNames = { header: 'Menú principal', footer: 'Pie de página', firma: 'La firma', areas: 'Áreas de práctica', red: 'La red', metodo: 'Cómo trabajamos', casos: 'Casos y experiencia', sede: 'Sede en Xalapa', analisis: 'Análisis', cierre: 'Contacto', contenido: 'Presentación de la página' };
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const current = (field, overrides) => Object.hasOwn(overrides, field.id) ? overrides[field.id] : field.original;

export function plainMarkup(value) {
  const $ = load(String(value ?? ''), null, false);
  const clones = $('.sr-only,.visually-hidden');
  // A standalone accessible label still has a value; paired visual copies do not duplicate it.
  if (clones.length && clean($.root().clone().find(hiddenCopy).remove().end().text())) clones.remove();
  $('script,style,svg,[hidden]').remove(); $('br').replaceWith('\n');
  return $.root().text().replace(/[\t \r\f]+/g, ' ').replace(/ *\n */g, '\n').trim().replace(/^([IVXLCDM]+)(?=[A-ZÁÉÍÓÚÑ][a-záéíóúñ])/,'$1 ');
}

function textNodes(node, direct = false, result = []) {
  for (const child of node.children || []) {
    if (child.type === 'text') result.push(child);
    else if (!direct && !['script', 'style', 'svg'].includes(child.name) && !/(?:^|\s)(?:sr-only|visually-hidden)(?:\s|$)/.test(child.attribs?.class || '') && !Object.hasOwn(child.attribs || {}, 'hidden')) textNodes(child, false, result);
  }
  return result;
}

// Change words inside the trusted template instead of accepting HTML from an editor.
// Keep unchanged prefixes/suffixes and distribute a replacement across the existing
// styled spans at word boundaries, retaining reveal wrappers and emphasis.
export function replaceTemplateText(markup, next, direct = false) {
  const $ = load(String(markup ?? ''), null, false), root = $.root()[0];
  $('br').replaceWith('\n');
  const nodes = textNodes(root, direct);
  if (!nodes.length) { $.root().text(next); return $.html(); }
  let previousEndsSpace = true;
  for (const node of nodes) {
    let value = node.data.replace(/[\t \r\f]+/g, ' ');
    if (previousEndsSpace) value = value.replace(/^ +/, '');
    node.data = value; if (value) previousEndsSpace = / $/.test(value);
  }
  nodes.at(-1).data = nodes.at(-1).data.trimEnd();
  const old = nodes.map(node => node.data).join(''), value = String(next ?? '');
  let start = 0, end = 0;
  while (start < old.length && start < value.length && old[start] === value[start]) start++;
  while (end < old.length - start && end < value.length - start && old[old.length - 1 - end] === value[value.length - 1 - end]) end++;
  const oldEnd = old.length - end, replacement = value.slice(start, value.length - end);
  let offset = 0; const affected = [];
  for (const node of nodes) {
    const left = offset, right = offset + node.data.length; offset = right;
    if (right > start && left < oldEnd || start === oldEnd && left <= start && right >= start && !affected.length) affected.push({ node, left, right, from: Math.max(0, start - left), to: Math.min(node.data.length, oldEnd - left) });
  }
  if (!affected.length) affected.push({ node: nodes.at(-1), from: nodes.at(-1).data.length, to: nodes.at(-1).data.length });
  const useful = affected.filter(item => item.node.data.slice(item.from, item.to).trim());
  const slots = useful.length ? useful : affected.slice(0, 1);
  const words = [...replacement.matchAll(/\S+\s*|\s+/g)].map(match => match[0]);
  const weights = slots.map(item => Math.max(1, item.to - item.from)), total = weights.reduce((a, b) => a + b, 0);
  const pieces = new Map(); let used = 0, weight = 0;
  slots.forEach((item, index) => { weight += weights[index]; const stop = index === slots.length - 1 ? words.length : Math.max(used, Math.min(words.length, Math.round(words.length * weight / total))); pieces.set(item.node, words.slice(used, stop).join('')); used = stop; });
  for (const item of affected) item.node.data = item.node.data.slice(0, item.from) + (pieces.get(item.node) || '') + item.node.data.slice(item.to);
  for (const node of nodes) if (node.data.includes('\n')) $(node).replaceWith(node.data.split('\n').map(line => $('<span>').text(line).html()).join('<br>'));
  $('.sr-only,.visually-hidden').each((_, element) => $(element).text(value));
  return $.html();
}

export function pendingFieldIds(store) {
  const draft = store.draftOverrides || {}, published = store.publishedOverrides || {};
  return [...new Set([...Object.keys(draft), ...Object.keys(published)])].filter(id => draft[id] !== published[id]);
}

function friendlyPage(page) {
  if (page.page === '/') return 'Inicio';
  return String(page.title || page.page).split('|')[0].trim().replace(/\s*[—–]\s*Expresión Jurídica.*$/i, '');
}

export function editablePages(inventory) {
  return inventory.pages.filter(page=>canonicalPage(page.page)===page.page).map(page=>{
    const $=load(fs.readFileSync(fileForRoute(page.page),'utf8'));
    const title=plainMarkup($('h1').first().html()||'').replace(/\.$/,'');
    return {...page,editorTitle:page.page==='/'?'Inicio':title||friendlyPage(page)};
  });
}

function snapshot(html,fields,overrides) {
  const $=load(html);
  for(const field of fields) if(Object.hasOwn(overrides,field.id)) {
    const target=$(field.selector).first(),value=overrides[field.id];if(!target.length)continue;
    if(field.attribute==='html')target.html(String(value));
    else if(field.attribute==='text') {
      if(target.contents().toArray().some(node=>node.type==='text'&&node.data.trim()))target.html(replaceTemplateText(target.html(),String(value),true));
      else target.text(String(value));
    } else target.attr(field.attribute,String(value));
  }
  return $;
}

function snapshotValue($,field) {
  const target=$(field.selector).first();
  if(field.attribute==='html')return target.html()??field.original;
  if(field.attribute==='text')return clean(target.contents().toArray().filter(node=>node.type==='text').map(node=>node.data).join(' '));
  return target.attr(field.attribute)??'';
}

export function contentCatalog(inventory, store, page) {
  const file = fileForRoute(page); if (!file) return null;
  const source=fs.readFileSync(file,'utf8'), $ = load(source), fields = inventory.fields.filter(field => field.page === page);
  const working=snapshot(source,fields,store.draftOverrides),published=snapshot(source,fields,store.publishedOverrides);
  const sections = new Map(), pending = new Set(pendingFieldIds(store));
  const nodes = new Map(), resolved = new Map();
  for (const field of fields) { const node = $(field.selector)[0]; resolved.set(field.id,node); if (node) { if (!nodes.has(node)) nodes.set(node,[]); nodes.get(node).push(field); } }
  const covered = node => (nodes.get(node) || []).some(field => field.attribute === 'html') && !$(node).find(blocks).length;
  let anonymousSection = 0;
  $('header,section,footer,main').each((_, node) => { const el = $(node); if (!el.attr('id')) el.attr('data-editor-section', `section-${anonymousSection++}`); });
  const available = fields.filter(field => {
    const el = $(resolved.get(field.id));
    if (!el.length || el.closest('script,style,svg,[hidden]').length) return false;
    if (['srcset', 'value', 'data'].includes(field.attribute) || field.kind === 'embed') return false;
    if (['html', 'text'].includes(field.attribute) && !el.closest('head').length) {
      if (el.closest('.sr-only,.visually-hidden').length) return false;
      if (field.attribute === 'html' && el.find(blocks).length) return false;
      if (el.parents(blocks).toArray().some(covered)) return false;
      if (el.is('span,div,em,strong,b,i,small,time,code,cite,mark') && el.parents().toArray().some(covered)) return false;
    }
    return true;
  });
  const result = available.map(field => {
    const el = $(resolved.get(field.id)), isSeo = Boolean(el.closest('head').length);
    const region = !el.closest('main,article,section').length ? el.closest('header,footer')[0]?.name : null;
    const logicalSection = el.parents('[id]').filter((_,node)=>Boolean(sectionNames[$(node).attr('id')])&&$(node).attr('id')!=='contenido').first();
    const outerSection = el.parents('section').last();
    const container = isSeo ? null : region ? el.closest(region) : logicalSection.length ? logicalSection : outerSection.length ? outerSection : el.closest('section,main').first();
    const id = isSeo ? 'seo' : container?.attr('id') || container?.attr('data-editor-section') || 'general';
    const headingId=container?.find('h1[id],h2[id],h3[id]').first().attr('id')||'';
    const title = isSeo ? 'Buscadores y redes sociales' : sectionNames[region || id] || sectionNames[headingId.replace(/-titulo$/,'')] || (container?.find('h1').length?'Presentación principal':plainMarkup(container?.attr('aria-label') || container?.find('h2,h3').first().html() || 'Contenido de la página').slice(0, 100));
    if (!sections.has(id)) sections.set(id, { id, title, shared: Boolean(region), anchor: isSeo ? '' : container?.attr('id') || headingId, fields: [] });
    const raw = snapshotValue(working,field), live=snapshotValue(published,field), original = field.attribute === 'html' ? plainMarkup(field.original) : field.original;
    const value = field.attribute === 'html' ? plainMarkup(raw) : String(raw ?? '');
    const savedValue=field.attribute==='html'?plainMarkup(live):String(live??'');
    const tag = el[0].name, content = ['html','text'].includes(field.attribute);
    const category = isSeo ? 'search' : ['image','video','audio'].includes(field.kind) ? 'media' : ['accessibility','alt','form'].includes(field.kind) || /^(?:[IVXLCDM]+|\d+)(?:\s*[/.·]\s*(?:[IVXLCDM]+|\d+))*$/.test(value) ? 'options' : 'text';
    const label = isSeo ? tag === 'title' ? 'Título en buscadores' : ({ description:'Descripción en buscadores','og:title':'Título al compartir','og:description':'Descripción al compartir','og:image':'Imagen al compartir','twitter:card':'Formato en X','twitter:title':'Título en X','twitter:description':'Descripción en X','twitter:image':'Imagen en X' }[el.attr('name') || el.attr('property')] || 'Información al compartir') : field.attribute === 'href' ? `Destino del enlace: ${plainMarkup(el.html()).slice(0,70)}` : field.attribute === 'alt' ? 'Descripción de la imagen' : field.attribute === 'placeholder' ? 'Ayuda del formulario' : field.attribute === 'aria-label' ? 'Nombre para lectores de pantalla' : category === 'media' ? field.attribute === 'poster' ? 'Portada del video' : field.kind === 'video' ? 'Video' : field.kind === 'audio' ? 'Audio' : 'Imagen' : tag === 'h1' ? 'Título principal' : /^h[2-6]$/.test(tag) ? 'Título del bloque' : tag === 'a' || tag === 'button' ? 'Texto del botón o enlace' : tag === 'p' ? 'Párrafo' : 'Texto';
    const context = plainMarkup(el.closest('article,li').find('h2,h3,h4').first().html() || '');
    const item = { id: field.id, aliases: [], section: id, label, context, value, savedValue, originalValue: original, category, kind: field.kind, priority:tag==='h1'?0:1, multiline: content && (!/^h[1-6]$/.test(tag) || value.length > 100), pending: pending.has(field.id)||value!==savedValue, shared: Boolean(region), preview: category === 'media' ? value : null };
    sections.get(id).fields.push(item.id); return item;
  });
  const order = new Map(); $('header,section,footer,main,[id]').each((i,node)=>order.set($(node).attr('id')||$(node).attr('data-editor-section'),i));
  const unique = new Map();
  for (const item of result) {
    const key = JSON.stringify([item.section,item.category,item.label,item.context,item.originalValue]);
    const previous = unique.get(key);
    if (previous) { previous.aliases.push(item.id); previous.pending ||= item.pending; if (item.pending && !pending.has(previous.id)) previous.value=item.value; }
    else unique.set(key,item);
  }
  const visible = [...unique.values()].sort((a,b)=>a.priority-b.priority);
  for (const section of sections.values()) section.fields=visible.filter(item=>item.section===section.id).map(item=>item.id);
  return { page: { route: page, title: page==='/'?'Inicio':plainMarkup($('h1').first().html()||'').replace(/\.$/,'')||friendlyPage(inventory.pages.find(item => item.page === page) || {page}), previewUrl: page }, sections: [...sections.values()].sort((a,b)=>(order.get(a.id)??999)-(order.get(b.id)??999)), fields: visible, pending: pendingFieldIds(store).length };
}

export function pendingContentChanges(inventory,store) {
  const pending=new Set(pendingFieldIds(store)),represented=new Set(),result=[];
  const pages=new Set(inventory.fields.filter(field=>pending.has(field.id)).map(field=>field.page));
  for(const page of pages) {
    const catalog=contentCatalog(inventory,store,page);
    for(const item of catalog.fields.filter(item=>item.pending)) {
      result.push({...item,pageTitle:catalog.page.title,pageRoute:page});
      for(const id of [item.id,...item.aliases]) {
        represented.add(id);const field=inventory.fields.find(field=>field.id===id);
        if(field?.attribute==='html')for(const child of inventory.fields.filter(child=>child.page===page&&['html','text'].includes(child.attribute)&&child.selector.startsWith(field.selector+' > ')))represented.add(child.id);
      }
    }
  }
  for(const id of pending)if(!represented.has(id)) {
    const field=inventory.fields.find(field=>field.id===id);if(!field)continue;
    const value=current(field,store.draftOverrides),saved=current(field,store.publishedOverrides);
    result.push({id,aliases:[],label:['html','text'].includes(field.attribute)?'Texto de la página':'Información de la página',value:field.attribute==='html'?plainMarkup(value):String(value),savedValue:field.attribute==='html'?plainMarkup(saved):String(saved),pageTitle:friendlyPage(inventory.pages.find(page=>page.page===field.page)),pageRoute:field.page,legacy:true,shared:false,pending:true});
  }
  return result;
}

export function registerContentEditorRoutes(app, { getInventory, store, writeStore, requireAuth, requireEditor, requireCsrf, audit }) {
  app.get('/api/cms/content', requireAuth, (req,res) => {
    const catalog = contentCatalog(getInventory(), store, String(req.query.page || '/'));
    if (!catalog) return res.status(404).json({error:'PAGE_NOT_FOUND'});
    res.json({...catalog,canEdit:['owner','editor'].includes(req.cmsAdmin?.role||req.cmsUser?.role)&&cmsModuleAllowed(req,store,'content'),pendingChanges:pendingContentChanges(getInventory(),store)});
  });
  let saveQueue=Promise.resolve();
  app.post('/api/cms/content', requireAuth, requireEditor, requireCsrf, (req,res,next) => {
    const run=async()=>{
    if(!cmsModuleAllowed(req,store,'content'))return res.status(403).json({error:'ROLE_REQUIRED'});
    const items = req.body?.changes;
    if (req.body?.confirmed !== true || !Array.isArray(items) || !items.length || items.length > 500) return res.status(400).json({error:'INVALID_REQUEST'});
    const inventory = getInventory(), updates = new Map(), catalogs = new Map(),remove=new Set(),pending=new Set(pendingFieldIds(store));
    for (const item of items) {
      const field = inventory.fields.find(candidate => candidate.id === item.id);
      if (!field || typeof item.value !== 'string' || item.value.length > 100000) return res.status(400).json({error:'INVALID_REQUEST'});
      if (!catalogs.has(field.page)) catalogs.set(field.page,contentCatalog(inventory,store,field.page));
      const editable = catalogs.get(field.page)?.fields.find(candidate=>candidate.id===field.id) || (pending.has(field.id)?{aliases:[],shared:false}:null);
      if (!editable) return res.status(400).json({error:'INVALID_REQUEST'});
      if (['href','src','poster'].includes(field.attribute)) { try { if (!['http:','https:','mailto:','tel:'].includes(new URL(item.value,'https://expresion-juridica-21-st.replit.app').protocol)) return res.status(400).json({error:'INVALID_REQUEST'}); } catch { return res.status(400).json({error:'INVALID_REQUEST'}); } }
      let targets = [field,...editable.aliases.map(id=>inventory.fields.find(candidate=>candidate.id===id))];
      if (editable.shared) targets = inventory.fields.filter(candidate => candidate.attribute === field.attribute && candidate.kind === field.kind && candidate.original === field.original && (()=>{const f=fileForRoute(candidate.page);if(!f)return false;const $=load(fs.readFileSync(f,'utf8'));return !$(candidate.selector).closest('main,article,section').length&&$(candidate.selector).closest('header,footer').length;})());
      for (const target of targets) {
        const pageFields=inventory.fields.filter(candidate=>candidate.page===target.page), file=fileForRoute(target.page);
        const raw = snapshotValue(snapshot(fs.readFileSync(file,'utf8'),pageFields,store.draftOverrides),target);
        const value = target.attribute === 'html' ? item.value === plainMarkup(target.original) ? target.original : replaceTemplateText(raw,item.value) : item.value;
        updates.set(target.id, {field:target,value});
        if(target.attribute==='html')for(const child of pageFields.filter(child=>['html','text'].includes(child.attribute)&&child.selector.startsWith(target.selector+' > ')))remove.add(child.id);
        // A manually selected image must take precedence over old responsive variants.
        if (target.attribute === 'src' && target.kind === 'image' && value !== raw) for (const variant of inventory.fields.filter(candidate => candidate.page === target.page && candidate.selector === target.selector && candidate.attribute === 'srcset')) updates.set(variant.id,{field:variant,value:''});
      }
    }
    const previousDraft=store.draftOverrides,previousPublished=store.publishedOverrides,previousAudit=new Set(store.audit||[]);let addedAudit=[];
    store.draftOverrides={...previousDraft};store.publishedOverrides={...previousPublished};
    for(const id of remove)if(!updates.has(id)){delete store.draftOverrides[id];delete store.publishedOverrides[id];}
    for (const {field,value} of updates.values()) for(const target of [store.draftOverrides,store.publishedOverrides]) { if (value === field.original) delete target[field.id]; else target[field.id] = value; }
    try { audit('content.save',req.cmsUser,{fieldCount:updates.size});addedAudit=(store.audit||[]).filter(item=>!previousAudit.has(item));await writeStore(); }
    catch(error){
      for(const [map,previous] of [[store.draftOverrides,previousDraft],[store.publishedOverrides,previousPublished]]) {
        for(const {field,value} of updates.values())if(map[field.id]===(value===field.original?undefined:value)){if(Object.hasOwn(previous,field.id))map[field.id]=previous[field.id];else delete map[field.id];}
        for(const id of remove)if(!updates.has(id)&&!Object.hasOwn(map,id)&&Object.hasOwn(previous,id))map[id]=previous[id];
      }
      if(store.audit)store.audit=store.audit.filter(item=>!addedAudit.includes(item));
      try{await writeStore({localOnly:true});}catch{}throw error;
    }
    res.json({ok:true,saved:items.length,published:true,pending:pendingFieldIds(store).length,pendingIds:pendingFieldIds(store)});
    };
    const work=saveQueue.then(run);saveQueue=work.catch(()=>{});work.catch(next);
  });
}

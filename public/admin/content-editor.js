const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const pageTitle = page => page.page === '/' ? 'Inicio' : String(page.editorTitle || page.title || page.page).split('|')[0].trim().replace(/\s*[—–]\s*Expresión Jurídica.*$/i,'');

export function createContentEditor({ api, canEdit, onSaved, chooseMedia }) {
  const dirty = new Map(), catalogs = new Map(), selections = new Map(), pendingKnown=new Map();
  let active = null, request = 0, saving = false;
  const editable=()=>canEdit()&&active?.catalog.canEdit!==false;
  const tabs = [['text','Textos y enlaces'],['media','Imágenes y video'],['search','Buscadores'],['options','Accesibilidad y formularios']];
  const knownField = id => [...catalogs.values()].flatMap(catalog => catalog.fields).find(field => field.id === id)||pendingKnown.get(id);
  const valueFor = field => dirty.get(field.id)?.value ?? field.value;
  const status = field => dirty.has(field.id) ? 'Cambio por confirmar' : 'Guardado';
  const review=document.createElement('dialog');review.className='content-review-dialog';review.setAttribute('aria-labelledby','content-review-title');document.body.appendChild(review);
  review.addEventListener('cancel',event=>{if(saving)event.preventDefault();});

  function updateState(message = '', error = false) {
    if (!active) return;
    const root = active.root;
    root.querySelectorAll('[data-content-save]').forEach(button => { button.disabled = saving || !dirty.size || !editable(); button.textContent = saving ? 'Guardando…' : 'Guardar cambios'; });
    const state = root.querySelector('[data-content-state]');
    if (state) { state.textContent = message || (dirty.size ? `${dirty.size} ${dirty.size === 1 ? 'cambio sin guardar' : 'cambios sin guardar'}` : 'Todos los cambios están guardados'); state.classList.toggle('is-error', error); }
    root.querySelectorAll('[data-content-card]').forEach(card => { const field = knownField(card.dataset.contentCard); if (!field) return; card.classList.toggle('is-edited',dirty.has(field.id)); card.querySelector('[data-field-state]').textContent = status(field); });
    document.querySelectorAll('[data-content-unsaved]').forEach(item => { item.textContent = dirty.size; item.hidden = !dirty.size; });
  }

  function remember(field, value) {
    if (value === field.savedValue&&!field.pending) dirty.delete(field.id);
    else dirty.set(field.id,{id:field.id,value,shared:field.shared});
    updateState();
  }

  function fieldCard(field) {
    const value = valueFor(field), id = `${active.surface}-content-${field.id}`, readOnly = !editable() ? ' readonly' : '';
    const input = field.multiline ? `<textarea id="${id}" data-content-input="${field.id}" rows="${Math.min(9,Math.max(3,Math.ceil(value.length/95)))}" maxlength="100000"${readOnly}>${escapeHtml(value)}</textarea>` : `<input id="${id}" data-content-input="${field.id}" value="${escapeHtml(value)}" maxlength="100000"${readOnly}/>`;
    const section = active.catalog.sections.find(item => item.id === field.section);
    const preview = field.category === 'media' ? field.kind === 'image' ? `<img src="${escapeHtml(value)}" alt="Vista de la imagen actual" loading="lazy"/>` : `<span>${field.kind === 'video' ? 'Video de esta sección' : 'Audio de esta sección'}</span>` : '';
    return `<article class="content-copy-field ${dirty.has(field.id)?'is-edited':''}" data-content-card="${field.id}"><div class="content-copy-label"><label for="${id}">${field.context?`${escapeHtml(field.context)} · `:''}${escapeHtml(field.label)}</label><span data-field-state>${status(field)}</span></div>${active.search ? `<small class="content-result-section">${escapeHtml(section?.title || '')}</small>` : ''}${preview?`<div class="content-media-preview">${preview}</div>`:''}${input}<div class="content-copy-actions">${field.category==='media'&&editable()?`<button type="button" class="text-action" data-content-media="${field.id}">Elegir de la biblioteca</button>`:''}${editable()?`<button type="button" class="text-action" data-content-reset="${field.id}">${field.category==='media'?'Restaurar archivo inicial':'Restaurar texto inicial'}</button>`:''}</div></article>`;
  }

  function renderFields() {
    if (!active) return;
    const { root, catalog, category, section, search } = active;
    const selected = catalog.sections.find(item => item.id === section);
    const words = search.toLocaleLowerCase('es');
    const fields = catalog.fields.filter(field => field.category === category && (search ? `${field.label} ${valueFor(field)} ${catalog.sections.find(item=>item.id===field.section)?.title}`.toLocaleLowerCase('es').includes(words) : field.section === section));
    root.querySelector('[data-content-section-title]').textContent = search ? 'Resultados de búsqueda' : selected?.title || 'Contenido';
    root.querySelector('[data-content-section-note]').textContent = search ? `${fields.length} resultados en esta página` : selected?.shared ? 'Este contenido se comparte en todas las páginas del sitio.' : 'Edita el contenido. Al guardar podrás revisar el antes y el después.';
    const preview = root.querySelector('[data-content-preview]');
    preview.href = catalog.page.previewUrl + (selected?.anchor ? `#${selected.anchor}` : '');
    root.querySelector('[data-content-fields]').innerHTML = fields.map(fieldCard).join('') || '<div class="content-empty"><strong>No hay elementos aquí</strong><p>Prueba otra sección o cambia la búsqueda.</p></div>';
    root.querySelectorAll('[data-content-input]').forEach(input => input.addEventListener('input',()=>remember(knownField(input.dataset.contentInput),input.value)));
    root.querySelectorAll('[data-content-reset]').forEach(button => button.addEventListener('click',()=>{const field=knownField(button.dataset.contentReset);remember(field,field.originalValue);renderFields();}));
    root.querySelectorAll('[data-content-media]').forEach(button => button.addEventListener('click',()=>chooseMedia(button.dataset.contentMedia,active.surface)));
    root.querySelectorAll('[data-content-section]').forEach(button => button.setAttribute('aria-current',String(button.dataset.contentSection === section&&!search)));
    const selector=root.querySelector('[data-content-section-select]');if(selector)selector.value=section||'';
    updateState();
  }

  function selectCategory(category) {
    active.category = category;
    const sections = active.catalog.sections.filter(section=>active.catalog.fields.some(field=>field.section===section.id&&field.category===category));
    if (!sections.some(section=>section.id===active.section)) active.section = sections[0]?.id;
    active.root.querySelector('[data-content-sections]').innerHTML = `<label class="content-mobile-section">Sección<select data-content-section-select>${sections.map(section=>`<option value="${escapeHtml(section.id)}"${section.id===active.section?' selected':''}>${escapeHtml(section.title)}</option>`).join('')}</select></label>`+sections.map((section,index)=>`<button type="button" data-content-section="${escapeHtml(section.id)}" aria-current="${section.id===active.section}"><small>${String(index+1).padStart(2,'0')}</small><span>${escapeHtml(section.title)}</span>${section.shared?'<em>Común</em>':''}</button>`).join('');
    active.root.querySelector('[data-content-section-select]').addEventListener('change',event=>{active.section=event.target.value;active.search='';active.root.querySelector('[data-content-search]').value='';selections.set(active.catalog.page.route,active.section);renderFields();});
    active.root.querySelectorAll('[data-content-section]').forEach(button=>button.addEventListener('click',()=>{active.section=button.dataset.contentSection;active.search='';active.root.querySelector('[data-content-search]').value='';selections.set(active.catalog.page.route,active.section);renderFields();}));
    active.root.querySelectorAll('[data-content-category]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.contentCategory===category)));
    renderFields();
  }

  async function mount(page, root, surface) {
    const token = ++request;
    root.innerHTML = '<div class="content-loading" role="status">Cargando las secciones de la página…</div>';
    try {
      const catalog = await api(`/api/cms/content?page=${encodeURIComponent(page)}`);
      if (token !== request) return;
      catalogs.set(page,catalog);

      active={catalog,root,surface,category:'text',section:selections.get(page)||catalog.sections.find(section=>!section.shared&&catalog.fields.some(field=>field.section===section.id&&field.category==='text'))?.id,search:''};
      for(const field of editable()?catalog.pendingChanges||[]:[]) {pendingKnown.set(field.id,field);if(!dirty.has(field.id))dirty.set(field.id,{id:field.id,value:field.value,shared:field.shared});}
      root.innerHTML = `<div class="content-editor" aria-label="Editar ${escapeHtml(catalog.page.title)}"><div class="content-editor-top"><div><span class="content-location">Estás editando</span><${surface==='home'?'h1':'h2'}>${escapeHtml(catalog.page.title)}</${surface==='home'?'h1':'h2'}></div><a class="button button-secondary" href="${catalog.page.previewUrl}" target="_blank" rel="noopener">Ver página ↗</a></div><div class="content-category-tabs" aria-label="Tipo de contenido">${tabs.filter(([category])=>catalog.fields.some(field=>field.category===category)).map(([category,label])=>`<button type="button" data-content-category="${category}" aria-pressed="false">${label}</button>`).join('')}</div><div class="content-editor-search"><label for="${surface}-content-search">Buscar un texto en esta página</label><input id="${surface}-content-search" data-content-search type="search" placeholder="Escribe una palabra del texto que quieres cambiar…" /></div><div class="content-editor-layout"><nav class="content-section-nav" data-content-sections aria-label="Secciones de la página"></nav><section class="content-section-form"><header class="content-section-heading"><div><h3 data-content-section-title></h3><p data-content-section-note></p></div><a data-content-preview class="text-action" target="_blank" rel="noopener">Ver esta sección ↗</a></header><div data-content-fields></div></section></div><div class="content-savebar"><div><strong data-content-state role="status" aria-live="polite"></strong><span>Al aceptar, los cambios quedarán visibles en el sitio.</span></div>${editable()?'<button type="button" data-content-save class="button button-primary">Guardar cambios</button>':'<span>Acceso de lectura</span>'}</div></div>`;
      root.querySelectorAll('[data-content-category]').forEach(button=>button.addEventListener('click',()=>selectCategory(button.dataset.contentCategory)));
      root.querySelector('[data-content-search]').addEventListener('input',event=>{active.search=event.target.value.trim();renderFields();});
      root.querySelector('[data-content-save]')?.addEventListener('click',save);
      selectCategory('text');
    } catch { if (token === request) root.innerHTML='<div class="content-empty" role="alert"><strong>No se pudo cargar el contenido</strong><p>Vuelve a abrir la página para intentarlo de nuevo.</p></div>'; }
  }

  function save() {
    if (saving || !dirty.size || !editable()) return;
    const changes=[...dirty.values()].map(item=>({...item}));
    review.innerHTML=`<header><p>Confirmar cambios</p><h2 id="content-review-title">Revisa lo que modificaste</h2><span>Al aceptar, los cambios se guardarán y se verán en el sitio.</span></header><div class="content-review-list">${changes.map(change=>{const field=knownField(change.id);const page=field.pageTitle||[...catalogs.values()].find(c=>c.fields.some(f=>f.id===change.id))?.page.title||'';return `<article><h3>${escapeHtml(page)} · ${escapeHtml(field.context||field.label)}</h3>${field.shared?'<p class="content-review-scope">Se aplica en todas las páginas.</p>':''}<div class="content-review-comparison"><section><span>Antes</span><div class="content-review-text">${escapeHtml(field.savedValue||'(Vacío)')}</div></section><section><span>Después</span><div class="content-review-text">${escapeHtml(change.value||'(Vacío)')}</div></section></div></article>`;}).join('')}</div><p data-review-error class="content-review-error" role="alert" hidden></p><footer><button type="button" data-review-back class="button button-secondary">Volver a editar</button><button type="button" data-review-confirm class="button button-primary">Aceptar y guardar</button></footer>`;
    review.querySelector('[data-review-back]').addEventListener('click',()=>review.close());
    review.querySelector('[data-review-confirm]').addEventListener('click',()=>persist(changes));
    review.showModal();
  }

  async function persist(changes) {
    if(saving)return;saving=true;updateState();
    review.querySelectorAll('button').forEach(button=>button.disabled=true);
    review.querySelector('[data-review-confirm]').textContent='Guardando…';
    review.querySelector('[data-review-error]').hidden=true;
    try {
      const result=await api('/api/cms/content',{method:'POST',body:{changes,confirmed:true}}),pending=new Set(result.pendingIds);
      for(const change of changes) {
        for(const catalog of catalogs.values())for(const field of catalog.fields)if(field.id===change.id){field.value=change.value;field.savedValue=change.value;}
        if(dirty.get(change.id)?.value===change.value)dirty.delete(change.id);
        pendingKnown.delete(change.id);
      }
      for(const catalog of catalogs.values())for(const field of catalog.fields)field.pending=pending.has(field.id);
      saving=false;review.close();updateState(dirty.size?'Cambios guardados. Quedan nuevas ediciones por confirmar.':'Cambios guardados y visibles en el sitio.');
      await onSaved(result);
    } catch(error) {
      saving=false;review.querySelectorAll('button').forEach(button=>button.disabled=false);review.querySelector('[data-review-confirm]').textContent='Aceptar y guardar';
      const message=review.querySelector('[data-review-error]');message.hidden=false;message.textContent=error.detail||'No se pudo guardar. Tus ediciones siguen aquí. Vuelve a intentarlo.';updateState();
    }
  }

  function assignMedia(id,url) {const field=knownField(id);if(field)remember(field,url);}
  window.addEventListener('beforeunload',event=>{if([...dirty.values()].some(change=>change.value!==knownField(change.id)?.value)){event.preventDefault();event.returnValue='';}});
  return { mount, save, assignMedia, has:id=>Boolean(knownField(id)), hasUnsaved:()=>dirty.size>0, refresh:()=>active&&mount(active.catalog.page.route,active.root,active.surface), invalidate:()=>catalogs.clear() };
}

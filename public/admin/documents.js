import { createGenerationProgress } from './generation-progress.js?v=20261103-studio4';
import { confirmLibraryRemoval } from './library-actions.js?v=20261103-studio4';
export function createDocumentStudio({ api, state, notify, escapeHtml: h, formatDate }) {
  const $ = selector => document.querySelector(selector);
  if (!$('#documents-form')) return { load: async () => {} };
  const studio = { library: [], saved: null, editor: null, busy: false, dirty: false, configured: false, loading: null, job: null, trash:false, files: [] };
  const MAX_DOCUMENT_FILES = 20, MAX_DOCUMENT_FILE_BYTES = 100 * 1024 * 1024, MAX_DOCUMENT_TOTAL_BYTES = 200 * 1024 * 1024;
  const progress=createGenerationProgress($('#documents-progress'),'document');
  const canEdit = () => ['owner', 'editor'].includes(state.user?.role);
  function error(message = '') { $('#documents-error').textContent = message; $('#documents-error').hidden = !message; }
  function sync() {
    for (const control of document.querySelectorAll('#documents-form input, #documents-form select, #documents-form textarea, #documents-form button, #documents-toolbar button')) control.disabled = studio.busy || !canEdit();
    $('#documents-save').disabled = studio.busy || !canEdit() || !studio.dirty;
    $('#documents-revert').disabled = studio.busy || !studio.dirty;
    studio.editor?.setEditable(canEdit() && !studio.busy, false);
    $('#documents-edit-state').textContent = studio.busy ? 'Preparando archivos…' : studio.dirty ? 'Cambios sin guardar' : 'Guardado';
    $('#documents-prepare').textContent = studio.busy ? 'Preparando documento…' : $('#documents-mode').value === 'organize' ? 'Organizar con Sol y crear documento' : 'Crear documento con mis fuentes';
    $('#documents-ai-direction').hidden = $('#documents-mode').value !== 'organize';
    for (const link of document.querySelectorAll('#documents-downloads a')) { link.setAttribute('aria-disabled', String(studio.dirty || studio.busy)); link.classList.toggle('document-download-pending', studio.dirty || studio.busy); }
    $('#documents-preview-note').hidden = !studio.dirty;
    $('#documents-editor-title').readOnly = studio.busy || !canEdit();
  }
  function dirty() { studio.dirty = true; sync(); }
  const messages = { CSRF_INVALID: 'La sesión se actualizó en otra pestaña. Tu texto permanece en el editor.', STUDIO_JOB_INTERRUPTED: 'La generación se interrumpió. Puedes volver a intentarlo.', OPENAI_API_KEY_MISSING: 'Falta OPENAI_API_KEY en los Secrets de Replit.', OPENAI_OUTPUT_INCOMPLETE: 'Sol no terminó el documento. Intenta dividir el texto o reducir las instrucciones.', DOCUMENT_VERSION_CHANGED: 'El documento cambió en otra edición. Actualiza el historial y abre la versión reciente.', STUDIO_STORAGE_UNAVAILABLE: 'No se pudo acceder al almacenamiento. Tu texto sigue en el editor; vuelve a intentar guardar.', DOCUMENT_FILE_TYPE_INVALID: 'Solo puedes subir archivos DOCX o PDF.', DOCUMENT_FILE_EMPTY: 'No se pudo extraer texto de uno de los archivos. Usa un DOCX o PDF con texto seleccionable.', DOCUMENT_FILES_TOO_LARGE: 'Los archivos superan 200 MB en total. Reduce la selección.', DOCUMENT_INPUT_INVALID: 'Pega texto o sube al menos un DOCX o PDF. El contenido admite hasta 200 000 caracteres.' };
  const explain = failure => messages[failure.code] || messages[failure.detail] || messages[failure.message] || failure.detail || 'No se pudo preparar el documento. Vuelve a intentarlo.';
  const formatBytes = bytes => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  function renderFiles() {
    const list = $('#documents-file-list');
    list.innerHTML = studio.files.map((file, index) => `<li><span>${h(file.name)}</span><small>${formatBytes(file.size)}</small><button class="text-action" type="button" data-remove-document-file="${index}">Quitar</button></li>`).join('');
    list.querySelectorAll('[data-remove-document-file]').forEach(button => button.addEventListener('click', () => { studio.files.splice(Number(button.dataset.removeDocumentFile), 1); renderFiles(); sync(); }));
  }
  function addFiles(fileList) {
    const currentKeys = new Set(studio.files.map(file => `${file.name}:${file.size}:${file.lastModified}`));
    for (const file of fileList) {
      const extension = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
      if (!['.docx', '.pdf'].includes(extension)) { notify(`${file.name}: solo se admiten DOCX o PDF.`, 'error'); continue; }
      if (file.size > MAX_DOCUMENT_FILE_BYTES) { notify(`${file.name}: supera el máximo de 100 MB.`, 'error'); continue; }
      if (studio.files.length >= MAX_DOCUMENT_FILES) { notify('Puedes seleccionar hasta 20 documentos.', 'error'); break; }
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (currentKeys.has(key)) continue;
      const total = studio.files.reduce((sum, item) => sum + item.size, 0) + file.size;
      if (total > MAX_DOCUMENT_TOTAL_BYTES) { notify('La selección supera 200 MB en total.', 'error'); break; }
      studio.files.push(file); currentKeys.add(key);
    }
    $('#documents-files').value = '';
    renderFiles(); sync();
  }
  function clearFiles() { studio.files = []; $('#documents-files').value = ''; renderFiles(); }
  async function open(item) {
    if (studio.busy) return;
    if (studio.dirty && studio.saved?.id !== item.id) { notify('Guarda o restablece la edición antes de abrir otro documento.'); return; }
    if (!studio.editor) {
      const { Editor, StarterKit } = await import('./vendor/tiptap.js?v=20261102');
      studio.editor = new Editor({ element: $('#documents-editor'), extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] }, code: false, codeBlock: false, link: { openOnClick: false, autolink: false } })], content: item.document, editorProps: { attributes: { 'aria-label': 'Texto del documento', role: 'textbox', 'aria-multiline': 'true' } }, onUpdate: () => dirty(), onSelectionUpdate: () => toolbarState() });
    } else studio.editor.commands.setContent(item.document, { emitUpdate: false });
    studio.saved = item; studio.dirty = false;
    $('#documents-result').hidden = false; $('#documents-editor-title').value = item.title;
    $('#documents-download-docx').href = item.files.docx; $('#documents-download-pdf').href = item.files.pdf;
    $('#documents-preview').src = `${item.files.pdf}?preview=1&v=${encodeURIComponent(item.updatedAt)}#toolbar=1`;
    $('#documents-paper-size').value = item.paperSize === 'oficio' ? 'oficio' : 'carta';
    $('#documents-result-meta').textContent = `${item.pageCount} ${item.pageCount === 1 ? 'página' : 'páginas'} en PDF · Tamaño ${item.paperSize === 'oficio' ? 'Oficio' : 'Carta'} · ${item.aiUsed ? item.model : 'Texto conservado sin IA'} · Word editable`;
    toolbarState(); sync(); error();
  }
  function toolbarState() {
    if (!studio.editor) return;
    for (const button of document.querySelectorAll('#documents-toolbar [data-document-command]')) {
      const command = button.dataset.documentCommand;
      button.setAttribute('aria-pressed', String(command === 'h1' ? studio.editor.isActive('heading', { level: 1 }) : command === 'h2' ? studio.editor.isActive('heading', { level: 2 }) : studio.editor.isActive(command)));
    }
  }
  function history() {
    const items=studio.library.filter(item=>Boolean(item.deletedAt)===studio.trash);
    $('#documents-trash-toggle').textContent=studio.trash?'Volver a documentos':'Ver papelera';$('#documents-trash-toggle').setAttribute('aria-pressed',String(studio.trash));
    $('#documents-history').innerHTML = items.map(item => `<div class="document-history-row"><div><h3>${h(item.title)}</h3><p>${item.pageCount} ${item.pageCount === 1 ? 'página' : 'páginas'} · Tamaño ${item.paperSize === 'oficio' ? 'Oficio' : 'Carta'} · ${h(formatDate(item.updatedAt))}</p></div><div class="library-row-actions">${studio.trash?`<button class="button button-secondary" type="button" data-restore-document="${h(item.id)}" ${!canEdit()?'disabled':''}>Restaurar</button>`:`<button class="button button-secondary" type="button" data-document-id="${h(item.id)}">Abrir documento</button><button class="text-action library-trash-action" type="button" data-delete-document="${h(item.id)}" ${!canEdit()?'disabled':''}>Eliminar</button>`}</div></div>`).join('') || `<p class="empty-state">${studio.trash?'La papelera está vacía.':'Aquí aparecerán tus documentos con membrete.'}</p>`;
    for (const button of $('#documents-history').querySelectorAll('[data-document-id]')) button.addEventListener('click', () => { const item = studio.library.find(item => item.id === button.dataset.documentId); open(item).catch(failure => error(explain(failure))); });
    for(const button of $('#documents-history').querySelectorAll('[data-delete-document],[data-restore-document]'))button.addEventListener('click',async()=>{
      if(studio.busy)return;const restore=Boolean(button.dataset.restoreDocument),id=button.dataset.restoreDocument||button.dataset.deleteDocument,item=studio.library.find(item=>item.id===id);
      if(!item||!restore&&!await confirmLibraryRemoval(item.title))return;studio.busy=true;sync();button.disabled=true;
      try{await api(`/api/cms/documents/${id}${restore?'/restore':''}`,{method:restore?'POST':'DELETE',body:{version:item.updatedAt}});if(studio.saved?.id===id){studio.editor?.destroy();studio.editor=null;studio.saved=null;studio.dirty=false;$('#documents-result').hidden=true;}notify(restore?'Documento restaurado.':'Documento movido a la papelera.');await load();}catch(failure){error(explain(failure));}finally{studio.busy=false;sync();}
    });
  }
  function upsert(item) { studio.library = [item, ...studio.library.filter(record => record.id !== item.id)]; history(); }
  async function poll(job) {
    studio.busy = true; studio.job = job.id; sync();if($('#documents-progress').hidden||$('#documents-progress').dataset.state!=='running')progress.start({includeImages:false,created:job.created});
    try {
      for (;;) {
        progress.update(job);
        if (job.state === 'complete') {progress.finish('Documento guardado. Word editable y PDF listos.'); studio.busy = false; studio.dirty = false; clearFiles(); upsert(job.result); await open(job.result); notify('Documento guardado. DOCX y PDF listos.'); break; }
        if (job.state === 'failed') throw new Error(job.error || 'DOCUMENT_GENERATION_FAILED');
        await new Promise(resolve => setTimeout(resolve, 1800));
        job = (await api(`/api/cms/documents/jobs/${studio.job}`)).job;
      }
    } catch (failure) { error(explain(failure));progress.fail(explain(failure)); }
    finally { studio.busy = false; studio.job = null; sync(); }
  }
  async function load() {
    if (studio.loading) return studio.loading;
    studio.loading = (async () => {
      try {
        const result = await api('/api/cms/documents?includeDeleted=1'); studio.library = result.documents || []; studio.configured = result.generator?.aiConfigured;
        $('#documents-config').textContent = `Membrete original de Expresión Jurídica · Carta u Oficio · ${studio.configured ? `Agente: ${result.generator.textModel}` : 'Puedes crear documentos sin IA. Añade OPENAI_API_KEY para organizar con Sol.'}`;
        $('#documents-mode').querySelector('[value="organize"]').disabled = !studio.configured;
        history(); sync(); if (result.activeJob && !studio.job) await poll(result.activeJob);
      } catch (failure) { error(explain(failure)); }
    })().finally(() => { studio.loading = null; }); return studio.loading;
  }
  $('#documents-form').addEventListener('submit', async event => {
    event.preventDefault(); if (studio.busy) return;
    if (studio.dirty) { error('Guarda o restablece la edición actual antes de crear otro documento.'); return; }
    const source = $('#documents-source').value.trim();
    if (!source && !studio.files.length) { error('Pega texto o sube al menos un archivo DOCX o PDF.'); return; }
    error(); studio.busy = true; sync();
    progress.start({includeImages:false});$('#documents-progress').scrollIntoView({behavior:'smooth',block:'center'});
    try {
      const body = new FormData();
      body.append('title', $('#documents-title').value); body.append('text', $('#documents-source').value); body.append('mode', $('#documents-mode').value); body.append('instructions', $('#documents-instructions').value); body.append('paperSize', $('#documents-paper-size').value);
      studio.files.forEach(file => body.append('documents', file, file.name));
      const response = await api('/api/cms/documents/generate', { method: 'POST', body }); await poll(response.job);
    }
    catch (failure) { error(explain(failure));progress.fail(explain(failure)); studio.busy = false; sync(); }
  });
  $('#documents-save').addEventListener('click', async () => {
    if (!studio.saved || studio.busy) return; error(); studio.busy = true; sync();
    progress.start({includeImages:false,title:'Guardando tu documento',message:'Aplicando los ajustes al membrete y las descargas…'});
    try { const response = await api(`/api/cms/documents/${studio.saved.id}`, { method: 'PATCH', body: { document: studio.editor.getJSON(), title: $('#documents-editor-title').value, version: studio.saved.updatedAt } }); await poll(response.job); }
    catch (failure) { error(explain(failure));progress.fail(explain(failure)); studio.busy = false; sync(); }
  });
  $('#documents-revert').addEventListener('click', () => { if (studio.saved && !studio.busy) { studio.dirty = false; open(studio.saved).catch(failure => error(explain(failure))); } });
  $('#documents-editor-title').addEventListener('input', dirty);
  $('#documents-mode').addEventListener('change', sync);
  $('#documents-files').addEventListener('change', event => addFiles(event.target.files));
  $('#documents-refresh').addEventListener('click', load);
  $('#documents-trash-toggle').addEventListener('click',()=>{studio.trash=!studio.trash;history();});
  for (const link of document.querySelectorAll('#documents-downloads a')) link.addEventListener('click', event => { if (studio.dirty || studio.busy) { event.preventDefault(); notify('Guarda los cambios para actualizar las descargas.'); } });
  for (const button of document.querySelectorAll('#documents-toolbar [data-document-command]')) button.addEventListener('click', () => {
    if (!studio.editor || studio.busy || !canEdit()) return;
    const command = button.dataset.documentCommand, chain = studio.editor.chain().focus();
    const actions = { bold: 'toggleBold', italic: 'toggleItalic', underline: 'toggleUnderline', bulletList: 'toggleBulletList', orderedList: 'toggleOrderedList', blockquote: 'toggleBlockquote', undo: 'undo', redo: 'redo', paragraph: 'setParagraph' };
    if (command === 'h1' || command === 'h2') chain.toggleHeading({ level: command === 'h1' ? 1 : 2 }).run(); else chain[actions[command]]().run(); toolbarState();
  });
  return { load };
}

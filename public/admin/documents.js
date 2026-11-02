export function createDocumentStudio({ api, state, notify, escapeHtml: h, formatDate }) {
  const $ = selector => document.querySelector(selector);
  if (!$('#documents-form')) return { load: async () => {} };
  const studio = { library: [], saved: null, editor: null, busy: false, dirty: false, configured: false, loading: null, job: null };
  const canEdit = () => ['owner', 'editor'].includes(state.user?.role);
  function error(message = '') { $('#documents-error').textContent = message; $('#documents-error').hidden = !message; }
  function sync() {
    for (const control of document.querySelectorAll('#documents-form input, #documents-form select, #documents-form textarea, #documents-form button, #documents-toolbar button')) control.disabled = studio.busy || !canEdit();
    $('#documents-save').disabled = studio.busy || !canEdit() || !studio.dirty;
    $('#documents-revert').disabled = studio.busy || !studio.dirty;
    studio.editor?.setEditable(canEdit() && !studio.busy, false);
    $('#documents-edit-state').textContent = studio.busy ? 'Preparando archivos…' : studio.dirty ? 'Cambios sin guardar' : 'Guardado';
    $('#documents-prepare').textContent = studio.busy ? 'Preparando documento…' : $('#documents-mode').value === 'organize' ? 'Organizar con Sol y crear documento' : 'Crear documento con mi texto';
    $('#documents-ai-direction').hidden = $('#documents-mode').value !== 'organize';
    for (const link of document.querySelectorAll('#documents-downloads a')) { link.setAttribute('aria-disabled', String(studio.dirty || studio.busy)); link.classList.toggle('document-download-pending', studio.dirty || studio.busy); }
    $('#documents-preview-note').hidden = !studio.dirty;
    $('#documents-editor-title').readOnly = studio.busy || !canEdit();
  }
  function dirty() { studio.dirty = true; sync(); }
  const messages = { CSRF_INVALID: 'La sesión se actualizó en otra pestaña. Tu texto permanece en el editor.', STUDIO_JOB_INTERRUPTED: 'La generación se interrumpió. Puedes volver a intentarlo.', OPENAI_API_KEY_MISSING: 'Falta OPENAI_API_KEY en los Secrets de Replit.', OPENAI_OUTPUT_INCOMPLETE: 'Sol no terminó el documento. Intenta dividir el texto o reducir las instrucciones.', DOCUMENT_VERSION_CHANGED: 'El documento cambió en otra edición. Actualiza el historial y abre la versión reciente.', STUDIO_STORAGE_UNAVAILABLE: 'No se pudo acceder al almacenamiento. Tu texto sigue en el editor; vuelve a intentar guardar.' };
  const explain = failure => messages[failure.detail] || messages[failure.message] || failure.detail || 'No se pudo preparar el documento. Vuelve a intentarlo.';
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
    $('#documents-result-meta').textContent = `${item.pageCount} ${item.pageCount === 1 ? 'página' : 'páginas'} en PDF · ${item.aiUsed ? item.model : 'Texto conservado sin IA'} · Word editable`;
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
    $('#documents-history').innerHTML = studio.library.map(item => `<div class="document-history-row"><div><h3>${h(item.title)}</h3><p>${item.pageCount} ${item.pageCount === 1 ? 'página' : 'páginas'} · ${h(formatDate(item.updatedAt))}</p></div><button class="button button-secondary" type="button" data-document-id="${h(item.id)}">Abrir documento</button></div>`).join('') || '<p class="empty-state">Aquí aparecerán tus documentos con membrete.</p>';
    for (const button of $('#documents-history').querySelectorAll('button')) button.addEventListener('click', () => { const item = studio.library.find(item => item.id === button.dataset.documentId); open(item).catch(failure => error(explain(failure))); });
  }
  function upsert(item) { studio.library = [item, ...studio.library.filter(record => record.id !== item.id)]; history(); }
  async function poll(job) {
    studio.busy = true; studio.job = job.id; sync(); $('#documents-progress').hidden = false;
    try {
      for (;;) {
        $('#documents-progress-message').textContent = job.message;
        $('#documents-progress-bar').value = Math.max(0, Number(job.completed || 0)); $('#documents-progress-bar').max = Math.max(1, Number(job.total || 1));
        if (job.state === 'complete') { studio.busy = false; studio.dirty = false; upsert(job.result); await open(job.result); notify('Documento guardado. DOCX y PDF listos.'); break; }
        if (job.state === 'failed') throw new Error(job.error || 'DOCUMENT_GENERATION_FAILED');
        await new Promise(resolve => setTimeout(resolve, 1800));
        job = (await api(`/api/cms/documents/jobs/${studio.job}`)).job;
      }
    } catch (failure) { error(explain(failure)); }
    finally { studio.busy = false; studio.job = null; $('#documents-progress').hidden = true; sync(); }
  }
  async function load() {
    if (studio.loading) return studio.loading;
    studio.loading = (async () => {
      try {
        const result = await api('/api/cms/documents'); studio.library = result.documents || []; studio.configured = result.generator?.aiConfigured;
        $('#documents-config').textContent = `Membrete original de Expresión Jurídica · Carta · ${studio.configured ? `Agente: ${result.generator.textModel}` : 'Puedes crear documentos sin IA. Añade OPENAI_API_KEY para organizar con Sol.'}`;
        $('#documents-mode').querySelector('[value="organize"]').disabled = !studio.configured;
        history(); sync(); if (result.activeJob && !studio.job) await poll(result.activeJob);
      } catch (failure) { error(explain(failure)); }
    })().finally(() => { studio.loading = null; }); return studio.loading;
  }
  $('#documents-form').addEventListener('submit', async event => {
    event.preventDefault(); if (studio.busy) return;
    if (studio.dirty) { error('Guarda o restablece la edición actual antes de crear otro documento.'); return; }
    error(); studio.busy = true; sync();
    try { const response = await api('/api/cms/documents/generate', { method: 'POST', body: { title: $('#documents-title').value, text: $('#documents-source').value, mode: $('#documents-mode').value, instructions: $('#documents-instructions').value } }); await poll(response.job); }
    catch (failure) { error(explain(failure)); studio.busy = false; sync(); }
  });
  $('#documents-save').addEventListener('click', async () => {
    if (!studio.saved || studio.busy) return; error(); studio.busy = true; sync();
    try { const response = await api(`/api/cms/documents/${studio.saved.id}`, { method: 'PATCH', body: { document: studio.editor.getJSON(), title: $('#documents-editor-title').value, version: studio.saved.updatedAt } }); await poll(response.job); }
    catch (failure) { error(explain(failure)); studio.busy = false; sync(); }
  });
  $('#documents-revert').addEventListener('click', () => { if (studio.saved && !studio.busy) { studio.dirty = false; open(studio.saved).catch(failure => error(explain(failure))); } });
  $('#documents-editor-title').addEventListener('input', dirty);
  $('#documents-mode').addEventListener('change', sync);
  $('#documents-refresh').addEventListener('click', load);
  for (const link of document.querySelectorAll('#documents-downloads a')) link.addEventListener('click', event => { if (studio.dirty || studio.busy) { event.preventDefault(); notify('Guarda los cambios para actualizar las descargas.'); } });
  for (const button of document.querySelectorAll('#documents-toolbar [data-document-command]')) button.addEventListener('click', () => {
    if (!studio.editor || studio.busy || !canEdit()) return;
    const command = button.dataset.documentCommand, chain = studio.editor.chain().focus();
    const actions = { bold: 'toggleBold', italic: 'toggleItalic', underline: 'toggleUnderline', bulletList: 'toggleBulletList', orderedList: 'toggleOrderedList', blockquote: 'toggleBlockquote', undo: 'undo', redo: 'redo', paragraph: 'setParagraph' };
    if (command === 'h1' || command === 'h2') chain.toggleHeading({ level: command === 'h1' ? 1 : 2 }).run(); else chain[actions[command]]().run(); toolbarState();
  });
  return { load };
}

const NETWORKS = { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', x: 'X', threads: 'Threads', tiktok: 'TikTok' };
const SIZES = { portrait: [1080, 1350], square: [1080, 1080], story: [1080, 1920], landscape: [1080, 566] };
const SIZE_LABELS = { portrait: 'Vertical 4:5', square: 'Cuadrado 1:1', story: 'Historia 9:16', landscape: 'Horizontal' };

export function createSocialStudio({ api, state, notify, escapeHtml: h, formatDate }) {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  if (!$('#posts-form')) return { load: async () => {} };
  const studio = { library: [], saved: null, draft: null, index: 0, network: 'linkedin', busy: false, dirty: false, polling: null, configured: false };
  const attachments = { documents: [], supportImages: [] };
  const canEdit = () => ['owner', 'editor'].includes(state.user?.role);
  const clone = value => JSON.parse(JSON.stringify(value));
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
    $('#posts-revert').disabled = studio.busy || !studio.draft;
    $('#posts-count').disabled = studio.busy || !canEdit() || $('#posts-mode').value === 'single';
    for (const control of $$('#posts-form input, #posts-form select, #posts-form textarea')) {
      if (control.id !== 'posts-count') control.disabled = studio.busy || !canEdit();
    }
    for (const control of $$('#posts-edit-form input, #posts-edit-form select, #posts-edit-form textarea')) control.disabled = studio.busy || !canEdit();
    $('#posts-copy-text').readOnly = studio.busy || !canEdit();
    for (const element of $('#posts-canvas').contentDocument?.querySelectorAll('[data-field]') || []) element.contentEditable = canEdit() && !studio.busy ? 'true' : 'false';
    for (const link of $$('#posts-result a[download]')) {
      link.setAttribute('aria-disabled', String(studio.busy || studio.dirty));
      link.classList.toggle('social-download-pending', studio.busy || studio.dirty);
    }
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
    $('#posts-history').innerHTML = studio.library.map(item => `<article class="social-history-row"><img src="${h(item.files.png[0])}&v=${encodeURIComponent(item.updatedAt)}" alt="${h(item.posts[0]?.altText || item.title)}" loading="lazy"/><div><small>${h(formatDate(item.updatedAt))}</small><h3>${h(item.title)}</h3><p>${item.count} ${item.count === 1 ? 'pieza' : 'piezas'} · ${h(SIZE_LABELS[item.size] || item.size)} · ${item.aiUsed ? h(item.model) : 'Prueba sin IA'}</p></div><button type="button" class="button button-secondary" data-open-post="${h(item.id)}">Abrir estudio</button></article>`).join('') || '<div class="empty-state"><strong>Aún no hay diseños</strong><span>Genera un post o carrusel para abrir el estudio.</span></div>';
    for (const button of $$('#posts-history [data-open-post]')) button.addEventListener('click', () => {
      if (studio.busy) return;
      const item = studio.library.find(record => record.id === button.dataset.openPost);
      if (item) { openRecord(item); $('#posts-result').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
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
    Object.assign(post, { layout: $('#posts-edit-layout').value, eyebrow: $('#posts-edit-eyebrow').value, headline: $('#posts-edit-headline').value, body: $('#posts-edit-body').value, bullets: $('#posts-edit-bullets').value.split('\n').map(value => value.trim()).filter(Boolean), cta: $('#posts-edit-cta').value, altText: $('#posts-edit-alt').value });
  }
  function fillInspector() {
    const post = studio.draft.posts[studio.index];
    for (const key of ['layout', 'eyebrow', 'headline', 'body', 'cta']) $(`#posts-edit-${key}`).value = post[key] || '';
    $('#posts-edit-bullets').value = (post.bullets || []).join('\n'); $('#posts-edit-alt').value = post.altText || '';
    $('#posts-piece-label').textContent = `Pieza ${studio.index + 1} de ${studio.draft.count}`;
    $('#posts-download-png').href = `${studio.draft.files.png[studio.index]}&download=1`;
    $('#posts-download-html').href = `${studio.draft.files.html[studio.index]}&download=1`;
  }
  function applyDraftToFrame() {
    const document = $('#posts-canvas').contentDocument;
    const post = studio.draft?.posts[studio.index];
    if (!document || !post) return;
    for (const element of document.querySelectorAll('[data-field]')) {
      const field = element.dataset.field;
      if (field.startsWith('bullet-')) element.textContent = post.bullets[Number(field.slice(7))] || '';
      else if (field === 'bullets') element.textContent = post.bullets.map(value => `• ${value}`).join('\n');
      else element.textContent = post[field] || '';
      element.contentEditable = canEdit() && !studio.busy ? 'true' : 'false';
      element.oninput = () => {
        if (studio.busy || !canEdit()) return;
        const text = element.innerText.trim();
        if (field.startsWith('bullet-')) post.bullets[Number(field.slice(7))] = text;
        else if (field === 'bullets') post.bullets = text.split('\n').map(value => value.replace(/^\s*•\s*/, '').trim()).filter(Boolean);
        else post[field] = text;
        fillInspector(); markDirty();
      };
    }
  }
  function selectPiece(index) {
    if (studio.busy) return;
    readInspector(); studio.index = index;
    for (const button of $$('#posts-piece-strip button')) button.setAttribute('aria-pressed', String(Number(button.dataset.piece) === index));
    fillInspector();
    const [width, height] = SIZES[studio.draft.size] || SIZES.portrait;
    $('#posts-canvas-wrap').style.aspectRatio = `${width}/${height}`;
    const frame = $('#posts-canvas'); frame.onload = applyDraftToFrame;
    frame.src = `${studio.draft.files.html[index]}&v=${encodeURIComponent(studio.draft.updatedAt)}`;
    syncButtons();
  }
  function openRecord(record, preserveSelection = false) {
    const index = preserveSelection ? Math.min(studio.index, record.count - 1) : 0;
    studio.saved = clone(record); studio.draft = clone(record); studio.dirty = false;
    $('#posts-result').hidden = false;
    $('#posts-result-title').textContent = record.title;
    $('#posts-result-meta').textContent = `${record.count} ${record.count === 1 ? 'pieza' : 'piezas'} · ${SIZES[record.size]?.join(' × ') || record.size} · ${record.aiUsed ? `Contenido: ${record.model}` : 'Prueba sin IA'}${record.imageModel ? ` · Fotos: ${record.imageModel}` : ''}`;
    $('#posts-download-pack').href = record.files.pack; $('#posts-download-copy').href = record.files.copy;
    $('#posts-edit-state').textContent = 'Guardado'; $('#posts-copy-note').textContent = 'Puedes ajustar el copy antes de descargar o copiarlo.';
    $('#posts-piece-strip').innerHTML = record.files.png.map((url, piece) => `<button type="button" data-piece="${piece}" aria-label="Editar pieza ${piece + 1}" aria-pressed="${piece === index}"><img src="${h(url)}&v=${encodeURIComponent(record.updatedAt)}" alt="${h(record.posts[piece]?.altText || '')}" loading="lazy"/><span>${String(piece + 1).padStart(2, '0')}</span></button>`).join('');
    for (const button of $$('#posts-piece-strip button')) button.addEventListener('click', () => selectPiece(Number(button.dataset.piece)));
    const sources = (record.sources || []).filter(source => /^https?:\/\//i.test(source.url || ''));
    $('#posts-sources').hidden = !sources.length;
    $('#posts-sources').innerHTML = sources.length ? `<strong>Fuentes consultadas</strong><ul>${sources.map(source => `<li><a href="${h(source.url)}" target="_blank" rel="noopener noreferrer">${h(source.title || source.url)}</a></li>`).join('')}</ul>` : '';
    // Set fields before selecting, so the previous record cannot overwrite the draft.
    studio.index = index; fillInspector(); selectPiece(index); renderCopy(); syncButtons();
  }
  async function waitJob(id) {
    if (studio.polling) return studio.polling;
    studio.busy = true; error(); syncButtons(); $('#posts-progress').hidden = false;
    studio.polling = (async () => {
      for (;;) {
        const { job } = await api(`/api/cms/posts/jobs/${encodeURIComponent(id)}`);
        $('#posts-progress-title').textContent = job.message;
        $('#posts-progress-detail').textContent = job.total > 1 ? `${job.completed} de ${job.total}` : 'El agente está preparando el resultado.';
        $('#posts-progress-bar').max = Math.max(1, job.total); $('#posts-progress-bar').value = job.completed;
        if (job.state === 'failed') throw new Error(job.error || 'No se pudo completar el trabajo.');
        if (job.state === 'complete') return job.result;
        await new Promise(resolve => setTimeout(resolve, 1800));
      }
    })();
    try {
      const record = await studio.polling;
      studio.busy = false; openRecord(record, true);
      studio.library = [record, ...studio.library.filter(item => item.id !== record.id)]; renderLibrary();
      $('#posts-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
      notify('Diseños y copy guardados.'); return record;
    } catch (failure) {
      const message = failure.message === 'POST_JOB_INTERRUPTED' ? 'La generación se interrumpió. Puedes volver a intentarlo.' : failure.message?.startsWith('OPENAI_') ? 'OpenAI no pudo completar el trabajo. Revisa los créditos y el acceso a los modelos e inténtalo de nuevo.' : failure.detail || failure.message;
      error(message || 'No se pudo completar el trabajo.'); notify(message || 'No se pudo completar el trabajo.', 'error');
    } finally { studio.busy = false; studio.polling = null; $('#posts-progress').hidden = true; syncButtons(); }
  }
  async function load() {
    try {
      const response = await api('/api/cms/posts'); studio.library = response.posts || []; studio.configured = Boolean(response.generator?.aiConfigured);
      $('#posts-config').textContent = studio.configured ? `Sol (${response.generator.textModel}) · Fotografías: ${response.generator.imageModel} · Identidad EJ activa` : 'Añade OPENAI_API_KEY en Secrets de Replit para activar el agente. Puedes probar las plantillas sin IA.';
      renderLibrary(); syncButtons();
      if (response.activeJob && !studio.polling) waitJob(response.activeJob.id);
    } catch (failure) { if (failure.code !== 'AUTH_REQUIRED') error('No se pudo cargar el estudio. Pulsa Actualizar para reintentar.'); }
  }
  async function generate(event) {
    event.preventDefault(); if (studio.busy) return;
    const topic = $('#posts-topic').value.trim(), source = $('#posts-source').value.trim();
    if (topic.length < 3 && source.length < 3 && !attachments.documents.length) return error('Escribe un tema, pega información o sube un documento.');
    const body = new FormData();
    const values = { topic, sourceText: source, mode: $('#posts-mode').value, count: $('#posts-count').value, size: $('#posts-size').value, direction: $('#posts-direction').value, language: $('#posts-language').value, includeImages: $('#posts-include-images').checked, webSearch: $('#posts-web-search').checked };
    Object.entries(values).forEach(([key, value]) => body.append(key, String(value)));
    for (const field of ['documents', 'supportImages']) attachments[field].forEach(file => body.append(field, file));
    studio.busy = true; syncButtons(); error();
    try { const response = await api('/api/cms/posts/generate', { method: 'POST', body }); await waitJob(response.job.id); }
    catch (failure) { studio.busy = false; syncButtons(); error(failure.detail || 'No se pudo iniciar la generación. Inténtalo de nuevo.'); }
  }
  async function save(event) {
    event?.preventDefault(); if (studio.busy || !studio.draft) return;
    readInspector(); studio.busy = true; syncButtons(); error();
    try {
      const response = await api(`/api/cms/posts/${studio.draft.id}`, { method: 'PATCH', body: { title: studio.draft.title, posts: studio.draft.posts, copies: studio.draft.copies, version: studio.saved.updatedAt } });
      await waitJob(response.job.id);
    } catch (failure) { studio.busy = false; syncButtons(); error(failure.detail || 'No se pudieron guardar los cambios.'); }
  }
  async function copyText(text, label) {
    try { await navigator.clipboard.writeText(text); notify(`${label} copiado.`); }
    catch { notify('No se pudo copiar. Selecciona el texto o descarga el archivo.', 'error'); }
  }
  $('#posts-form').addEventListener('submit', generate);
  $('#posts-edit-form').addEventListener('submit', save);
  $('#posts-save-copy').addEventListener('click', save);
  $('#posts-mode').addEventListener('change', syncButtons);
  $('#posts-documents').addEventListener('change', event => addFiles(event, 'documents'));
  $('#posts-support-images').addEventListener('change', event => addFiles(event, 'supportImages'));
  $('#posts-refresh').addEventListener('click', load);
  $('#posts-revert').addEventListener('click', () => { if (studio.saved && !studio.busy) openRecord(studio.saved, true); });
  for (const field of $$('#posts-edit-form input, #posts-edit-form textarea, #posts-edit-layout')) field.addEventListener('input', () => { readInspector(); applyDraftToFrame(); markDirty(); });
  $('#posts-copy-text').addEventListener('input', () => { if (studio.draft) { studio.draft.copies[studio.network] = $('#posts-copy-text').value; markDirty(); captionCount(); } });
  $('#posts-copy-caption').addEventListener('click', () => copyText($('#posts-copy-text').value, 'Texto'));
  $('#posts-copy-html').addEventListener('click', async () => {
    if (!studio.draft || studio.dirty) return notify('Aplica los cambios para copiar el HTML actualizado.', 'error');
    try { const response = await fetch(studio.draft.files.html[studio.index], { credentials: 'include' }); if (!response.ok) throw new Error('HTML_UNAVAILABLE'); await copyText(await response.text(), 'HTML'); }
    catch { notify('No se pudo copiar el HTML. Puedes descargarlo desde el botón HTML editable.', 'error'); }
  });
  $('#posts-regenerate-copy').addEventListener('click', async () => {
    if (!studio.draft || studio.busy) return;
    if (studio.dirty) return notify('Aplica los cambios antes de actualizar el copy con IA.', 'error');
    studio.busy = true; syncButtons();
    try { const response = await api(`/api/cms/posts/${studio.draft.id}/copy`, { method: 'POST', body: {} }); await waitJob(response.job.id); }
    catch (failure) { studio.busy = false; syncButtons(); error(failure.detail || 'No se pudo actualizar el copy.'); }
  });
  for (const link of $$('#posts-result a[download]')) link.addEventListener('click', event => { if (studio.dirty || studio.busy) { event.preventDefault(); notify('Aplica los cambios antes de descargar la versión actualizada.', 'error'); } });
  return { load };
}

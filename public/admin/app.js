const state = {
  user: null,
  csrf: null,
  view: 'dashboard',
  pages: [],
  selectedPage: null,
  fields: [],
  homeFields: [],
  media: [],
  mediaFolders: [],
  mediaFolder: '',
  mediaTarget: null,
  mediaReturnView: 'pages',
  settings: null,
  users: [],
  submissions: [],
  googleEnabled: false,
  setup: false
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function notify(message, tone = 'default') {
  const toast = document.createElement('div');
  toast.className = `toast ${tone}`;
  toast.textContent = message;
  $('#toast-region').appendChild(toast);
  setTimeout(() => toast.remove(), 3600);
}

async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.csrf && options.method && options.method !== 'GET') headers.set('x-cms-csrf', state.csrf);
  let body = options.body;
  if (body && !(body instanceof FormData) && typeof body === 'object') {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  }
  const response = await fetch(url, { ...options, headers, body, credentials: 'include' });
  if (response.status === 401 && !url.startsWith('/api/auth/')) {
    showAuth(false);
    throw new Error('AUTH_REQUIRED');
  }
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `HTTP_${response.status}`);
    error.code = payload.error;
    error.status = response.status;
    error.ownerEmail = payload.ownerEmail;
    throw error;
  }
  return payload;
}

async function authRequest(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || payload.code || `HTTP_${response.status}`);
  return payload;
}

async function signInWithGoogle() {
  if (!state.googleEnabled) return;
  try {
    const payload = await authRequest('/api/auth/sign-in/social', { provider: 'google', callbackURL: '/admin/' });
    if (payload?.url) window.location.assign(payload.url);
    else window.location.reload();
  } catch (error) {
    $('#auth-error').textContent = `No se pudo iniciar con Google: ${error.message}`;
    $('#auth-error').hidden = false;
  }
}

function showAuth(setup) {
  state.setup = setup;
  $('#app').dataset.state = 'auth';
  $('#auth-view').hidden = false;
  $('#sidebar').hidden = true;
  $('#main-view').hidden = true;
  $('#auth-title').textContent = 'Inicia sesión';
  $('#auth-copy').textContent = 'Accede al CMS con una cuenta autorizada para administrar el sitio público.';
  $('#auth-submit').textContent = 'Iniciar sesión';
  $('#auth-password').autocomplete = 'current-password';
  // Keep the login screen neutral: never expose or persist the administrator email.
  $('#auth-email').readOnly = false;
  $('#auth-email').value = '';
  $('#auth-email').placeholder = 'tu@email.com';
  $('#google-login').hidden = !state.googleEnabled;
  $('#auth-divider').hidden = !state.googleEnabled;
  $('#auth-error').hidden = true;
}

function showApp() {
  $('#app').dataset.state = 'ready';
  $('#auth-view').hidden = true;
  $('#sidebar').hidden = false;
  $('#main-view').hidden = false;
  $$('[data-owner-only]').forEach((element) => { element.hidden = state.user?.role !== 'owner'; });
  const canEdit = ['owner', 'editor'].includes(state.user?.role);
  $('#publish-button').hidden = !canEdit;
  $('#media-upload')?.closest('label')?.toggleAttribute('hidden', !canEdit);
  $('#view-title').textContent = 'Inicio';
  navigate('home');
}

function navigate(view) {
  state.view = view;
  const titles = { home: 'Inicio', dashboard: 'Resumen', pages: 'Páginas', media: 'App Storage', revisions: 'Versiones', activity: 'Actividad', submissions: 'Solicitudes', settings: 'Ajustes', users: 'Usuarios' };
  $('#view-title').textContent = titles[view] || 'CMS';
  $$('.nav-item[data-view]').forEach((button) => button.classList.toggle('is-active', button.dataset.view === view));
  $$('.content-view').forEach((section) => { section.hidden = section.id !== `${view}-view`; });
  if (view === 'home') loadHome();
  if (view === 'dashboard') loadDashboard();
  if (view === 'pages') loadPages();
  if (view === 'media') loadMedia();
  if (view === 'revisions') loadRevisions();
  if (view === 'activity') loadActivity();
  if (view === 'submissions') loadSubmissions();
  if (view === 'settings') loadSettings();
  if (view === 'users') loadUsers();
}

function renderSummary(summary) {
  $('#summary-grid').innerHTML = [
    ['Páginas públicas', summary.pages, 'Rutas inventariadas'],
    ['Campos editables', summary.fields, 'Texto, links y medios'],
    ['Borradores', summary.draftFields, summary.draftFields ? 'Listos para publicar' : 'Sin cambios pendientes'],
    ['Activos guardados', summary.media, 'Biblioteca persistente']
  ].map(([label, value, note]) => `<div class="metric"><span class="metric-label">${escapeHtml(label)}</span><strong class="metric-value">${escapeHtml(value)}</strong><span class="metric-note">${escapeHtml(note)}</span></div>`).join('');
  $('#draft-count').textContent = summary.draftFields;
  const badge = $('#submission-badge');
  if (badge) { badge.textContent = summary.submissions || 0; badge.hidden = !(summary.submissions > 0); }
}

function renderPageOverview(pages) {
  $('#page-overview').innerHTML = pages.slice(0, 8).map((page) => `<button class="page-overview-item" data-page-route="${escapeHtml(page.page)}"><strong>${escapeHtml(page.title || page.page)}</strong><span>${escapeHtml(page.page)}</span><span class="overview-count">${escapeHtml(page.fieldCount)} <small>campos</small></span></button>`).join('') || '<div class="empty-state"><span>No hay páginas inventariadas.</span></div>';
  $$('.page-overview-item').forEach((button) => button.addEventListener('click', () => { state.selectedPage = button.dataset.pageRoute; navigate('pages'); }));
}

function renderActivityOverview(items) {
  $('#activity-overview').innerHTML = items.slice(0, 6).map((item) => `<div class="activity-row"><i></i><div><strong>${escapeHtml(item.action)}</strong><small>${escapeHtml(item.actor)} · ${escapeHtml(formatDate(item.at))}</small></div></div>`).join('') || '<div class="empty-state"><span>Aún no hay actividad.</span></div>';
}

async function loadDashboard() {
  try {
    const [summary, pages, activity] = await Promise.all([api('/api/cms/summary'), api('/api/cms/pages'), api('/api/cms/activity')]);
    renderSummary(summary);
    renderPageOverview(pages.pages);
    renderActivityOverview(activity.activity);
  } catch (error) {
    notify('No se pudo cargar el resumen.', 'error');
  }
}

function homeSectionLabel(section) {
  const labels = {
    SEO: 'SEO de la portada',
    header: 'Cabecera y navegación',
    footer: 'Pie de página',
    '/': 'General'
  };
  return labels[section] || section || 'General';
}

function homeFieldCard(field) {
  const hasDraft = field.draftValue != null;
  const current = field.draftValue ?? field.publishedValue ?? field.original;
  const media = ['image', 'video', 'audio'].includes(field.kind);
  return `<article class="home-field-card" data-field-card="${field.id}" data-field-search="${escapeHtml(`${field.label} ${field.section} ${field.attribute} ${field.original}`.toLowerCase())}" data-field-kind="${escapeHtml(field.kind)}"><div class="home-field-head"><div><strong>${escapeHtml(field.label)}</strong><small>${escapeHtml(field.selector)} · ${escapeHtml(field.attribute)}</small></div><span class="field-kind">${escapeHtml(kindLabel(field))}</span></div>${media ? '<p class="home-field-hint">Este activo se puede reemplazar desde App Storage.</p>' : ''}${fieldInput({ ...field, draftValue: current, publishedValue: null })}<div class="home-field-foot"><span class="field-status ${hasDraft ? 'is-draft' : ''}">${hasDraft ? 'Borrador pendiente' : field.publishedValue != null ? 'Publicado desde CMS' : 'Original'}</span><div class="field-actions">${['owner', 'editor'].includes(state.user?.role) ? `<button class="mini-button home-reset-field" data-field-id="${field.id}" type="button">Restaurar</button><button class="mini-button home-save-field" data-field-id="${field.id}" type="button">Guardar</button>` : '<span class="field-status">Sólo lectura</span>'}</div></div></article>`;
}

function renderHomeEditor(fields) {
  const groups = new Map();
  fields.forEach((field) => { const key = field.section || '/'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(field); });
  $('#home-field-list').innerHTML = [...groups.entries()].map(([section, items]) => `<section class="home-section" data-home-section="${escapeHtml(section)}"><div class="home-section-head"><div><p class="eyebrow">Portada</p><h2>${escapeHtml(homeSectionLabel(section))}</h2></div><span>${items.length} campos</span></div><div class="home-section-grid">${items.map(homeFieldCard).join('')}</div></section>`).join('') || '<div class="empty-state"><strong>La portada no tiene campos</strong><span>Actualiza el inventario para volver a escanearla.</span></div>';
  $$('.home-save-field').forEach((button) => button.addEventListener('click', () => saveField(button.dataset.fieldId)));
  $$('.home-reset-field').forEach((button) => button.addEventListener('click', () => resetField(button.dataset.fieldId)));
  $$('.home-field-card', $('#home-field-list')).forEach((card) => {
    const field = fields.find((candidate) => candidate.id === card.dataset.fieldCard);
    if (field && ['image', 'video', 'audio'].includes(field.kind)) {
      const useButton = document.createElement('button');
      useButton.type = 'button'; useButton.className = 'mini-button'; useButton.textContent = 'Elegir de App Storage';
      useButton.addEventListener('click', () => { state.mediaTarget = field.id; state.mediaReturnView = 'home'; navigate('media'); });
      card.querySelector('.field-actions')?.prepend(useButton);
    }
  });
  filterHomeFields();
}

function filterHomeFields() {
  const search = ($('#home-search')?.value || '').toLowerCase().trim();
  const kind = $('#home-kind')?.value || '';
  $$('.home-field-card').forEach((card) => {
    card.hidden = Boolean((search && !card.dataset.fieldSearch.includes(search)) || (kind && card.dataset.fieldKind !== kind));
  });
  $$('.home-section').forEach((section) => { section.hidden = !section.querySelector('.home-field-card:not([hidden])'); });
}

async function loadHome() {
  try {
    const [fields, summary] = await Promise.all([api('/api/cms/fields?page=%2F&limit=2000'), api('/api/cms/summary')]);
    state.homeFields = fields.fields;
    $('#home-field-count').textContent = fields.total;
    $('#home-draft-count').textContent = summary.draftFields;
    renderHomeEditor(state.homeFields);
  } catch { notify('No se pudo cargar la portada del sitio.', 'error'); }
}

function renderPageList() {
  $('#page-list').innerHTML = `<div class="page-list-heading"><p class="eyebrow">Rutas</p><strong>${state.pages.length} páginas</strong></div>` + state.pages.map((page) => `<button class="page-list-item ${state.selectedPage === page.page ? 'is-active' : ''}" data-page-route="${escapeHtml(page.page)}"><span><strong>${escapeHtml(page.title || page.page)}</strong><span>${escapeHtml(page.page)} · ${escapeHtml(page.fieldCount)} campos</span></span><em>${page.draftFields || 0}</em></button>`).join('');
  $$('.page-list-item').forEach((button) => button.addEventListener('click', () => { state.selectedPage = button.dataset.pageRoute; renderPageList(); loadEditor(); }));
}

async function loadPages() {
  try {
    const response = await api('/api/cms/pages');
    state.pages = response.pages;
    if (!state.selectedPage && state.pages[0]) state.selectedPage = state.pages[0].page;
    renderPageList();
    if (state.selectedPage) await loadEditor();
  } catch (error) {
    notify('No se pudo cargar el inventario de páginas.', 'error');
  }
}

function fieldInput(field) {
  const value = field.draftValue ?? field.publishedValue ?? field.original ?? '';
  const isLong = field.attribute === 'html' || value.length > 140;
  const className = field.attribute === 'html' ? 'html-field' : '';
  const readonly = state.user?.role === 'viewer' ? ' readonly' : '';
  if (isLong) return `<textarea class="${className}" data-field-id="${field.id}" aria-label="${escapeHtml(field.label)}"${readonly}>${escapeHtml(value)}</textarea>`;
  return `<input class="${className}" data-field-id="${field.id}" value="${escapeHtml(value)}" aria-label="${escapeHtml(field.label)}"${readonly} />`;
}

function kindLabel(field) {
  if (field.attribute === 'html') return 'Contenido';
  if (field.kind === 'image' || field.kind === 'video' || field.kind === 'audio') return 'Medio';
  if (field.kind === 'link') return 'Enlace';
  if (field.kind === 'meta') return 'SEO';
  return field.attribute;
}

function renderEditor() {
  const page = state.pages.find((candidate) => candidate.page === state.selectedPage);
  const fields = state.fields;
  if (!page) {
    $('#editor-panel').innerHTML = '<div class="empty-state"><strong>Selecciona una página</strong><span>Elige una ruta para abrir su inventario completo.</span></div>';
    return;
  }
  $('#editor-panel').innerHTML = `<div class="editor-head"><div><p class="eyebrow">${escapeHtml(page.page)}</p><h2>${escapeHtml(page.title || page.page)}</h2><p>${fields.length} campos · los cambios quedan como borrador hasta publicar.</p></div><div class="editor-actions"><a class="button button-secondary" href="${page.page || '/'}?cms_preview=1" target="_blank" rel="noopener">Vista previa ↗</a></div></div><div class="editor-tools"><input id="field-search" placeholder="Buscar texto, selector o sección…" /><select id="field-kind"><option value="">Todos los tipos</option><option value="html">Contenido</option><option value="link">Enlaces</option><option value="image">Imágenes</option><option value="video">Video</option><option value="meta">SEO</option></select></div><div id="field-list" class="field-list"></div>`;
  renderFieldList(fields);
  $('#field-search').addEventListener('input', filterFields);
  $('#field-kind').addEventListener('change', filterFields);
}

function renderFieldList(fields) {
  const list = $('#field-list');
  if (!fields.length) { list.innerHTML = '<div class="empty-state"><strong>Sin resultados</strong><span>Prueba otra búsqueda o tipo de campo.</span></div>'; return; }
  const canEdit = ['owner', 'editor'].includes(state.user?.role);
  list.innerHTML = fields.map((field) => {
    const hasDraft = field.draftValue != null;
    const current = field.draftValue ?? field.publishedValue ?? field.original;
    return `<article class="field-card" data-field-card="${field.id}" data-field-search="${escapeHtml(`${field.label} ${field.section} ${field.attribute} ${field.original}`.toLowerCase())}" data-field-kind="${escapeHtml(field.kind)}"><div class="field-meta"><div><div class="field-label">${escapeHtml(field.label)}</div><span class="field-path">${escapeHtml(field.selector)} · ${escapeHtml(field.attribute)}</span></div><span class="field-kind">${escapeHtml(kindLabel(field))}</span></div>${field.kind === 'image' || field.kind === 'video' || field.kind === 'audio' ? `<div class="field-preview-note">Puedes pegar una ruta existente o usar la biblioteca multimedia.</div>` : ''}${fieldInput({ ...field, draftValue: current, publishedValue: null })}<div class="field-foot"><span class="field-source">Original: ${escapeHtml(field.original).slice(0, 120)}</span><span class="field-status ${hasDraft ? 'is-draft' : ''}">${hasDraft ? 'Borrador pendiente' : field.publishedValue != null ? 'Publicado desde CMS' : 'Valor original'}</span><div class="field-actions">${canEdit ? `<button class="mini-button reset-field" data-field-id="${field.id}" type="button">Restaurar original</button><button class="mini-button save-field" data-field-id="${field.id}" type="button">Guardar borrador</button>` : '<span class="field-status">Sólo lectura</span>'}</div></div></article>`;
  }).join('');
  $$('.save-field', list).forEach((button) => button.addEventListener('click', () => saveField(button.dataset.fieldId)));
  $$('.reset-field', list).forEach((button) => button.addEventListener('click', () => resetField(button.dataset.fieldId)));
  $$('.field-card', list).forEach((card) => {
    const field = fields.find((candidate) => candidate.id === card.dataset.fieldCard);
    if (field && ['image', 'video', 'audio'].includes(field.kind)) {
      const useButton = document.createElement('button');
      useButton.type = 'button'; useButton.className = 'mini-button'; useButton.textContent = 'Elegir desde biblioteca';
      useButton.addEventListener('click', () => { state.mediaTarget = field.id; navigate('media'); });
      card.querySelector('.field-actions')?.prepend(useButton);
    }
  });
}

function filterFields() {
  const search = ($('#field-search')?.value || '').toLowerCase().trim();
  const kind = $('#field-kind')?.value || '';
  $$('.field-card').forEach((card) => {
    const visible = (!search || card.dataset.fieldSearch.includes(search)) && (!kind || card.dataset.fieldKind === kind);
    card.hidden = !visible;
  });
}

async function loadEditor() {
  if (!state.selectedPage) return;
  try {
    const response = await api(`/api/cms/fields?page=${encodeURIComponent(state.selectedPage)}&limit=2000`);
    state.fields = response.fields;
    renderEditor();
  } catch (error) {
    notify('No se pudo cargar la página.', 'error');
  }
}

function inputForField(id) {
  return $(`[data-field-id="${CSS.escape(id)}"]`);
}

async function saveField(id) {
  const input = inputForField(id);
  if (!input) return;
  try {
    await api(`/api/cms/fields/${id}`, { method: 'POST', body: { value: input.value } });
    notify('Borrador guardado.');
    await Promise.all([state.view === 'home' ? loadHome() : loadEditor(), updateDraftCount()]);
  } catch (error) { notify(`No se guardó el campo: ${error.message}`, 'error'); }
}

async function resetField(id) {
  try {
    await api(`/api/cms/fields/${id}`, { method: 'POST', body: { value: null } });
    notify('Se restauró el valor original.');
    await Promise.all([state.view === 'home' ? loadHome() : loadEditor(), updateDraftCount()]);
  } catch (error) { notify(`No se pudo restaurar: ${error.message}`, 'error'); }
}

async function updateDraftCount() {
  const summary = await api('/api/cms/summary');
  $('#draft-count').textContent = summary.draftFields;
}

async function publish() {
  if (!Number($('#draft-count').textContent || 0)) { notify('No hay cambios pendientes.'); return; }
  try { const result = await api('/api/cms/publish', { method: 'POST', body: {} }); notify(`${result.changed} campos publicados.`); await updateDraftCount(); await loadPages(); } catch (error) { notify(`No se pudo publicar: ${error.message}`, 'error'); }
}

function renderMedia() {
  const grid = $('#media-grid');
  if (!state.media.length) { grid.innerHTML = '<div class="empty-state"><strong>Biblioteca vacía</strong><span>Sube una imagen, video, audio o PDF para empezar.</span></div>'; return; }
  const canEdit = ['owner', 'editor'].includes(state.user?.role);
  grid.innerHTML = state.media.map((item) => `<article class="media-card"><div class="media-preview">${item.mime.startsWith('image/') ? `<img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.alt || '')}" loading="lazy" />` : item.mime.startsWith('video/') ? `<video src="${escapeHtml(item.url)}" controls preload="metadata"></video>` : `<span>${escapeHtml(item.mime.split('/')[0].toUpperCase())}</span>`}</div><div class="media-info"><div class="media-kicker">${escapeHtml(item.folder || 'General')}</div><strong title="${escapeHtml(item.originalName)}">${escapeHtml(item.originalName)}</strong><small>${escapeHtml(item.mime)} · ${Math.round(item.size / 1024)} KB</small>${canEdit ? `<input class="media-alt" data-media-id="${item.id}" value="${escapeHtml(item.alt || '')}" placeholder="Texto alternativo" aria-label="Texto alternativo" /><input class="media-caption" data-media-id="${item.id}" value="${escapeHtml(item.caption || '')}" placeholder="Descripción breve" aria-label="Descripción breve" />` : item.caption ? `<p class="media-caption-readonly">${escapeHtml(item.caption)}</p>` : ''}<div class="media-actions">${canEdit ? `<button class="mini-button use-media" data-media-id="${item.id}" type="button">Usar en campo</button><button class="mini-button save-media-meta" data-media-id="${item.id}" type="button">Guardar ficha</button>` : ''}<button class="mini-button copy-media" data-media-url="${item.url}" type="button">Copiar ruta</button></div></div></article>`).join('');
  $('#media-folders').innerHTML = `<button class="folder-item ${!state.mediaFolder ? 'is-active' : ''}" data-media-folder="">Todos los activos <span>${state.mediaFolders.reduce((sum, folder) => sum + folder.count, 0)}</span></button>` + state.mediaFolders.map((folder) => `<button class="folder-item ${state.mediaFolder === folder.name ? 'is-active' : ''}" data-media-folder="${escapeHtml(folder.name)}">${escapeHtml(folder.name)} <span>${folder.count}</span></button>`).join('');
  $$('.folder-item').forEach((button) => button.addEventListener('click', () => { state.mediaFolder = button.dataset.mediaFolder; loadMedia(); }));
  $$('.use-media').forEach((button) => button.addEventListener('click', () => useMedia(button.dataset.mediaId)));
  $$('.copy-media').forEach((button) => button.addEventListener('click', async () => { await navigator.clipboard?.writeText(button.dataset.mediaUrl); notify('Ruta copiada.'); }));
  $$('.save-media-meta').forEach((button) => button.addEventListener('click', () => saveMediaMeta(button.dataset.mediaId)));
}

async function loadMedia() {
  try { const search = $('#media-search')?.value || ''; const params = new URLSearchParams({ ...(state.mediaFolder ? { folder: state.mediaFolder } : {}), ...(search ? { search } : {}) }); const response = await api(`/api/cms/media?${params}`); state.media = response.media; state.mediaFolders = response.folders || []; renderMedia(); } catch (error) { notify('No se pudo cargar la biblioteca.', 'error'); }
}

async function saveMediaMeta(id) {
  const alt = $(`.media-alt[data-media-id="${CSS.escape(id)}"]`)?.value || '';
  const caption = $(`.media-caption[data-media-id="${CSS.escape(id)}"]`)?.value || '';
  try { await api(`/api/cms/media/${encodeURIComponent(id)}`, { method: 'PATCH', body: { alt, caption } }); notify('Ficha del activo actualizada.'); await loadMedia(); } catch (error) { notify(`No se actualizó el activo: ${error.message}`, 'error'); }
}

async function useMedia(id) {
  const item = state.media.find((candidate) => candidate.id === id);
  if (!item || !state.mediaTarget) { notify('Primero abre un campo de imagen o video.', 'error'); return; }
  const target = state.mediaTarget;
  const returnView = state.mediaReturnView || 'pages';
  navigate(returnView);
  // `navigate` starts the async page load; await a second explicit load so the
  // selected field exists before the media URL is written into it.
  if (returnView === 'home') await loadHome();
  else await loadPages();
  const input = inputForField(target);
  if (!input) { notify('El campo ya no está disponible.', 'error'); return; }
  input.value = item.url;
  await saveField(target);
  state.mediaTarget = null;
  state.mediaReturnView = 'pages';
}

async function loadRevisions() {
  try { const response = await api('/api/cms/revisions'); $('#revisions-list').innerHTML = response.revisions.map((revision) => `<div class="stack-row"><div><strong>${escapeHtml(formatDate(revision.at))}</strong><small>${escapeHtml(revision.actor)} · ${escapeHtml(revision.fieldCount)} campos publicados</small></div><button class="button button-secondary restore-revision" data-revision-id="${revision.id}" type="button">Restaurar como borrador</button></div>`).join('') || '<div class="empty-state"><span>Aún no hay versiones.</span></div>'; $$('.restore-revision').forEach((button) => button.addEventListener('click', () => restoreRevision(button.dataset.revisionId))); } catch { notify('No se pudo cargar el historial.', 'error'); }
}

async function restoreRevision(id) {
  try { await api(`/api/cms/revisions/${id}/restore`, { method: 'POST', body: {} }); notify('Versión restaurada como borrador.'); await updateDraftCount(); navigate('pages'); } catch (error) { notify(`No se pudo restaurar: ${error.message}`, 'error'); }
}

async function loadActivity() {
  try { const response = await api('/api/cms/activity'); $('#activity-list').innerHTML = response.activity.map((item) => `<div class="stack-row"><div><strong>${escapeHtml(item.action)}</strong><small>${escapeHtml(item.actor)} · ${escapeHtml(formatDate(item.at))}</small></div><span class="field-kind">${escapeHtml(item.detail?.page || 'CMS')}</span></div>`).join('') || '<div class="empty-state"><span>Aún no hay actividad.</span></div>'; } catch { notify('No se pudo cargar la actividad.', 'error'); }
}

function submissionStatusLabel(status) {
  return ({ new: 'Nueva', in_progress: 'En seguimiento', resolved: 'Resuelta', archived: 'Archivada' })[status] || status;
}

function renderSubmissions(items) {
  $('#submissions-list').innerHTML = items.map((item) => `<article class="submission-row"><div class="submission-main"><div class="submission-top"><strong>${escapeHtml(item.name)}</strong><span class="submission-status status-${escapeHtml(item.status)}">${escapeHtml(submissionStatusLabel(item.status))}</span></div><a href="mailto:${escapeHtml(item.email)}" class="submission-email">${escapeHtml(item.email)}</a><p>${escapeHtml(item.message)}</p><small>${escapeHtml(item.subject)} · ${escapeHtml(formatDate(item.createdAt))}</small></div><div class="submission-actions"><select class="submission-status-select" data-submission-id="${escapeHtml(item.id)}" aria-label="Estado de solicitud"><option value="new" ${item.status === 'new' ? 'selected' : ''}>Nueva</option><option value="in_progress" ${item.status === 'in_progress' ? 'selected' : ''}>En seguimiento</option><option value="resolved" ${item.status === 'resolved' ? 'selected' : ''}>Resuelta</option><option value="archived" ${item.status === 'archived' ? 'selected' : ''}>Archivada</option></select><button type="button" class="mini-button save-submission" data-submission-id="${escapeHtml(item.id)}">Guardar</button></div></article>`).join('') || '<div class="empty-state"><strong>Sin solicitudes</strong><span>Las solicitudes del formulario público aparecerán aquí.</span></div>';
  $$('.save-submission').forEach((button) => button.addEventListener('click', () => updateSubmission(button.dataset.submissionId)));
}

async function loadSubmissions() {
  try { const status = $('#submission-status-filter')?.value || ''; const response = await api(`/api/cms/submissions${status ? `?status=${encodeURIComponent(status)}` : ''}`); state.submissions = response.submissions; renderSubmissions(state.submissions); } catch { notify('No se pudieron cargar las solicitudes.', 'error'); }
}

async function updateSubmission(id) {
  const status = $(`.submission-status-select[data-submission-id="${CSS.escape(id)}"]`)?.value || 'new';
  try { await api(`/api/cms/submissions/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status } }); notify('Solicitud actualizada.'); await loadSubmissions(); } catch (error) { notify(`No se actualizó la solicitud: ${error.message}`, 'error'); }
}

function fillSettings(settings) {
  state.settings = settings;
  const set = (id, value) => { const element = $(`#${id}`); if (element) element.value = value ?? ''; };
  const check = (id, value) => { const element = $(`#${id}`); if (element) element.checked = Boolean(value); };
  set('setting-site-name', settings.siteName);
  set('setting-site-description', settings.siteDescription);
  set('setting-canonical', settings.canonicalBaseUrl);
  check('setting-indexing', settings.indexingEnabled);
  set('setting-search-console', settings.searchConsoleVerification);
  check('setting-analytics-enabled', settings.analytics?.enabled);
  set('setting-measurement', settings.analytics?.measurementId);
  set('setting-cookie-title', settings.cookie?.title);
  set('setting-cookie-text', settings.cookie?.text);
  set('setting-cookie-version', settings.cookie?.version);
  set('setting-cookie-policy', settings.cookie?.policyUrl);
  set('setting-cookie-accept', settings.cookie?.acceptLabel);
  set('setting-cookie-reject', settings.cookie?.rejectLabel);
  set('setting-geo-name', settings.geo?.businessName);
  set('setting-geo-email', settings.geo?.email);
  set('setting-geo-phone', settings.geo?.phone);
  set('setting-geo-street', settings.geo?.street);
  set('setting-geo-locality', settings.geo?.locality);
  set('setting-geo-region', settings.geo?.region);
  set('setting-geo-country', settings.geo?.country);
  set('setting-geo-lat', settings.geo?.latitude);
  set('setting-geo-lng', settings.geo?.longitude);
  set('setting-navigation-hidden', Object.entries(settings.navigation?.visibility || {}).filter(([, visible]) => visible === false).map(([key]) => key).join('\n'));
}

function readSettingsForm() {
  const value = (id) => $(`#${id}`)?.value || '';
  const checked = (id) => Boolean($(`#${id}`)?.checked);
  const visibility = {};
  value('setting-navigation-hidden').split('\n').map((line) => line.trim()).filter(Boolean).forEach((key) => { visibility[key] = false; });
  return {
    siteName: value('setting-site-name'),
    siteDescription: value('setting-site-description'),
    canonicalBaseUrl: value('setting-canonical'),
    indexingEnabled: checked('setting-indexing'),
    searchConsoleVerification: value('setting-search-console'),
    analytics: { enabled: checked('setting-analytics-enabled'), measurementId: value('setting-measurement') },
    cookie: {
      title: value('setting-cookie-title'), text: value('setting-cookie-text'), version: value('setting-cookie-version'),
      policyUrl: value('setting-cookie-policy'), acceptLabel: value('setting-cookie-accept'), rejectLabel: value('setting-cookie-reject')
    },
    geo: {
      businessName: value('setting-geo-name'), email: value('setting-geo-email'), phone: value('setting-geo-phone'), street: value('setting-geo-street'),
      locality: value('setting-geo-locality'), region: value('setting-geo-region'), country: value('setting-geo-country'), latitude: value('setting-geo-lat'), longitude: value('setting-geo-lng')
    },
    navigation: { visibility }
  };
}

async function loadSettings() {
  if (state.user?.role !== 'owner') return;
  try { const response = await api('/api/cms/settings'); fillSettings(response.settings); } catch { notify('No se pudieron cargar los ajustes.', 'error'); }
}

async function saveSettings() {
  if (state.user?.role !== 'owner') return notify('Sólo el propietario puede cambiar los ajustes.', 'error');
  try { const response = await api('/api/cms/settings', { method: 'PUT', body: readSettingsForm() }); fillSettings(response.settings); notify('Ajustes guardados y conectados al sitio.'); } catch (error) { notify(`No se guardaron los ajustes: ${error.message}`, 'error'); }
}

function renderUsers() {
  const list = $('#users-list');
  if (!state.users.length) { list.innerHTML = '<div class="empty-state"><span>No hay usuarios registrados.</span></div>'; return; }
  const owners = state.users.filter((candidate) => candidate.role === 'owner' && !candidate.banned).length;
  list.innerHTML = state.users.map((user) => {
    const access = user.pending ? 'Google · invitación pendiente' : user.provider === 'google' ? 'Google' : 'Correo y contraseña';
    return `<div class="user-row"><div class="user-identity"><strong>${escapeHtml(user.name || user.email)}</strong><small>${escapeHtml(user.email)} · ${escapeHtml(access)} · alta ${escapeHtml(formatDate(user.createdAt))}</small></div><div class="user-controls"><select class="user-role" data-user-id="${escapeHtml(user.id)}" ${user.role === 'owner' && owners === 1 ? 'data-last-owner="true"' : ''}><option value="owner" ${user.role === 'owner' ? 'selected' : ''}>Propietario</option><option value="editor" ${user.role === 'editor' ? 'selected' : ''}>Editor</option><option value="viewer" ${user.role === 'viewer' ? 'selected' : ''}>Visualizador</option></select><button type="button" class="mini-button user-status" data-user-id="${escapeHtml(user.id)}" data-disabled="${user.banned ? 'false' : 'true'}" ${user.role === 'owner' ? 'disabled' : ''}>${user.banned ? 'Activar' : 'Revocar'}</button></div></div>`;
  }).join('');
  $$('.user-role', list).forEach((select) => select.addEventListener('change', () => updateUserRole(select.dataset.userId, select.value, select)));
  $$('.user-status', list).forEach((button) => button.addEventListener('click', () => updateUserStatus(button.dataset.userId, button.dataset.disabled === 'true')));
}

async function loadUsers() {
  if (state.user?.role !== 'owner') return;
  try { const response = await api('/api/cms/users'); state.users = response.users; renderUsers(); } catch { notify('No se pudieron cargar los usuarios.', 'error'); }
}

async function updateUserRole(id, role, select) {
  try { await api(`/api/cms/users/${encodeURIComponent(id)}/role`, { method: 'PATCH', body: { role } }); notify('Rol actualizado.'); await loadUsers(); if (id === state.user.id) { state.user.role = role; showApp(); } } catch (error) { select.value = state.users.find((user) => user.id === id)?.role || 'viewer'; notify(`No se actualizó el rol: ${error.message}`, 'error'); }
}

async function updateUserStatus(id, disabled) {
  try { await api(`/api/cms/users/${encodeURIComponent(id)}/status`, { method: 'POST', body: { disabled } }); notify(disabled ? 'Acceso revocado.' : 'Acceso activado.'); await loadUsers(); } catch (error) { notify(`No se actualizó el acceso: ${error.message}`, 'error'); }
}

async function uploadMedia(file) {
  const form = new FormData(); form.append('file', file); form.append('folder', $('#media-upload-folder')?.value || 'General'); form.append('alt', $('#media-upload-alt')?.value || ''); form.append('caption', $('#media-upload-caption')?.value || '');
  try { await api('/api/cms/media', { method: 'POST', body: form }); notify('Archivo guardado en la biblioteca.'); await loadMedia(); } catch (error) { notify(`No se pudo subir: ${error.message}`, 'error'); }
}

async function boot() {
  $('#auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('#auth-error').hidden = true;
    const body = { email: $('#auth-email').value, password: $('#auth-password').value };
    try {
      await authRequest(state.setup ? '/api/auth/sign-up/email' : '/api/auth/sign-in/email', { ...body, ...(state.setup ? { name: 'Administrador del CMS' } : {}) });
      const session = await api('/api/cms/auth-state');
      state.user = session.user; state.csrf = session.csrf; showApp();
    } catch (error) { $('#auth-error').textContent = error.message === 'INVALID_EMAIL_OR_PASSWORD' || error.message === 'CREDENTIALS_INVALID' ? 'Email o contraseña incorrectos.' : `No se pudo completar el acceso: ${error.message}`; $('#auth-error').hidden = false; }
  });
  $('#google-login').addEventListener('click', signInWithGoogle);
  $('#logout-button').addEventListener('click', async () => { try { await api('/api/auth/sign-out', { method: 'POST', body: {} }); } finally { state.user = null; state.csrf = null; showAuth(false); } });
  $('#publish-button').addEventListener('click', publish);
  $('#home-publish').addEventListener('click', publish);
  $('#home-search').addEventListener('input', filterHomeFields);
  $('#home-kind').addEventListener('change', filterHomeFields);
  $('#home-refresh').addEventListener('click', loadHome);
  $('#save-settings').addEventListener('click', saveSettings);
  $('#settings-form').addEventListener('submit', (event) => { event.preventDefault(); saveSettings(); });
  $('#refresh-users').addEventListener('click', loadUsers);
  $('#user-auth-method').addEventListener('change', () => {
    const google = $('#user-auth-method').value === 'google';
    $('#user-password-field').hidden = google;
    $('#user-password').required = !google;
    $('#user-google-help').hidden = !google;
  });
  $('#submission-status-filter').addEventListener('change', loadSubmissions);
  $('#user-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const authMethod = $('#user-auth-method').value;
      await api('/api/cms/users', { method: 'POST', body: { name: $('#user-name').value, email: $('#user-email').value, authMethod, password: authMethod === 'google' ? undefined : $('#user-password').value, role: $('#user-role').value } });
      event.target.reset();
      $('#user-auth-method').dispatchEvent(new Event('change'));
      notify('Usuario creado.');
      await loadUsers();
    } catch (error) { notify(`No se creó el usuario: ${error.message}`, 'error'); }
  });
  $('#refresh-inventory').addEventListener('click', async () => { try { await api('/api/cms/inventory/refresh', { method: 'POST', body: {} }); notify('Inventario actualizado.'); state.selectedPage = null; await loadPages(); } catch (error) { notify(`No se actualizó el inventario: ${error.message}`, 'error'); } });
  $('#media-upload').addEventListener('change', (event) => { const file = event.target.files?.[0]; if (file) uploadMedia(file); event.target.value = ''; });
  $('#media-search').addEventListener('input', () => loadMedia());
  document.addEventListener('click', (event) => { const target = event.target.closest('[data-view]'); if (target) navigate(target.dataset.view); });
  try {
    const authOptions = await fetch('/api/cms/auth-options', { credentials: 'include' }).then((response) => response.ok ? response.json() : ({}));
    state.googleEnabled = Boolean(authOptions.google);
    const me = await api('/api/cms/auth-state');
    if (!me.authenticated) { showAuth(me.setupRequired); return; }
    state.user = me.user; state.csrf = me.csrf; showApp();
  } catch (error) {
    if (error.code === 'OWNER_EMAIL_REQUIRED') {
      showAuth(true);
      $('#auth-error').textContent = 'La cuenta no tiene permisos para crear el acceso inicial.';
      $('#auth-error').hidden = false;
      return;
    }
    throw error;
  }
}

boot().catch(() => showAuth(false));

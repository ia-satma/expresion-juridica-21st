(() => {
  const view = document.getElementById('settings-view');
  if (!view) return;
  const panel = document.createElement('section');
  panel.className = 'panel seo-audit-panel';
  panel.innerHTML = '<div class="panel-heading"><div><p class="eyebrow">Comprobación del sitio</p><h2>Estado de SEO y GEO</h2><p class="settings-help">Revisa la configuración que está utilizando el sitio publicado.</p></div><button type="button" class="button button-secondary" data-seo-refresh>Comprobar ahora</button></div><div class="seo-audit-content"><p role="status" data-seo-status>Abre este apartado para comprobar el estado.</p><dl class="seo-audit-results"></dl><div class="seo-audit-links"></div><p class="settings-help">La indexación y las apariciones en buscadores y respuestas de IA dependen de cada proveedor. Después de guardar ajustes, comprueba de nuevo su estado.</p></div>';
  view.querySelector('.view-heading')?.after(panel);
  const status = panel.querySelector('[data-seo-status]'), results = panel.querySelector('dl'), links = panel.querySelector('.seo-audit-links'), button = panel.querySelector('button');
  let loading = false, loaded = false;
  function result(label, value, good = true) {
    const item = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
    item.className = good ? 'seo-check-ready' : 'seo-check-pending';
    dt.textContent = label; dd.textContent = value; item.append(dt, dd); results.append(item);
  }
  async function check() {
    if (loading) return;
    loading = true; button.disabled = true; status.textContent = 'Comprobando el sitio…';
    try {
      const response = await fetch('/api/cms/seo-audit', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error(response.status === 401 ? 'Inicia sesión para comprobar la configuración.' : 'No se pudo completar la comprobación. Vuelve a intentarlo.');
      const data = await response.json(); results.replaceChildren(); links.replaceChildren();
      result('Indexación', data.indexingEnabled ? 'Permitida en las páginas públicas' : 'Bloqueada', data.indexingEnabled);
      result('Mapa del sitio', `${data.indexablePages} páginas canónicas`);
      result('URL principal', data.canonicalBaseUrl);
      result('Identidad y ubicación', data.locationComplete ? 'Datos completos para los buscadores' : 'Completa el domicilio, ciudad, estado y país', data.locationComplete);
      result('Correo institucional', data.email);
      result('Carga de texto', 'Compresión Brotli y gzip habilitada');
      result('Datos estructurados', 'Firma, sitio, páginas, servicios y artículos');
      result('Search Console', data.searchConsoleConfigured ? 'Código de verificación configurado' : 'Pendiente de configurar en Google', data.searchConsoleConfigured);
      for (const [key, label] of [['robots', 'Reglas de rastreo'], ['sitemap', 'Mapa XML'], ['aiGuide', 'Guía pública para IA']]) {
        const link = document.createElement('a'); link.textContent = label; link.href = data.links[key]; link.target = '_blank'; link.rel = 'noopener'; links.append(link);
      }
      loaded = true; status.textContent = `Última comprobación: ${new Date(data.checkedAt).toLocaleString('es-MX')}`;
    } catch (error) { status.textContent = error.message; }
    finally { loading = false; button.disabled = false; }
  }
  button.addEventListener('click', check);
  new MutationObserver(() => { if (!view.hidden) check(); }).observe(view, { attributes: true, attributeFilter: ['hidden'] });
  if (!view.hidden && !loaded) check();
})();

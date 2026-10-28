(() => {
  const preview = new URLSearchParams(window.location.search).get('cms_preview') === '1';
  const path = `${window.location.pathname.endsWith('/') ? window.location.pathname : `${window.location.pathname}/`}`;
  fetch(`/api/cms/public?path=${encodeURIComponent(path)}&preview=${preview ? '1' : '0'}`, { credentials: 'include' })
    .then((response) => response.ok ? response.json() : null)
    .then((payload) => {
      if (!payload?.overrides) return;
      for (const [id, value] of Object.entries(payload.overrides)) {
        const element = document.querySelector(`[data-cms-key="${CSS.escape(id)}"]`);
        if (!element) continue;
        const attribute = element.getAttribute('data-cms-attr') || 'html';
        if (attribute === 'html') element.innerHTML = value;
        else if (attribute === 'text') element.textContent = value;
        else element.setAttribute(attribute, value);
      }
      document.documentElement.dataset.cmsReady = 'true';
    })
    .catch(() => {
      // The export remains fully usable when the CMS is unavailable: its static values are fallback.
    });
})();

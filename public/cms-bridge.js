(() => {
  const composeMail = document.currentScript?.dataset.cmsOpenMail !== 'false';
  const preview = new URLSearchParams(window.location.search).get('cms_preview') === '1';
  const path = `${window.location.pathname.endsWith('/') ? window.location.pathname : `${window.location.pathname}/`}`;
  const consentName = (version) => `cms_cookie_consent_${String(version || '1.0').replace(/[^a-z0-9]/gi, '_')}`;

  function readCookie(name) {
    const prefix = `${name}=`;
    return document.cookie.split(';').map((item) => item.trim()).find((item) => item.startsWith(prefix))?.slice(prefix.length) || '';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
  }

  function writeCookie(name, value) {
    document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=31536000; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  }

  function safeUrl(value) {
    const raw = String(value || '').trim();
    try {
      const parsed = new URL(raw, window.location.origin);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
    } catch {
      // Keep the static fallback when an invalid URL is supplied from settings.
    }
    return '#';
  }

  function applyOverrides(overrides, bindings = {}) {
    for (const [id, value] of Object.entries(overrides || {})) {
      const binding = bindings[id];
      const element = document.querySelector(`[data-cms-key="${CSS.escape(id)}"]`) || (binding?.selector ? document.querySelector(binding.selector) : null);
      if (!element) continue;
      if (element.closest('form[data-cms-submitting="true"],form[data-cms-sent="true"]') && element.matches('button[type="submit"],[role="status"]')) continue;
      const attribute = binding?.attribute || element.getAttribute('data-cms-attr') || 'html';
      if (attribute === 'html') { const template=document.createElement('template');template.innerHTML=value;if(element.innerHTML!==template.innerHTML) element.innerHTML=template.innerHTML; }
      else if (attribute === 'text') {
        const textNode = Array.from(element.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        if (textNode) textNode.textContent = value;
        else element.textContent = value;
      } else {
        const next=attribute === 'href' || attribute === 'src' || attribute === 'poster' ? (/^(?:mailto:|tel:)/i.test(value)&&attribute==='href'?value:safeUrl(value)) : value;
        if(element.getAttribute(attribute)!==next) element.setAttribute(attribute,next);
      }
    }
  }

  function applyNavigation(settings) {
    const visibility = settings?.navigation?.visibility || {};
    document.querySelectorAll('[data-cms-menu-key]').forEach((element) => {
      const key = element.getAttribute('data-cms-menu-key');
      if (Object.prototype.hasOwnProperty.call(visibility, key)) element.hidden = visibility[key] === false;
    });
  }

  function loadAnalytics(settings) {
    const measurementId = String(settings?.analytics?.measurementId || '').trim();
    if (!settings?.analytics?.enabled || !/^G-[A-Za-z0-9_-]+$/.test(measurementId) || document.querySelector(`script[data-cms-ga="${measurementId}"]`)) return;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', measurementId, { anonymize_ip: true });
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    script.dataset.cmsGa = measurementId;
    document.head.appendChild(script);
  }

  function showCookieBanner(settings) {
    const cookie = settings?.cookie || {};
    const name = consentName(cookie.version);
    const current = readCookie(name);
    if (current || document.getElementById('cms-cookie-banner')) {
      if (current === 'granted') loadAnalytics(settings);
      return;
    }
    const banner = document.createElement('div');
    banner.id = 'cms-cookie-banner';
    banner.setAttribute('role', 'region');
    const title = cookie.title || 'Privacidad y cookies';
    const text = cookie.text || '';
    const privacyUrl = safeUrl(cookie.privacyUrl || '/aviso-de-privacidad/');
    const policyUrl = safeUrl(cookie.policyUrl || '/politica-de-cookies/');
    const rejectLabel = cookie.rejectLabel || 'Rechazar analítica';
    const acceptLabel = cookie.acceptLabel || 'Aceptar analítica';
    banner.setAttribute('aria-label', title);
    banner.innerHTML = `<div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)} Consulta el <a href="${escapeHtml(privacyUrl)}">aviso de privacidad</a> y la <a href="${escapeHtml(policyUrl)}">política de cookies</a>.</p></div><div class="cms-cookie-actions"><button type="button" data-cms-cookie="reject">${escapeHtml(rejectLabel)}</button><button type="button" data-cms-cookie="accept">${escapeHtml(acceptLabel)}</button></div>`;
    const style = document.createElement('style');
    style.dataset.cmsCookieStyle = 'true';
    style.textContent = '#cms-cookie-banner{position:fixed;z-index:1000;left:1rem;right:1rem;bottom:1rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;max-width:1080px;margin:auto;padding:1rem 1.2rem;background:#0c112b;color:#f0ede7;border:1px solid rgba(201,169,110,.65);box-shadow:0 16px 40px rgba(0,0,0,.22);font:14px/1.45 Manrope,system-ui,sans-serif}#cms-cookie-banner strong{display:block;color:#c9a96e;font-size:12px;letter-spacing:.08em;text-transform:uppercase}#cms-cookie-banner p{margin:.25rem 0 0;color:rgba(240,237,231,.82)}#cms-cookie-banner a{color:#c9a96e;text-decoration:underline;text-underline-offset:3px}.cms-cookie-actions{display:flex;gap:.55rem;flex-shrink:0}.cms-cookie-actions button{border:1px solid rgba(201,169,110,.7);padding:.6rem .8rem;background:transparent;color:#f0ede7;font:600 12px Manrope,system-ui,sans-serif;cursor:pointer}.cms-cookie-actions button[data-cms-cookie="accept"]{background:#c9a96e;color:#0c112b}@media(max-width:650px){#cms-cookie-banner{display:block;bottom:.5rem;padding:1rem}.cms-cookie-actions{margin-top:.8rem}.cms-cookie-actions button{width:50%}}';
    document.head.appendChild(style);
    document.body.appendChild(banner);
    banner.querySelectorAll('[data-cms-cookie]').forEach((button) => button.addEventListener('click', () => {
      const value = button.dataset.cmsCookie === 'accept' ? 'granted' : 'denied';
      writeCookie(name, value);
      banner.remove();
      if (value === 'granted') loadAnalytics(settings);
    }));
  }

  function bindCmsForms() {
    document.querySelectorAll('form#consulta, form[data-cms-form="contact"]').forEach(form => {
      if (form.dataset.cmsBound === 'true') return;
      form.dataset.cmsBound='true';
      form.addEventListener('submit',async event=>{
        event.preventDefault();event.stopImmediatePropagation();
        if(form.dataset.cmsSubmitting==='true')return;
        let status=form.querySelector('[data-cms-contact-status]');
        if(!status){status=document.createElement('p');status.dataset.cmsContactStatus='true';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.className='text-sm leading-relaxed';form.appendChild(status);}
        const privacy=form.querySelector('#privacidad');
        if(!form.checkValidity()||privacy&&!privacy.checked){form.reportValidity();status.textContent='Completa los campos y confirma el aviso de privacidad.';return;}
        const payload=Object.fromEntries(new FormData(form).entries());
        payload.privacidad=Boolean(privacy?.checked);payload.source=location.pathname;
        form.dataset.cmsRequestKey ||= crypto.randomUUID();payload.requestKey=form.dataset.cmsRequestKey;
        const submit=form.querySelector('button[type="submit"]');
        form.dataset.cmsSubmitting='true';form.dataset.cmsSent='false';
        if(submit)submit.disabled=true;status.textContent='Guardando tu solicitud…';
        try {
          const response=await fetch('/api/public/contact',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
          const result=await response.json().catch(()=>({}));
          if(!response.ok||!result.ok)throw new Error('CONTACT_SEND_FAILED');
          const recipient=/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$/.test(result.contactEmail||'')?result.contactEmail:'Consultoria@expresionjuridica.com';
          const subject=`Consulta: ${payload.materia}`;
          const body=`Nombre: ${payload.nombre}\nCorreo: ${payload.correo}\nÁrea: ${payload.materia}\n\n${payload.mensaje}`;
          const mailto=`mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
          form.dataset.cmsSent='true';form.reset();delete form.dataset.cmsRequestKey;
          status.textContent='Tu solicitud quedó guardada. Completa el envío en tu aplicación de correo. ';
          const link=document.createElement('a');link.href=mailto;link.textContent='Abrir correo';link.style.textDecoration='underline';status.appendChild(link);
          if(composeMail&&form.dataset.cmsOpenMail!=='false'){try{window.location.assign(mailto);}catch{/* The visible link remains available if the browser blocks the mail app. */}}
        }catch{status.textContent='No pudimos guardar tu solicitud. Tu información sigue aquí; inténtalo de nuevo.';}
        finally{form.dataset.cmsSubmitting='false';if(submit)submit.disabled=false;}
      });
    });
  }

  // Bind immediately and after hydration; saving does not depend on Analytics or the CMS read request.
  let synchronizeOverrides=()=>{};
  bindCmsForms();
  new MutationObserver(()=>{bindCmsForms();synchronizeOverrides();}).observe(document.body,{childList:true,characterData:true,subtree:true});

  fetch(`/api/cms/public?path=${encodeURIComponent(path)}&preview=${preview ? '1' : '0'}`, { credentials: 'include' })
    .then((response) => response.ok ? response.json() : null)
    .then((payload) => {
      if (!payload) return;
      const overrides=payload.renderedOverrides || payload.overrides;
      applyOverrides(overrides,payload.bindings);
      applyNavigation(payload.settings);
      const consent = readCookie(consentName(payload.settings?.cookie?.version));
      if (consent === 'granted') loadAnalytics(payload.settings);
      showCookieBanner(payload.settings);
      bindCmsForms();
      setTimeout(bindCmsForms, 0);
      let queued=false;
      synchronizeOverrides=()=>{if(!queued){queued=true;requestAnimationFrame(()=>{queued=false;applyOverrides(overrides,payload.bindings);});}};
      document.documentElement.dataset.cmsReady = 'true';
    })
    .catch(() => {
      // The export remains fully usable when the CMS is unavailable: its static values are fallback.
    });
})();

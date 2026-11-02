export function currentCmsCsrf(cookieHeader, fallback = '') {
  const value = String(cookieHeader || '').match(/(?:^|;\s*)cms_csrf=([^;]+)/)?.[1];
  if (!value) return fallback;
  try { return decodeURIComponent(value); } catch { return fallback; }
}

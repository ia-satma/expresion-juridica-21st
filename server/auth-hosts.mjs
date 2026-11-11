const DEFAULT_AUTH_HOSTS = [
  'expresionjuridica.com',
  'www.expresionjuridica.com',
  'expresion-juridica-mx.replit.app',
  'expresion-juridica-21-st.replit.app'
];

function hostFromValue(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    const parsed = new URL(text.includes('://') ? text : `https://${text}`);
    return parsed.host.toLowerCase();
  } catch {
    return text.replace(/^[a-z]+:\/\//i, '').split('/')[0].toLowerCase() || null;
  }
}

function configuredValues(env) {
  return [
    ...DEFAULT_AUTH_HOSTS,
    env.CMS_AUTH_ALLOWED_HOSTS,
    env.BETTER_AUTH_ALLOWED_HOSTS,
    env.BETTER_AUTH_URL,
    env.REPLIT_DEPLOYMENT_URL,
    env.REPLIT_DEV_DOMAIN ? `https://${env.REPLIT_DEV_DOMAIN}` : null,
    ...(env.NODE_ENV === 'production' ? [] : ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000'])
  ].flatMap(value => String(value || '').split(','));
}

export function authAllowedHosts(env = process.env) {
  return [...new Set(configuredValues(env).map(hostFromValue).filter(Boolean))];
}

export function authAllowedOrigins(env = process.env) {
  return authAllowedHosts(env).flatMap(host => {
    const origins = [`https://${host}`];
    if (/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host)) origins.push(`http://${host}`);
    return origins;
  });
}

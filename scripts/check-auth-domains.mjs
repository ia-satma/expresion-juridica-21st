import assert from 'node:assert/strict';
import { resolveDynamicBaseURL } from 'better-auth';
import { authAllowedHosts, authAllowedOrigins } from '../server/auth-hosts.mjs';

const env = {
  NODE_ENV: 'production',
  BETTER_AUTH_URL: 'https://expresion-juridica-mx.replit.app',
  CMS_AUTH_ALLOWED_HOSTS: 'cliente.example,https://www.cliente.example'
};
const hosts = authAllowedHosts(env);
assert(hosts.includes('expresionjuridica.com'));
assert(hosts.includes('www.expresionjuridica.com'));
assert(hosts.includes('cliente.example'));
assert(!hosts.includes('evil.example'));

const config = { allowedHosts: hosts, protocol: 'https' };
for (const host of ['expresionjuridica.com', 'www.expresionjuridica.com', 'expresion-juridica-mx.replit.app', 'cliente.example']) {
  assert.equal(resolveDynamicBaseURL(config, new Request(`https://${host}/api/auth/sign-in/email`), '/api/auth'), `https://${host}/api/auth`);
}
assert.throws(() => resolveDynamicBaseURL(config, new Request('https://evil.example/api/auth/sign-in/email'), '/api/auth'), /not in the allowed hosts list/);

const origins = authAllowedOrigins(env);
assert(origins.includes('https://expresionjuridica.com'));
assert(origins.includes('https://cliente.example'));
console.log(JSON.stringify({ passed: true, customHosts: 4, unknownHostsRejected: true, dynamicOrigins: origins.length }));

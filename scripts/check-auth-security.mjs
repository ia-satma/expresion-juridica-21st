import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const root = process.cwd(), temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ej-auth-security-'));
// An isolated cwd prevents legacy-data migration from touching any real store.
for (const folder of ['sitio', 'public', 'server', 'firma-cms']) await fs.symlink(path.join(root, folder), path.join(temporary, folder), 'dir');
const reservation = net.createServer(); reservation.listen(0, '127.0.0.1'); await new Promise(resolve => reservation.once('listening', resolve));
const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`, email = 'security-fixture@invalid.test', password = `FixtureOnly-${crypto.randomUUID()}`, changedPassword = `ChangedFixture-${crypto.randomUUID()}`, authSecret = crypto.randomBytes(36).toString('base64url');
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LD_LIBRARY_PATH'].filter(name => process.env[name]).map(name => [name, process.env[name]]));
Object.assign(env, { NODE_ENV: 'production', PORT: String(port), CMS_DATA_SCOPE: 'isolated-security-check', CMS_OWNER_EMAIL: email, BETTER_AUTH_URL: base, BETTER_AUTH_SECRET: authSecret });
const child = spawn(process.execPath, [path.join(root, 'server/index.mjs')], { cwd: temporary, env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', data => logs += data); child.stderr.on('data', data => logs += data);
const cookies = new Map();
function collect(response) { for (const value of response.headers.getSetCookie()) { const pair = value.split(';')[0], at = pair.indexOf('='); cookies.set(pair.slice(0, at), pair.slice(at + 1)); } }
function cookieHeader() { return [...cookies].map(([name, value]) => `${name}=${value}`).join('; '); }
try {
  let online = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { online = (await fetch(base + '/healthz')).ok; } catch {}
    if (online || child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(online, 'Isolated server must start; raw logs intentionally withheld');
  const anonymous = await (await fetch(base + '/api/cms/auth-state')).json();
  assert.equal(anonymous.authenticated, false); assert(!anonymous.user); assert(!anonymous.csrf);
  for (const route of ['users', 'activity', 'settings', 'media', 'presentations', 'posts', 'documents', 'seo-audit', 'content', 'submissions']) {
    const response = await fetch(base + '/api/cms/' + route);
    assert.equal(response.status, 401, `Authentication required for ${route}`);
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
  const registered = await fetch(base + '/api/auth/sign-up/email', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ email, password, name: 'Security fixture' }) });
  assert.equal(registered.status, 200, 'Only the synthetic owner is registered in a temporary database'); collect(registered);
  const sessionCookies = registered.headers.getSetCookie().filter(value => /better-auth.*session_token=/.test(value));
  assert(sessionCookies.length); assert(sessionCookies.every(value => /;\s*Secure(?:;|$)/i.test(value) && /;\s*HttpOnly(?:;|$)/i.test(value) && /SameSite=Lax/i.test(value)));
  const authenticated = await fetch(base + '/api/cms/auth-state', { headers: { cookie: cookieHeader() } }); collect(authenticated);
  let state = await authenticated.json(); assert(state.authenticated); assert.equal(state.user.role, 'owner'); assert(state.csrf);
  const csrfCookie = authenticated.headers.getSetCookie().find(value => value.startsWith('cms_csrf='));
  assert(csrfCookie && /;\s*Secure(?:;|$)/i.test(csrfCookie) && !/HttpOnly/i.test(csrfCookie));
  const firstLoginChangeRequired = Boolean(state.user.mustChangePassword);
  if (firstLoginChangeRequired) {
    const changed = await fetch(base + '/api/cms/auth/change-password', { method: 'POST', headers: { cookie: cookieHeader(), origin: base, 'content-type': 'application/json', 'x-cms-csrf': decodeURIComponent(cookies.get('cms_csrf') || state.csrf) }, body: JSON.stringify({ currentPassword: password, newPassword: changedPassword }) });
    assert.equal(changed.status, 200, 'The temporary fixture must satisfy the first-login password policy'); collect(changed);
    const refreshed = await fetch(base + '/api/cms/auth-state', { headers: { cookie: cookieHeader() } }); collect(refreshed); state = await refreshed.json();
    assert.equal(state.user.mustChangePassword, false);
  }
  const settingsResponse = await fetch(base + '/api/cms/settings', { headers: { cookie: cookieHeader() } }); collect(settingsResponse);
  assert.equal(settingsResponse.status, 200, 'The isolated owner must be allowed to read settings after password policy checks');
  const settings = await settingsResponse.json();
  const saved = await fetch(base + '/api/cms/settings', { method: 'PUT', headers: { cookie: cookieHeader(), origin: base, 'content-type': 'application/json', 'x-cms-csrf': decodeURIComponent(cookies.get('cms_csrf') || state.csrf) }, body: JSON.stringify(settings.settings) }); collect(saved);
  assert.equal(saved.status, 200, 'Authenticated settings save must pass the deployment security controls');
  const withoutCsrf = await fetch(base + '/api/cms/settings', { method: 'PUT', headers: { cookie: cookieHeader(), origin: base, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(withoutCsrf.status, 403);
  const request = async (url, options = {}) => { const response=await fetch(base+url,{...options,headers:{cookie:cookieHeader(),origin:base,'content-type':'application/json',...(options.method?{'x-cms-csrf':decodeURIComponent(cookies.get('cms_csrf')||state.csrf)}:{}),...options.headers}});collect(response);return response; };
  const catalog=await (await request('/api/cms/content?page=%2Fareas%2Fadministrativo%2F')).json();
  const heading=catalog.fields.find(field=>field.label==='Título principal');assert(heading&&!heading.value.includes('<'));
  const editedText='Asesoría administrativa de prueba en México.';
  const contentSave=await request('/api/cms/content',{method:'POST',body:JSON.stringify({changes:[{id:heading.id,value:editedText}],confirmed:true})});assert.equal(contentSave.status,200);
  const preview=await (await request('/areas/administrativo/?cms_preview=1')).text();assert(preview.includes(editedText),'Authenticated preview includes the saved text');
  const beforePublish=await (await fetch(base+'/areas/administrativo/')).text();assert(beforePublish.includes(editedText),'Accept and save must be public without a separate publish step');
  const publicDraft=await (await request('/api/cms/public?path=%2Fareas%2Fadministrativo%2F&preview=1')).json();assert(publicDraft.bindings[heading.id]);assert(publicDraft.renderedOverrides[heading.id].includes('Asesoría'));
  // Confirmed content saves publish only the approved edits in the same transaction.
  assert.equal((await (await request('/api/cms/summary')).json()).draftFields,0);
  assert((await (await fetch(base+'/areas/administrativo/')).text()).includes(editedText));
  const contact={nombre:'Persona sintética de formulario',correo:'contact-fixture@invalid.test',materia:'Administrativo',mensaje:'Solicitud ficticia para comprobar que se conserva en el CMS.',privacidad:true,requestKey:crypto.randomUUID()};
  const sent=await request('/api/public/contact',{method:'POST',body:JSON.stringify(contact)});assert.equal(sent.status,201);const receipt=await sent.json();
  const submissions=await (await request('/api/cms/submissions')).json();assert(submissions.submissions.some(item=>item.id===receipt.id&&item.message===contact.mensaje));
  const storedContact=JSON.parse(await fs.readFile(path.join(temporary,'data','isolated-security-check','studio-state','submissions',receipt.id+'.json'),'utf8'));assert.equal(storedContact.message,contact.mensaje,'The CMS copy must also exist in persistent scoped storage');
  const secondRegistration = await fetch(base + '/api/auth/sign-up/email', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ email: 'second-fixture@invalid.test', password, name: 'Unused fixture' }) });
  assert.equal(secondRegistration.status, 403);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert(!logs.includes(email) && !logs.includes(password) && !logs.includes(changedPassword) && !logs.includes(authSecret)&&!logs.includes(contact.correo)&&!logs.includes(contact.nombre)&&!logs.includes(contact.mensaje), 'Runtime logs must not contain fixture credentials, identity or form content');
  console.log(JSON.stringify({ passed: true, isolatedAuthDatabase: true, anonymousIdentityHidden: true, privateRoutes: 10, registrationClosesAfterOwner: true, secureHttpOnlySession: true, secureCsrfCookie: true, firstLoginChangeRequired, authenticatedSettingsSave: true, authenticatedContentSave:true,confirmedContentImmediatelyPublic:true,contactCopyInPrivateCms:true,contactCopyPersisted:true,csrfEnforced: true, privateRuntimeLogs: true }));
} finally {
  child.kill('SIGTERM');
  if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
  await fs.rm(temporary, { recursive: true, force: true });
}

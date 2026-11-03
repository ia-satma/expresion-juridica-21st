import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import {spawn} from 'node:child_process';
import Database from 'better-sqlite3';
import express from 'express';
import {createUserSecurity,USER_SECURITY_POLICY} from '../server/user-security.mjs';

// Unit tests use only synthetic labels and an in-memory database with a controlled clock.
const unitDb=new Database(':memory:');unitDb.exec('CREATE TABLE session(id TEXT PRIMARY KEY,userId TEXT NOT NULL)');
const secret=crypto.randomBytes(36).toString('base64url'),unitNow={value:Date.now()},unitAuth={api:{getSession:async()=>null},handler:async()=>new Response('{}')};
const security=createUserSecurity({database:unitDb,auth:unitAuth,secret,clock:()=>unitNow.value});
const failed=(email,ip,verifiedIp=false)=>{const gate=security.beginLogin({email,ip,verifiedIp});assert(gate.allowed);return security.finishLogin(gate.ticket,401);};
failed('Window-Fixture@invalid.test','network-window');unitNow.value+=14*60000;
for(let i=0;i<4;i++)failed('window-fixture@invalid.test','network-window');
unitNow.value+=2*60000;
let gate=security.beginLogin({email:' WINDOW-FIXTURE@INVALID.TEST ',ip:'different-network'});assert.equal(gate.allowed,false);assert.equal(gate.scope,'account');assert.equal(gate.retryAfterSeconds,13*60);
const restarted=createUserSecurity({database:unitDb,auth:unitAuth,secret,clock:()=>unitNow.value});assert.equal(restarted.beginLogin({email:'window-fixture@invalid.test',ip:'other-network'}).allowed,false);
unitNow.value+=13*60000+1;gate=security.beginLogin({email:'window-fixture@invalid.test',ip:'other-network'});assert(gate.allowed);security.releaseLogin(gate.ticket);
const concurrent=Array.from({length:5},()=>security.beginLogin({email:'concurrent-fixture@invalid.test',ip:'network-concurrent'}));assert(concurrent.every(item=>item.allowed));assert.equal(security.beginLogin({email:'concurrent-fixture@invalid.test',ip:'network-concurrent'}).allowed,false);
security.finishLogin(concurrent[0].ticket,200);const next=security.beginLogin({email:'concurrent-fixture@invalid.test',ip:'network-concurrent'});assert(next.allowed);for(const item of [...concurrent.slice(1),next])security.releaseLogin(item.ticket);
for(let i=0;i<25;i++)failed(`network-fixture-${i}@invalid.test`,'network-quota',true);
gate=security.beginLogin({email:'unrelated-fixture@invalid.test',ip:'network-quota',verifiedIp:true});assert.equal(gate.allowed,false);assert.equal(gate.scope,'ip');
const sharedPending=Array.from({length:10},(_,index)=>security.beginLogin({email:`shared-fixture-${index}@invalid.test`,ip:'shared-transport'}));assert(sharedPending.every(item=>item.allowed));gate=security.beginLogin({email:'shared-eleventh@invalid.test',ip:'shared-transport'});assert.equal(gate.allowed,false);assert.equal(gate.scope,'transport');assert.equal(gate.retryAfterSeconds,10);for(const item of sharedPending)security.releaseLogin(item.ticket);
for(let i=0;i<100;i++)failed(`burst-fixture-${i}@invalid.test`,'burst-transport');gate=security.beginLogin({email:'burst-next@invalid.test',ip:'burst-transport'});assert.equal(gate.allowed,false);assert.equal(gate.retryAfterSeconds,10);unitNow.value+=60001;gate=security.beginLogin({email:'burst-next@invalid.test',ip:'burst-transport'});assert(gate.allowed);security.releaseLogin(gate.ticket);
const bucketDump=JSON.stringify(unitDb.prepare('SELECT * FROM cms_security_buckets').all());assert(!bucketDump.includes('invalid.test')&&!bucketDump.includes('network-')&&!bucketDump.includes(secret));
const session={user:{id:'synthetic-user'},session:{id:'synthetic-session',createdAt:new Date(unitNow.value-60000),expiresAt:new Date(unitNow.value+8*3600000)}};unitDb.prepare('INSERT INTO session(id,userId) VALUES(?,?)').run(session.session.id,session.user.id);
assert(security.validateSession(session).valid);const initial=security.sessionInfo(session).lastActivityAt;unitNow.value+=20*60000;assert(security.validateSession(session).valid);assert.equal(security.sessionInfo(session).lastActivityAt,initial,'Reads must not renew idle time');
assert(security.recordActivity(session).valid);const refreshed=security.sessionInfo(session).lastActivityAt;assert(refreshed>initial);unitNow.value+=30*60000+1;assert.equal(security.validateSession(session).valid,false);assert.equal(unitDb.prepare('SELECT COUNT(*) AS count FROM session').get().count,0);
const absoluteSession={user:{id:'absolute-user'},session:{id:'absolute-session',createdAt:new Date(unitNow.value-7.9*3600000),expiresAt:new Date(unitNow.value+8*3600000)}};unitDb.prepare('INSERT INTO session(id,userId) VALUES(?,?)').run(absoluteSession.session.id,absoluteSession.user.id);assert(security.validateSession(absoluteSession).valid);unitNow.value+=7*60000;assert.equal(security.validateSession(absoluteSession).reason,'SESSION_EXPIRED');
const missingDates={user:{id:'missing-user'},session:{id:'missing-session'}};unitDb.prepare('INSERT INTO session(id,userId) VALUES(?,?)').run(missingDates.session.id,missingDates.user.id);const cap=security.sessionInfo(missingDates).absoluteExpiresAt;unitNow.value+=3600000;assert.equal(security.sessionInfo(missingDates).absoluteExpiresAt,cap,'Missing upstream timestamps must not slide the persisted absolute cap');
unitDb.close();

// Optional durable snapshot hook runs without payloads, after provider mutations,
// and serializes overlapping persistence rather than delaying the HTTP response.
const snapshotDb=new Database(':memory:');snapshotDb.exec('CREATE TABLE session(id TEXT PRIMARY KEY,userId TEXT NOT NULL)');
let snapshotCalls=0,snapshotActive=0,snapshotMax=0,releaseSnapshot=null;const snapshots=[];
const snapshotAuth={api:{getSession:async()=>null},handler:async request=>{
  if(new URL(request.url).pathname.endsWith('/sign-out'))snapshotDb.prepare('DELETE FROM session').run();
  else snapshotDb.prepare('INSERT OR REPLACE INTO session(id,userId) VALUES(?,?)').run('provider-created-session','snapshot-user');
  return new Response('{}',{status:200,headers:{'content-type':'application/json'}});
}};
const snapshotGuard=createUserSecurity({database:snapshotDb,auth:snapshotAuth,secret,onMutation:async(...args)=>{
  assert.equal(args.length,0);snapshotCalls++;snapshotActive++;snapshotMax=Math.max(snapshotMax,snapshotActive);
  snapshots.push(snapshotDb.prepare('SELECT id FROM session').all().map(row=>row.id));
  if(releaseSnapshot===null)await new Promise(resolve=>{releaseSnapshot=resolve;});
  snapshotActive--;
}});
const snapshotApp=express();snapshotApp.all('/api/auth/*splat',snapshotGuard.authHandler);const snapshotServer=snapshotApp.listen(0,'127.0.0.1');await new Promise(resolve=>snapshotServer.once('listening',resolve));
const snapshotBase=`http://127.0.0.1:${snapshotServer.address().port}`,settleSnapshot=()=>new Promise(resolve=>setImmediate(resolve));
try{
  const reserve=snapshotGuard.beginLogin({email:'snapshot-fixture@invalid.test',ip:'snapshot-transport'});assert(reserve.allowed);snapshotGuard.releaseLogin(reserve.ticket);
  await settleSnapshot();assert.equal(snapshotCalls,1,'Synchronous guard writes share one snapshot');
  const response=await fetch(snapshotBase+'/api/auth/sign-in/email',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'snapshot-fixture@invalid.test',password:'SyntheticOnly'})});assert.equal(response.status,200,'An outstanding snapshot must not block authentication');
  assert.equal(snapshotCalls,1,'Persistence must not run concurrently');releaseSnapshot();await settleSnapshot();await settleSnapshot();
  assert(snapshots.some(ids=>ids.includes('provider-created-session')),'A snapshot must include the session created by Better Auth after beginLogin');assert.equal(snapshotMax,1);
  const callsAfterLogin=snapshotCalls;assert.equal((await fetch(snapshotBase+'/api/auth/sign-out',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,200);await settleSnapshot();
  assert(snapshotCalls>callsAfterLogin,'Sign-out provider mutation must request persistence');assert.deepEqual(snapshots.at(-1),[]);
  const pendingSnapshots=Array.from({length:5},()=>snapshotGuard.beginLogin({email:'snapshot-limit@invalid.test',ip:'snapshot-other-transport'}));assert(pendingSnapshots.every(item=>item.allowed));await settleSnapshot();
  const beforeBlocked=snapshotCalls;assert.equal(snapshotGuard.beginLogin({email:'snapshot-limit@invalid.test',ip:'snapshot-other-transport'}).allowed,false);snapshotGuard.finishLogin('missing-synthetic-ticket',401);await settleSnapshot();assert.equal(snapshotCalls,beforeBlocked,'A rejected login with no SQL mutation must not trigger another durable snapshot');for(const item of pendingSnapshots)snapshotGuard.releaseLogin(item.ticket);await settleSnapshot();
  const snapshotSession={user:{id:'snapshot-user'},session:{id:'metadata-session',createdAt:new Date(),expiresAt:new Date(Date.now()+8*3600000)}};snapshotDb.prepare('INSERT INTO session(id,userId) VALUES(?,?)').run(snapshotSession.session.id,snapshotSession.user.id);
  const beforeMetadata=snapshotCalls;snapshotGuard.sessionInfo(snapshotSession);await settleSnapshot();assert(snapshotCalls>beforeMetadata);const beforeRead=snapshotCalls;snapshotGuard.sessionInfo(snapshotSession);await settleSnapshot();assert.equal(snapshotCalls,beforeRead,'Read-only polling must not request another snapshot');
  snapshotGuard.recordActivity(snapshotSession);await settleSnapshot();const afterActivity=snapshotCalls;assert(afterActivity>beforeRead);snapshotGuard.revokeSession(snapshotSession);await settleSnapshot();assert(snapshotCalls>afterActivity);
}finally{await new Promise(resolve=>snapshotServer.close(resolve));await settleSnapshot();snapshotDb.close();}

// Full backend fixture: real Better Auth and SQLite, isolated cwd, no real account or live target.
const root=process.cwd(),temporary=await fs.mkdtemp(path.join(os.tmpdir(),'ej-user-security-'));
for(const folder of ['server','public','sitio','firma-cms'])await fs.symlink(path.join(root,folder),path.join(temporary,folder),'dir');
const reservation=net.createServer();reservation.listen(0,'127.0.0.1');await new Promise(resolve=>reservation.once('listening',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const base=`http://127.0.0.1:${port}`,email='user-security-owner@invalid.test',password='FixtureOnly-'+crypto.randomUUID(),newPassword='ChangedFixture-'+crypto.randomUUID(),authSecret=crypto.randomBytes(36).toString('base64url');
const env=Object.fromEntries(['PATH','HOME','TMPDIR','LANG','LD_LIBRARY_PATH'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
Object.assign(env,{NODE_ENV:'test',PORT:String(port),CMS_DATA_SCOPE:'isolated-user-security',CMS_OWNER_EMAIL:email,BETTER_AUTH_URL:base,BETTER_AUTH_SECRET:authSecret});
const child=spawn(process.execPath,[path.join(root,'server/index.mjs')],{cwd:temporary,env,stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);
const jarA=new Map(),jarB=new Map(),jarC=new Map(),jarEditor=new Map();
const cookieHeader=jar=>[...jar].map(([key,value])=>`${key}=${value}`).join('; ');
function collect(response,jar){for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}}
async function request(route,{jar=jarB,body,...options}={}){
  const response=await fetch(base+route,{...options,headers:{origin:base,cookie:cookieHeader(jar),'content-type':'application/json',...(options.method?{'x-cms-csrf':decodeURIComponent(jar.get('cms_csrf')||'')}:{}),...options.headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});collect(response,jar);return response;
}
let db;
try{
  let ready=false;for(let attempt=0;attempt<100;attempt++){try{ready=(await fetch(base+'/healthz')).ok;}catch{}if(ready||child.exitCode!==null)break;await new Promise(resolve=>setTimeout(resolve,100));}assert(ready,'Isolated backend failed to start; raw logs intentionally withheld');
  let response=await request('/api/auth/sign-up/email',{jar:jarA,method:'POST',body:{email,password,name:'Synthetic owner'}});assert.equal(response.status,200);
  response=await request('/api/auth/sign-in/email',{jar:new Map(),method:'POST',body:{email:'oversize-fixture@invalid.test',password:'x'.repeat(20000)}});assert.equal(response.status,400);assert.equal((await response.json()).error,'INVALID_EMAIL_OR_PASSWORD');
  response=await fetch(base+'/api/auth/sign-in/email',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:'{'});assert.equal(response.status,400);assert.equal((await response.json()).error,'INVALID_EMAIL_OR_PASSWORD');
  let state=await (await request('/api/cms/auth-state',{jar:jarA})).json();assert(state.authenticated);assert.equal(state.userSecurity.idleMinutes,30);assert.equal(state.sessionMaxAgeHours,8);
  response=await request('/api/auth/sign-in/email',{method:'POST',body:{email,password}});assert.equal(response.status,200,'Raw login JSON must reach Better Auth intact');state=await (await request('/api/cms/auth-state')).json();assert(state.authenticated);
  db=new Database(path.join(temporary,'data','isolated-user-security','auth.sqlite'));
  const current=await (await request('/api/auth/get-session')).json();assert(current.session.id);const sessionId=current.session.id;
  const keyB=crypto.createHmac('sha256',authSecret).update('session\0'+sessionId).digest('hex');
  const metadata=db.prepare('SELECT * FROM cms_security_sessions WHERE key=?').get(keyB);assert(metadata);
  db.prepare('UPDATE cms_security_sessions SET last_activity_at=? WHERE key=?').run(Date.now()-20*60000,metadata.key);
  const before=db.prepare('SELECT last_activity_at FROM cms_security_sessions WHERE key=?').get(metadata.key).last_activity_at;
  await request('/api/cms/auth/activity');assert.equal(db.prepare('SELECT last_activity_at FROM cms_security_sessions WHERE key=?').get(metadata.key).last_activity_at,before);
  response=await request('/api/cms/auth/activity',{method:'POST',headers:{'x-cms-csrf':''},body:{}});assert.equal(response.status,403);
  response=await request('/api/cms/auth/activity',{method:'POST',body:{}});assert.equal(response.status,200);assert((await response.json()).userSecurity.lastActivityAt>before);assert(db.prepare('SELECT last_activity_at FROM cms_security_sessions WHERE key=?').get(keyB).last_activity_at>before);
  response=await request('/api/cms/auth/change-password',{method:'POST',body:{currentPassword:password,newPassword}});assert.equal(response.status,200);
  assert.equal((await (await request('/api/cms/auth-state')).json()).authenticated,true,'Changing password must preserve the current signed cookie');assert.equal((await request('/api/cms/settings',{jar:jarA})).status,401,'Other signed sessions must be revoked');assert.equal(db.prepare('SELECT COUNT(*) AS count FROM session WHERE userId=?').get(state.user.id).count,1);
  response=await request('/api/auth/sign-in/email',{jar:jarC,method:'POST',body:{email,password:newPassword}});assert.equal(response.status,200);
  const stateC=await (await request('/api/cms/auth-state',{jar:jarC})).json();assert(stateC.authenticated);const sessionC=await (await request('/api/auth/get-session',{jar:jarC})).json();
  const keyC=crypto.createHmac('sha256',authSecret).update('session\0'+sessionC.session.id).digest('hex');db.prepare('UPDATE cms_security_sessions SET last_activity_at=? WHERE key=?').run(Date.now()-31*60000,keyC);
  assert.equal((await request('/api/cms/settings',{jar:jarC})).status,401);assert(!db.prepare('SELECT id FROM session WHERE id=?').get(sessionC.session.id),'Idle expiration must revoke the actual session row');
  const user=await (await request('/api/cms/users',{method:'POST',body:{email:'user-security-editor@invalid.test',name:'Synthetic editor',role:'editor'}})).json();assert(user.temporaryPassword);
  response=await request('/api/auth/sign-in/email',{jar:jarEditor,method:'POST',body:{email:'user-security-editor@invalid.test',password:user.temporaryPassword}});assert.equal(response.status,200);await request('/api/cms/auth-state',{jar:jarEditor});
  response=await request('/api/cms/auth/change-password',{jar:jarEditor,method:'POST',body:{currentPassword:user.temporaryPassword,newPassword:'EditorFixture-'+crypto.randomUUID()}});assert.equal(response.status,200);
  assert.equal((await request('/api/cms/users',{jar:jarEditor})).status,403);assert.equal((await request('/api/cms/summary',{jar:jarEditor})).status,200);assert.equal((await request('/api/cms/auth/activity',{jar:jarEditor,method:'POST',body:{}})).status,200);
  const beforeLogout=new Map(jarEditor);assert.equal((await request('/api/auth/sign-out',{jar:jarEditor,method:'POST',body:{}})).status,200);assert.equal((await request('/api/cms/summary',{jar:beforeLogout})).status,401);
  const failures=[];
  for(let i=0;i<5;i++){response=await request('/api/auth/sign-in/email',{jar:new Map(),method:'POST',body:{email,password:'InvalidFixture-'+i}});assert.equal(response.status,401);failures.push(await response.json());}
  assert(failures.every(item=>item.error==='INVALID_EMAIL_OR_PASSWORD'));response=await request('/api/auth/sign-in/email',{jar:new Map(),method:'POST',body:{email,password:newPassword}});assert.equal(response.status,429);assert(Number(response.headers.get('retry-after'))>0);
  response=await request('/api/auth/sign-in/email',{jar:new Map(),method:'POST',body:{email:'nonexistent-fixture@invalid.test',password:'InvalidFixture'}});assert.equal(response.status,401);assert.deepEqual(await response.json(),failures[0],'Unknown and known accounts receive the same credential response');
  assert.equal((await request('/api/cms/settings')).status,200,'Login throttling must not revoke an already active session');
  const row=db.prepare('SELECT createdAt FROM session WHERE id=?').get(sessionId);const old=Date.now()-9*3600000;db.prepare('UPDATE session SET createdAt=? WHERE id=?').run(typeof row.createdAt==='number'?old:new Date(old).toISOString(),sessionId);
  assert.equal((await request('/api/cms/settings')).status,401);assert(!db.prepare('SELECT id FROM session WHERE id=?').get(sessionId));
  assert(!logs.includes(email)&&!logs.includes(password)&&!logs.includes(newPassword)&&!logs.includes(authSecret)&&!logs.includes(user.temporaryPassword),'Runtime logs must not contain synthetic credentials or identity');
  console.log(JSON.stringify({passed:true,syntheticBackendOnly:true,rawBodyLogin:true,boundedMalformedLogin:true,genericResponses:true,accountFailures:USER_SECURITY_POLICY.accountFailures,verifiedIpFailures:USER_SECURITY_POLICY.ipFailures,transportFailures:100,transportWindowSeconds:60,transportConcurrency:10,transportRetrySeconds:10,lockMinutes:15,lateWindowLockPreserved:true,concurrentReservations:true,persistentHashedCounters:true,nonBlockingSnapshotHook:true,serializedSnapshots:true,postProviderSessionSnapshot:true,signOutSnapshot:true,readOnlyPollingWithoutSnapshot:true,idleMinutes:30,warningSeconds:120,pollingDoesNotRenew:true,activityCsrf:true,actualIdleRevocation:true,absoluteHours:8,immutableAbsoluteCap:true,passwordChangeKeepsCurrentAndRevokesOthers:true,logoutRevokesSession:true,ownerEditorPermissions:true,privateRuntimeLogs:true}));
}finally{db?.close();child.kill('SIGTERM');if(child.exitCode===null)await new Promise(resolve=>child.once('exit',resolve));await fs.rm(temporary,{recursive:true,force:true});}

import crypto from 'node:crypto';
import {isIP} from 'node:net';
import { toNodeHandler } from 'better-auth/node';
import { safeLog } from './security-logging.mjs';
import { createPostgresUserSecurity } from './user-security-postgres.mjs';

export const USER_SECURITY_POLICY=Object.freeze({idleMinutes:30,warningSeconds:120,absoluteHours:8,accountFailures:5,ipFailures:25,windowMinutes:15,lockMinutes:15,transportFailures:100,transportWindowSeconds:60,transportBackoffSeconds:10,transportConcurrency:10,activityIntervalSeconds:60});
const MINUTE=60000;
const failureBody={error:'INVALID_EMAIL_OR_PASSWORD',message:'Email o contraseña incorrectos.'};
function reply(status,body,headers){const result=new Headers(headers);result.set('content-type','application/json');result.set('cache-control','no-store');result.delete('content-length');return new Response(JSON.stringify(body),{status,headers:result});}

export function createUserSecurity({database,auth,secret,clock=Date.now,onAudit=()=>{},onMutation=()=>{},clientIpResolver=null,policy={}}){
  if(typeof secret!=='string'||secret.length<32)throw Error('USER_SECURITY_SECRET_REQUIRED');
  const settings={...USER_SECURITY_POLICY,...policy},windowMs=settings.windowMinutes*MINUTE,lockMs=settings.lockMinutes*MINUTE,idleMs=settings.idleMinutes*MINUTE,absoluteMs=settings.absoluteHours*60*MINUTE;
  // Snapshot adapters may be slow. Coalesce the current turn, serialize writes, and
  // schedule another snapshot if state changes while the previous one is saving.
  let mutationScheduled=false,mutationRunning=false,mutationAgain=false;
  function notifyMutation(){
    if(mutationRunning){mutationAgain=true;return;}
    if(mutationScheduled)return;
    mutationScheduled=true;
    queueMicrotask(()=>{
      mutationScheduled=false;mutationRunning=true;
      Promise.resolve().then(()=>onMutation()).catch(error=>safeLog('error','auth.persistence.failed',error)).finally(()=>{
        mutationRunning=false;if(mutationAgain){mutationAgain=false;notifyMutation();}
      });
    });
  }
  const digest=(kind,value)=>crypto.createHmac('sha256',secret).update(kind+'\0'+String(value||'unknown')).digest('hex');
  function audit(action,detail={}){
    try{Promise.resolve(onAudit(action,detail)).catch(error=>safeLog('error','auth.audit.failed',error));}catch(error){safeLog('error','auth.audit.failed',error);}
  }
  const loginLimits=(accountKey,networkKind,ipKey)=>[
    ['account',accountKey,settings.accountFailures],
    [networkKind,ipKey,networkKind==='ip'?settings.ipFailures:settings.transportFailures]
  ];
  function loginKeys({email,ip,verifiedIp=false}){
    const normalizedEmail=typeof email==='string'?email.trim().toLowerCase().slice(0,320):'';
    const networkKind=verifiedIp?'ip':'transport';
    return {networkKind,accountKey:digest('account',normalizedEmail||'invalid-input'),ipKey:digest(networkKind,ip)};
  }
  const retryAfter=(until,now)=>Math.max(1,Math.ceil((until-now)/1000));
  const loginLock=(kind,current,now)=>current?.locked_until>now
    ? {allowed:false,scope:kind,retryAfterSeconds:retryAfter(current.locked_until,now)}
    : null;
  function loginCapacity(kind,max,current,reserved,now){
    const concurrentMax=kind==='transport'?settings.transportConcurrency:max;
    if((current?.failures||0)+reserved.total<max&&reserved.total<concurrentMax)return null;
    return {allowed:false,scope:kind,retryAfterSeconds:kind==='transport'?settings.transportBackoffSeconds:retryAfter(reserved.until||now+1000,now)};
  }
  const loginObservation=kind=>kind==='transport'?settings.transportWindowSeconds*1000:windowMs;
  function loginFailure(kind,max,previous,now){
    const fresh=!previous||previous.first_at<=now-loginObservation(kind)&&previous.locked_until<=now;
    const failures=(fresh?0:previous.failures)+1,firstAt=fresh?now:previous.first_at;
    const lockedUntil=previous?.locked_until>now?previous.locked_until:failures>=max?now+(kind==='transport'?settings.transportBackoffSeconds*1000:lockMs):0;
    return {failures,firstAt,lockedUntil};
  }
  function sessionTiming(session,now){
    const created=Date.parse(session.session.createdAt),upstreamExpiry=Date.parse(session.session.expiresAt);
    const createdAt=Number.isFinite(created)?created:now;
    return {createdAt,absoluteExpiresAt:Math.min(createdAt+absoluteMs,Number.isFinite(upstreamExpiry)?upstreamExpiry:Infinity)};
  }
  function sessionStatus(row,now,absoluteExpiresAt){
    const boundedAbsolute=Math.min(row.absolute_expires_at,absoluteExpiresAt);
    return {serverNow:now,lastActivityAt:row.last_activity_at,idleExpiresAt:Math.min(row.last_activity_at+idleMs,boundedAbsolute),absoluteExpiresAt:boundedAbsolute,idleMinutes:settings.idleMinutes,warningSeconds:settings.warningSeconds,activityIntervalSeconds:settings.activityIntervalSeconds};
  }
  function sessionExpiration(session,info){
    const now=clock();
    return session.user.banned?'ACCESS_REVOKED':now>=info.absoluteExpiresAt?'SESSION_EXPIRED':now>=info.idleExpiresAt?'SESSION_IDLE_EXPIRED':null;
  }
  function auditExpiration(reason){
    audit(reason==='ACCESS_REVOKED'?'auth.session.revoked':'auth.session.expired',{reason:reason==='SESSION_IDLE_EXPIRED'?'idle':reason==='SESSION_EXPIRED'?'absolute':'revoked'});
  }
  const methods=typeof database.connect==='function'
    ? createPostgresUserSecurity({database,clock,digest,loginKeys,loginLimits,loginLock,loginCapacity,loginObservation,loginFailure,sessionTiming,sessionStatus,sessionExpiration,auditExpiration,absoluteMs})
    : createSqliteUserSecurity();
  const {beginLogin,finishLogin,releaseLogin,validateSession,sessionInfo,recordActivity}=methods;

  function createSqliteUserSecurity(){
    database.exec(`CREATE TABLE IF NOT EXISTS cms_security_buckets(kind TEXT NOT NULL,key TEXT NOT NULL,failures INTEGER NOT NULL,first_at INTEGER NOT NULL,last_at INTEGER NOT NULL,locked_until INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(kind,key));
      CREATE TABLE IF NOT EXISTS cms_security_attempts(id TEXT PRIMARY KEY,account_key TEXT NOT NULL,ip_key TEXT NOT NULL,network_kind TEXT NOT NULL DEFAULT 'transport',expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS cms_security_attempt_account ON cms_security_attempts(account_key,expires_at);
      CREATE INDEX IF NOT EXISTS cms_security_attempt_ip ON cms_security_attempts(ip_key,expires_at);
      CREATE TABLE IF NOT EXISTS cms_security_sessions(key TEXT PRIMARY KEY,created_at INTEGER NOT NULL,last_activity_at INTEGER NOT NULL,absolute_expires_at INTEGER NOT NULL);`);
    if(!database.prepare('PRAGMA table_info(cms_security_attempts)').all().some(column=>column.name==='network_kind'))database.exec("ALTER TABLE cms_security_attempts ADD COLUMN network_kind TEXT NOT NULL DEFAULT 'ip'");
    const bucket=database.prepare('SELECT * FROM cms_security_buckets WHERE kind=? AND key=?');
    const upsert=database.prepare('INSERT INTO cms_security_buckets(kind,key,failures,first_at,last_at,locked_until) VALUES(?,?,?,?,?,?) ON CONFLICT(kind,key) DO UPDATE SET failures=excluded.failures,first_at=excluded.first_at,last_at=excluded.last_at,locked_until=excluded.locked_until');
    const removeAccount=database.prepare("DELETE FROM cms_security_buckets WHERE kind='account' AND key=?");
    const pendingAccount=database.prepare('SELECT COUNT(*) AS total,MAX(expires_at) AS until FROM cms_security_attempts WHERE account_key=? AND expires_at>?');
    const pendingNetwork=database.prepare('SELECT COUNT(*) AS total,MAX(expires_at) AS until FROM cms_security_attempts WHERE network_kind=? AND ip_key=? AND expires_at>?');
    const getAttempt=database.prepare('SELECT * FROM cms_security_attempts WHERE id=?');
    const deleteAttempt=database.prepare('DELETE FROM cms_security_attempts WHERE id=?');
    const insertAttempt=database.prepare('INSERT INTO cms_security_attempts(id,account_key,ip_key,network_kind,expires_at) VALUES(?,?,?,?,?)');
    const totalChanges=database.prepare('SELECT total_changes() AS total');
    function notifyChanged(operation){const before=totalChanges.get().total,result=operation();if(totalChanges.get().total!==before)notifyMutation();return result;}
    function prune(now){
      database.prepare('DELETE FROM cms_security_attempts WHERE expires_at<=?').run(now);
      // A lock outlives the observation window when the fifth failure happens late.
      database.prepare("DELETE FROM cms_security_buckets WHERE locked_until<=? AND ((kind='transport' AND first_at<=?) OR (kind<>'transport' AND first_at<=?))").run(now,now-loginObservation('transport'),now-loginObservation('account'));
      database.prepare('DELETE FROM cms_security_sessions WHERE absolute_expires_at<=?').run(now-absoluteMs);
    }
    const beginTransaction=database.transaction(input=>{
      const now=clock();prune(now);
      const {networkKind,accountKey,ipKey}=loginKeys(input);
      for(const [kind,key,max] of loginLimits(accountKey,networkKind,ipKey)){
        const current=bucket.get(kind,key);
        const locked=loginLock(kind,current,now);if(locked)return locked;
        const reserved=kind==='account'?pendingAccount.get(key,now):pendingNetwork.get(kind,key,now);
        const limited=loginCapacity(kind,max,current,reserved,now);if(limited)return limited;
      }
      const id=crypto.randomUUID();insertAttempt.run(id,accountKey,ipKey,networkKind,now+90000);return {allowed:true,ticket:id};
    });
    const finishTransaction=database.transaction((ticket,status)=>{
      const current=getAttempt.get(ticket);if(!current)return {counted:false,blocked:false};
      deleteAttempt.run(ticket);const now=clock();
      if(status>=200&&status<300){removeAccount.run(current.account_key);return {counted:false,success:true,blocked:false};}
      if(![400,401,403,422].includes(status))return {counted:false,blocked:false};
      let blocked=false;
      const networkKind=current.network_kind||'ip';
      for(const [kind,key,max] of loginLimits(current.account_key,networkKind,current.ip_key)){
        const {failures,firstAt,lockedUntil}=loginFailure(kind,max,bucket.get(kind,key),now);
        upsert.run(kind,key,failures,firstAt,now,lockedUntil);blocked ||= lockedUntil>now;
      }
      return {counted:true,blocked};
    });
    const beginLogin=input=>notifyChanged(()=>beginTransaction.immediate(input));
    const finishLogin=(ticket,status)=>notifyChanged(()=>finishTransaction.immediate(ticket,status));
    const releaseLogin=ticket=>{const result=deleteAttempt.run(ticket);if(result.changes)notifyMutation();return result;};
    function forgetSession(session){if(session?.session?.id&&database.prepare('DELETE FROM cms_security_sessions WHERE key=?').run(digest('session',session.session.id)).changes)notifyMutation();}
    function revokeSession(session){
      if(!session?.session?.id)return;
      database.transaction(()=>{database.prepare('DELETE FROM "session" WHERE id=?').run(session.session.id);forgetSession(session);}).immediate();notifyMutation();
    }
    function revokeUserSessions(userId,{exceptId=null}={}){
      const ids=database.prepare('SELECT id FROM "session" WHERE userId=?').all(userId).filter(row=>row.id!==exceptId);
      database.transaction(()=>{for(const row of ids){database.prepare('DELETE FROM "session" WHERE id=?').run(row.id);database.prepare('DELETE FROM cms_security_sessions WHERE key=?').run(digest('session',row.id));}}).immediate();
      if(ids.length)notifyMutation();return ids.length;
    }
    function sessionInfo(session){
      if(!session?.session?.id)return null;
      const now=clock(),{createdAt,absoluteExpiresAt}=sessionTiming(session,now);
      const key=digest('session',session.session.id);
      // Existing active sessions receive their first idle window at rollout; the original absolute cap stays.
      const read=database.prepare('SELECT * FROM cms_security_sessions WHERE key=?');let row=read.get(key);
      if(!row){const inserted=database.prepare('INSERT OR IGNORE INTO cms_security_sessions(key,created_at,last_activity_at,absolute_expires_at) VALUES(?,?,?,?)').run(key,createdAt,now,absoluteExpiresAt);if(inserted.changes)notifyMutation();row=read.get(key);}
      return sessionStatus(row,now,absoluteExpiresAt);
    }
    function validateSession(session){
      if(!session?.session?.id||!session?.user?.id)return {valid:false,reason:'AUTH_REQUIRED'};
      if(!database.prepare('SELECT id FROM "session" WHERE id=? AND userId=?').get(session.session.id,session.user.id))return {valid:false,reason:'AUTH_REQUIRED'};
      const info=sessionInfo(session);
      const reason=sessionExpiration(session,info);
      if(reason){revokeSession(session);auditExpiration(reason);return {valid:false,reason};}
      return {valid:true,info};
    }
    function recordActivity(session){
      const checked=validateSession(session);if(!checked.valid)return checked;
      database.prepare('UPDATE cms_security_sessions SET last_activity_at=? WHERE key=?').run(clock(),digest('session',session.session.id));
      notifyMutation();
      return {valid:true,info:sessionInfo(session)};
    }
    return {ready:Promise.resolve(),beginLogin,finishLogin,releaseLogin,validateSession,sessionInfo,recordActivity,revokeSession,revokeUserSessions,forgetSession};
  }
  async function readLogin(request){
    if(Number(request.headers.get('content-length'))>16384)throw Error('LOGIN_BODY_TOO_LARGE');
    const clone=request.clone(),reader=clone.body?.getReader();if(!reader)return {};
    let timer,total=0;const chunks=[];
    try{
      const read=(async()=>{for(;;){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>16384)throw Error('LOGIN_BODY_TOO_LARGE');chunks.push(Buffer.from(value));}return Buffer.concat(chunks).toString('utf8');})();
      const raw=await Promise.race([read,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('LOGIN_BODY_TIMEOUT')),10000);})]);
      const type=request.headers.get('content-type')||'';
      return type.includes('application/x-www-form-urlencoded')?Object.fromEntries(new URLSearchParams(raw)):JSON.parse(raw);
    }finally{clearTimeout(timer);void reader.cancel().catch(()=>{});}
  }
  async function callAuthHandler(request){
    // Better Auth can create/revoke sessions after the login reservation was saved.
    // Notify after it settles too, including partial changes on error and sign-out.
    try{return await auth.handler(request);}finally{notifyMutation();}
  }
  async function protectedFetch(request,network){
    const pathname=new URL(request.url).pathname;
    if(request.method==='POST'&&pathname.endsWith('/sign-in/email')){
      let body;try{body=await readLogin(request);}catch{return reply(400,failureBody);}
      let gate;try{gate=await beginLogin({email:body?.email,...network});}catch(error){safeLog('error','auth.rate.storage.failed',error);return reply(503,{error:'AUTH_TEMPORARILY_UNAVAILABLE',message:'No se pudo completar el acceso. Inténtalo de nuevo.'});}
      if(!gate.allowed){audit('auth.login.blocked',{scope:gate.scope,retryAfterSeconds:gate.retryAfterSeconds});return reply(429,{error:'LOGIN_TEMPORARILY_BLOCKED',message:'Hay demasiados intentos. Espera antes de volver a intentarlo.',retryAfterSeconds:gate.retryAfterSeconds},{'Retry-After':String(gate.retryAfterSeconds)});}
      try{
        const response=await callAuthHandler(request),result=await finishLogin(gate.ticket,response.status);
        if(result.counted)audit('auth.login.failed',{status:response.status,blocked:result.blocked});
        if([400,401,403,422].includes(response.status))return reply(401,failureBody,response.headers);
        if(response.status===429){const seconds=Math.max(1,Number(response.headers.get('retry-after')||response.headers.get('x-retry-after'))||10);return reply(429,{error:'LOGIN_TEMPORARILY_BLOCKED',message:'Espera unos segundos antes de volver a intentarlo.',retryAfterSeconds:seconds},{'Retry-After':String(seconds)});}
        return response;
      }catch(error){
        try{await releaseLogin(gate.ticket);}catch(storageError){safeLog('error','auth.rate.storage.failed',storageError);}
        safeLog('error','auth.login.unavailable',error);return reply(503,{error:'AUTH_TEMPORARILY_UNAVAILABLE',message:'No se pudo completar el acceso. Inténtalo de nuevo.'});
      }
    }
    const session=await auth.api.getSession({headers:request.headers,query:{disableCookieCache:true,disableRefresh:true}}).catch(()=>null);
    if(session?.session&&!(await validateSession(session)).valid)return reply(401,{error:'AUTH_REQUIRED',message:'Inicia sesión para continuar.'});
    return callAuthHandler(request);
  }
  async function authHandler(req,res,next){
    // The socket address is transport supplied. Do not trust a caller-controlled forwarded chain.
    const resolved=typeof clientIpResolver==='function'?clientIpResolver(req):null;
    const verifiedIp=typeof resolved==='string'&&isIP(resolved)>0;
    const network={ip:verifiedIp?resolved:String(req.socket?.remoteAddress||'unknown'),verifiedIp};
    try{return await toNodeHandler({handler:request=>protectedFetch(request,network)})(req,res);}
    catch(error){safeLog('error','auth.request.unavailable',error);if(!res.headersSent)return res.status(503).json({error:'AUTH_TEMPORARILY_UNAVAILABLE',message:'No se pudo completar el acceso. Inténtalo de nuevo.'});res.end();}
  }
  function registerActivityRoutes(app,{requireSession,requireCsrf}){
    app.get('/api/cms/auth/activity',requireSession,async(req,res)=>res.json({authenticated:true,userSecurity:await sessionInfo(req.cmsSession)}));
    app.post('/api/cms/auth/activity',requireSession,requireCsrf,async(req,res)=>{const result=await recordActivity(req.cmsSession);if(!result.valid)return res.status(401).json({error:'AUTH_REQUIRED'});res.json({ok:true,userSecurity:result.info});});
  }
  return {...methods,policy:settings,authHandler,registerActivityRoutes};
}

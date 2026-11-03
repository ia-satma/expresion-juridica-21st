/** Input-driven keepalive. Background reads never renew the server's idle clock. */
export function createSessionActivity({api,onExpired=()=>{}}){
  let active=false,ownerId=null,lockedOwnerId=null,info=null,offset=0,lastPostedAt=0,lastIntentAt=0,pendingActivity=false,activityTimer=null,timer=null,polling=false,posting=false,lastPollAt=0,generation=0;
  const banner=document.createElement('section');banner.hidden=true;banner.className='cms-session-notice';banner.setAttribute('aria-live','polite');banner.setAttribute('role','status');
  banner.style.cssText='position:fixed;z-index:10000;left:20px;right:20px;bottom:18px;max-width:720px;margin:auto;padding:18px 20px;background:#fffaf0;border:1px solid #d8bc88;border-radius:8px;box-shadow:0 8px 28px #141a3a22;color:#141a3a;font:14px/1.5 system-ui,sans-serif;';
  const heading=document.createElement('strong'),message=document.createElement('p'),button=document.createElement('button');message.style.cssText='margin:5px 0 12px;';
  button.type='button';button.style.cssText='padding:9px 14px;border:1px solid #141a3a;border-radius:5px;background:#141a3a;color:white;font:inherit;font-size:12px;cursor:pointer;';
  banner.append(heading,message,button);document.body.append(banner);
  function update(next){
    if(!next)return;info=next;offset=Date.now()-Number(info.serverNow||Date.now());
    if(Number(info.idleExpiresAt)-serverNow()>(Number(info.warningSeconds)||120)*1000)banner.hidden=true;
  }
  const serverNow=()=>Date.now()-offset;
  function halt(){generation++;clearInterval(timer);clearTimeout(activityTimer);timer=null;activityTimer=null;active=false;pendingActivity=false;polling=false;posting=false;}
  function noteUnauthorized(){
    if(!active)return;lockedOwnerId=ownerId;halt();
    heading.textContent='Tu sesión terminó';message.textContent='El contenido sin guardar sigue en esta pestaña. Inicia sesión con la misma cuenta para continuar. Evita recargarla hasta recuperar tu trabajo.';button.textContent='Iniciar sesión';banner.hidden=false;banner.setAttribute('role','alert');
    for(const input of document.querySelectorAll('input[type=password]'))input.value='';
    onExpired({reason:'session-ended',preserveDrafts:true});
  }
  async function poll(){
    if(!active||polling)return;polling=true;lastPollAt=Date.now();const token=generation;
    try{const result=await api('/api/cms/auth/activity');if(active&&token===generation)update(result.userSecurity);}
    catch(error){if(token===generation&&(error.status===401||error.code==='AUTH_REQUIRED'||error.message==='AUTH_REQUIRED'))noteUnauthorized();}
    finally{if(token===generation)polling=false;}
  }
  async function postActivity(force=false){
    if(!active||posting||document.hidden||!pendingActivity&&!force)return;
    posting=true;pendingActivity=false;lastPostedAt=Date.now();const token=generation;
    try{const result=await api('/api/cms/auth/activity',{method:'POST',body:{}});if(active&&token===generation)update(result.userSecurity);}
    catch(error){if(token!==generation)return;if(error.status===401||error.code==='AUTH_REQUIRED'||error.message==='AUTH_REQUIRED')noteUnauthorized();else if(force){heading.textContent='No se pudo confirmar la sesión';message.textContent='Tu contenido sigue en la pestaña. Comprueba la conexión y vuelve a intentarlo.';button.textContent='Volver a intentar';banner.hidden=false;}}
    finally{if(token===generation)posting=false;}
  }
  function trustedActivity(event){
    if(!active||!event.isTrusted||document.hidden||['auth','booting'].includes(document.querySelector('#app')?.dataset.state))return;
    const now=Date.now();
    // Programmatic scrollIntoView during generation is not human activity.
    if(event.type==='scroll'&&now-lastIntentAt>2000)return;
    if(event.type!=='scroll')lastIntentAt=now;
    pendingActivity=true;
    const interval=(Number(info?.activityIntervalSeconds)||60)*1000,remaining=interval-(now-lastPostedAt);
    if(remaining<=0){clearTimeout(activityTimer);activityTimer=null;void postActivity();}
    else if(!activityTimer)activityTimer=setTimeout(()=>{activityTimer=null;void postActivity();},remaining);
  }
  function tick(){
    if(!active||!info)return;
    const absoluteLeft=Number(info.absoluteExpiresAt)-serverNow(),left=Math.min(Number(info.idleExpiresAt)-serverNow(),absoluteLeft);
    if(Date.now()-lastPollAt>=60000||left<=0&&Date.now()-lastPollAt>=5000)void poll();
    if(left<=0){
      heading.textContent='Comprobando tu sesión';message.textContent='Conserva esta pestaña abierta mientras se comprueba el acceso. Tu trabajo sin guardar permanece aquí.';button.textContent='Comprobar acceso';banner.hidden=false;return;
    }
    if(left<=(Number(info.warningSeconds)||120)*1000){
      const seconds=Math.max(1,Math.ceil(left/1000)),remaining=`${Math.floor(seconds/60)} min ${String(seconds%60).padStart(2,'0')} s`;
      if(absoluteLeft<=(Number(info.warningSeconds)||120)*1000){heading.textContent='La sesión debe renovarse';message.textContent=`La sesión alcanzará su límite de seguridad en ${remaining}. Guarda tu trabajo; será necesario iniciar sesión de nuevo.`;button.textContent='Comprobar acceso';}
      else{heading.textContent='La sesión está por terminar';message.textContent=`Por seguridad, la sesión se cerrará tras la inactividad. Quedan ${remaining}. Pulsa continuar para seguir trabajando.`;button.textContent='Continuar trabajando';}
      banner.hidden=false;
    }
  }
  function start(session){
    const resume=Boolean(lockedOwnerId&&session?.user?.id===lockedOwnerId);
    halt();ownerId=session?.user?.id||null;lockedOwnerId=null;
    if(!session?.authenticated||!ownerId||!session.userSecurity){banner.hidden=true;return false;}
    active=true;update(session.userSecurity);lastPostedAt=Date.now()-60000;lastPollAt=Date.now();banner.hidden=true;banner.setAttribute('role','status');
    for(const input of document.querySelectorAll('input[type=password]'))input.value='';
    timer=setInterval(tick,1000);return resume;
  }
  function stop(){halt();ownerId=null;lockedOwnerId=null;info=null;banner.hidden=true;}
  button.addEventListener('click',()=>{if(active){pendingActivity=true;void postActivity(true);}else document.querySelector('#auth-email')?.focus();});
  for(const name of ['keydown','pointerdown','touchstart','touchmove','wheel','scroll','input','change','click'])document.addEventListener(name,trustedActivity,{passive:true,capture:true});
  document.addEventListener('visibilitychange',()=>{if(active&&!document.hidden)void poll();});
  window.addEventListener('pagehide',halt);
  window.addEventListener('pageshow',event=>{
    if(!event.persisted||!ownerId||!info||lockedOwnerId)return;
    active=true;lastPollAt=0;timer=setInterval(tick,1000);void poll();
  });
  return {start,stop,noteUnauthorized,getGeneration:()=>generation};
}

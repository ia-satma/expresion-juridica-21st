const stages = [
  ['prepare', 'Insumos'], ['content', 'Contenido y diseño'], ['images', 'Imágenes'],
  ['layout', 'Composición'], ['review', 'Revisión visual'], ['export', 'Archivos'], ['save', 'Guardado']
];
const titles = { presentation:'Creando tu presentación', social:'Diseñando tus publicaciones', document:'Preparando tu documento' };
export function createGenerationProgress(element, kind) {
  if (!element) return { start(){}, update(){}, finish(){}, fail(){} };
  element.className='generation-progress';
  element.setAttribute('role','region'); element.setAttribute('aria-label','Estado de generación');
  element.innerHTML='<div class="generation-art" aria-hidden="true"><div class="generation-sheet generation-sheet-back"></div><div class="generation-sheet generation-sheet-front"><i></i><b></b><span></span><span></span><em></em></div><div class="generation-scan"></div></div><div class="generation-body"><div class="generation-heading"><h3></h3><span class="generation-clock" aria-hidden="true"></span></div><p class="generation-message" role="status" aria-live="polite"></p><ol class="generation-steps" aria-label="Etapas de generación"></ol><div class="generation-meter"><progress aria-label="Avance de la etapa actual"></progress><span></span></div><small class="generation-help">Puedes continuar en el CMS y volver a este apartado.</small></div>';
  const $=selector=>element.querySelector(selector);
  const availableStages=()=>stages.filter(([id])=>id!=='review'||kind==='social');
  let timer, started=0, sequence=availableStages();
  function clock() { const seconds=Math.max(0,Math.floor((Date.now()-started)/1000)); $('.generation-clock').textContent=seconds<60?`${seconds} s`:`${Math.floor(seconds/60)} min ${String(seconds%60).padStart(2,'0')} s`; }
  function stop() { clearInterval(timer); timer=null; }
  function start({ includeImages=true, includeReview=kind==='social', title=titles[kind], message='Enviando y revisando tus insumos…', created }={}) {
    stop(); started=Number(created)||Date.now(); sequence=availableStages().filter(([id])=>(id!=='images'||includeImages&&kind!=='document')&&(id!=='review'||includeReview));
    element.hidden=false; element.dataset.state='running'; element.setAttribute('aria-busy','true');
    $('.generation-heading h3').textContent=title;
    $('.generation-steps').innerHTML=sequence.map(([id,label])=>`<li data-stage="${id}"><span></span>${label}</li>`).join('');
    $('.generation-help').textContent='Puedes continuar en el CMS y volver a este apartado.';
    update({stage:'prepare',message}); clock(); timer=setInterval(clock,1000);
  }
  function infer(message='') {
    if (/guardad|listos|listas/i.test(message)) return 'save';
    if (kind==='social'&&/revisi.n visual|revisando la imagen|comprobando el dise.o/i.test(message)) return 'review';
    if (/imagen|foto/i.test(message)) return 'images';
    if (/archivo|Word|PDF|PowerPoint|export/i.test(message)) return 'export';
    if (/pieza|composici|membret|páginas/i.test(message)) return 'layout';
    if (/Sol|contenido|texto|copy|diseño/i.test(message)) return 'content';
    return 'prepare';
  }
  function update(job={}) {
    if (!timer && element.hidden) start({created:job.created});
    const stage=job.stage||infer(job.message);
    if(['images','review'].includes(stage)&&!sequence.some(([id])=>id===stage)&&availableStages().some(([id])=>id===stage)){
      const enabled=new Set([...sequence.map(([id])=>id),stage]);sequence=availableStages().filter(([id])=>enabled.has(id));
      $('.generation-steps').innerHTML=sequence.map(([id,label])=>`<li data-stage="${id}"><span></span>${label}</li>`).join('');
    }
    const index=sequence.findIndex(([id])=>id===stage);
    const message=job.message||'El agente está trabajando…';
    if ($('.generation-message').textContent!==message) $('.generation-message').textContent=message;
    for (const [i,li] of [...element.querySelectorAll('.generation-steps li')].entries()) {
      li.dataset.state=i<index?'done':i===index?'active':'waiting';
      if(i===index)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');
    }
    const total=Math.max(1,Number(job.total)||1), completed=Math.max(0,Math.min(total,Number(job.completed)||0));
    const bar=$('progress');bar.max=total;
    if(total>1||stage==='review'&&Number(job.total)>0){bar.value=completed;$('.generation-meter>span').textContent=`${completed} de ${total}`;}else{bar.removeAttribute('value');$('.generation-meter>span').textContent='En curso';}
    if(job.created && Number(job.created)<started)started=Number(job.created);
  }
  function finish(message='Archivos guardados y listos') {
    stop(); element.dataset.state='complete'; element.setAttribute('aria-busy','false');$('.generation-message').textContent=message;
    for(const li of element.querySelectorAll('.generation-steps li')){li.dataset.state='done';li.removeAttribute('aria-current');}
    $('progress').max=1;$('progress').value=1;$('.generation-meter>span').textContent='Listo';
    $('.generation-help').textContent='El resultado está disponible abajo y en tu historial.';
  }
  function fail(message='No se pudo completar. Tus datos siguen disponibles para reintentar.') {
    stop();element.dataset.state='failed';element.setAttribute('aria-busy','false');$('.generation-message').textContent=message;
    $('progress').removeAttribute('value');$('.generation-meter>span').textContent='Revisa el aviso';
    $('.generation-help').textContent='Puedes corregir el problema y volver a intentarlo.';
  }
  window.addEventListener('pagehide',stop);
  return { start, update, finish, fail };
}

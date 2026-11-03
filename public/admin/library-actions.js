let dialog, pending;
export function confirmLibraryRemoval(name) {
  if(pending)return Promise.resolve(false);
  if(!dialog){
    dialog=document.createElement('dialog');dialog.className='library-remove-dialog';dialog.setAttribute('aria-labelledby','library-remove-title');
    dialog.innerHTML='<h2 id="library-remove-title">¿Eliminar de la biblioteca?</h2><p class="library-remove-name"></p><p>Se moverá a la papelera. Puedes restaurarlo después.</p><div><button type="button" class="button button-secondary" data-cancel>Cancelar</button><button type="button" class="button button-primary" data-accept>Eliminar</button></div>';
    dialog.querySelector('[data-cancel]').addEventListener('click',()=>dialog.close('cancel'));
    dialog.querySelector('[data-accept]').addEventListener('click',()=>dialog.close('delete'));
    dialog.addEventListener('close',()=>{const resolve=pending;pending=null;resolve?.(dialog.returnValue==='delete');});
    document.body.append(dialog);
  }
  dialog.querySelector('.library-remove-name').textContent=String(name||'Este elemento');dialog.returnValue='';
  return new Promise(resolve=>{pending=resolve;dialog.showModal();dialog.querySelector('[data-cancel]').focus();});
}

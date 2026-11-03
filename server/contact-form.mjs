import crypto from 'node:crypto';
import { BRAND_CONTACT } from './brand-contact.mjs';

export function registerContactFormRoute(app,{store,writeStore,persistSubmission=async()=>{},findSubmission=async()=>null}) {
  app.post('/api/public/contact',async(req,res,next)=>{
    const input=req.body||{};
    if(String(input.website||'').trim()) return res.status(400).json({error:'INVALID_REQUEST'});
    const name=String(input.nombre||'').trim(), email=String(input.correo||'').trim().toLowerCase(), subject=String(input.materia||'').trim(), message=String(input.mensaje||'').trim();
    if(!name||name.length>160||!/^\S+@\S+\.\S+$/.test(email)||email.length>254||!subject||subject.length>100||!message||message.length>600||input.privacidad!==true) return res.status(422).json({error:'CONTACT_FIELDS_INVALID'});
    const requestKey=/^[a-f0-9-]{36}$/i.test(input.requestKey||'')?input.requestKey:null;
    const hex=requestKey?crypto.createHash('sha256').update(requestKey+':'+email).digest('hex').slice(0,32):null;
    const id=hex?`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`:crypto.randomUUID();
    const previous=store.submissions||[];
    const existing=requestKey&&(await findSubmission(id)||previous.find(item=>item.requestKey===requestKey&&item.email===email));
    res.set('Cache-Control','no-store');
    const receipt=item=>({ok:true,id:item.id,contactEmail:BRAND_CONTACT.email,message:'Tu solicitud quedó guardada. Puedes completar el envío desde tu aplicación de correo.'});
    if(existing) return res.json(receipt(existing));
    const at=new Date().toISOString();
    const item={id,name,email,subject,message,consentAt:at,status:'new',createdAt:at,updatedAt:at,source:String(input.source||'/contacto/').slice(0,200),...(requestKey?{requestKey}:{})};
    try { await persistSubmission(item); } catch(error) {return next(error);}
    store.submissions=[item,...previous];
    try { await writeStore(); }
    catch(error) {store.submissions=previous;return next(error);}
    return res.status(201).json(receipt(item));
  });
}

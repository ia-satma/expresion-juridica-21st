const defaults={owner:['*'],editor:['content','media','signatures','submissions'],viewer:['view']};
const modules={home:'content',pages:'content',fields:'content',content:'content',inventory:'content',publish:'content',revisions:'content',media:'media',signatures:'signatures',presentations:'agents',posts:'agents',documents:'agents',submissions:'submissions',settings:'config','seo-audit':'config',users:'users','role-permissions':'users',activity:'users'};
export function cmsPermissions(req,store) {const role=req.cmsAdmin?.role||req.cmsUser?.role;const configured=store.rolePermissions?.[role];return role==='owner'?['*']:Array.isArray(configured)?configured:defaults[role]||[];}
export function cmsModuleAllowed(req,store,module,readOnly=false) {
  const permissions=cmsPermissions(req,store);
  return permissions.includes('*')||permissions.includes(module)||readOnly&&['content','media','signatures','view'].includes(module)&&permissions.includes('view')||module==='view'&&['owner','editor','viewer'].includes(req.cmsAdmin?.role||req.cmsUser?.role);
}
export function cmsRequestAllowed(req,store) {
  const route=String(req.originalUrl||req.url||'').split('?')[0].replace(/^\/api\/cms\//,'').split('/')[0];
  if(route==='auth-state'||route==='auth'||route==='public')return true;
  return cmsModuleAllowed(req,store,route==='summary'?'view':modules[route]||'users',['GET','HEAD'].includes(req.method));
}

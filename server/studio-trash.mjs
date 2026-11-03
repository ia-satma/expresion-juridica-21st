import { publicFailure, safeLog } from './security-logging.mjs';

// Recoverable library removal: source files remain private and can be restored.
export function registerStudioTrashRoutes(app,{base,getRecord,saveRecord,serialize=value=>value,requireAuth,requireEditor,requireCsrf,audit,writeStore,action}) {
  const mutate=restore=>async(req,res)=>{
    try {
      const original=await getRecord(req.params.id);
      if(!original)return res.status(404).json({error:'RECORD_NOT_FOUND'});
      if(req.body?.version&&req.body.version!==original.updatedAt)return res.status(409).json({error:'STUDIO_VERSION_CHANGED'});
      const at=new Date().toISOString(),record={...original,updatedAt:at};
      if(restore)delete record.deletedAt;else record.deletedAt=original.deletedAt||at;
      await saveRecord(record);
      audit(action+(restore?'.restore':'.delete'),req.cmsUser,{recordId:record.id});
      await writeStore();
      res.json({ok:true,recoverable:true,record:serialize(record)});
    }catch(error){safeLog('error','studio.library.failed',error);res.status(error.status||500).json(publicFailure(error,'STUDIO_STORAGE_UNAVAILABLE'));}
  };
  app.delete(base+'/:id',requireAuth,requireEditor,requireCsrf,mutate(false));
  app.post(base+'/:id/restore',requireAuth,requireEditor,requireCsrf,mutate(true));
}

import { listStudioRecords, readStudioState, writeStudioState } from './studio-state.mjs';

// Uses the same private, environment-scoped storage as the editorial studio.
// The CMS JSON remains a fallback for historical requests.
export function createContactRepository(store) {
  return {
    async list() { store.submissions=await listStudioRecords('submissions',store.submissions||[]);return store.submissions; },
    async get(id) { return await readStudioState('submissions',id)||(store.submissions||[]).find(item=>item.id===id)||null; },
    async save(item) { await writeStudioState('submissions',item.id,item); }
  };
}

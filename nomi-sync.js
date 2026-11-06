/* NOMI Sync v1 — guarded record sync for core IndexedDB stores.
   Existing local records are marked local-only on first activation.
   Attachments, photos, settings and localStorage extras are intentionally deferred.
*/
(() => {
  'use strict';
  const DB = window.NomiData;
  const META_KEY = 'nomi.sync.v1';
  const STORES = ['tasks','planner_entries','planner_notes','events','journal','ideas','books'];
  const PAGE = 500;
  let running = false;
  let suppress = 0;
  let timer = null;
  let hooked = false;

  const readMeta = () => { try { return JSON.parse(localStorage.getItem(META_KEY) || 'null'); } catch (_) { return null; } };
  const writeMeta = value => localStorage.setItem(META_KEY, JSON.stringify(value));
  const idOf = (store, row) => row && (row.id ?? row.key ?? (store === 'settings' ? 'settings' : null));
  const stamp = row => {
    const raw = row?.updatedAt || row?.updated_at || row?.createdAt || row?.created_at;
    const t = raw ? Date.parse(raw) : Date.now();
    return new Date(Number.isFinite(t) ? t : Date.now()).toISOString();
  };
  const queueKey = (store,id) => `${store}::${String(id)}`;
  function enqueue(store,row,idOverride) {
    const m = readMeta(); if (!m?.enabled || suppress || !STORES.includes(store)) return;
    const id = idOverride ?? idOf(store,row); if (id == null) return;
    if (m.localOnly?.includes(queueKey(store,id))) return;
    const q = m.queue || {};
    q[queueKey(store,id)] = {
      store_name:store, record_id:String(id), payload:row ?? {id},
      client_updated_at: row ? stamp(row) : new Date().toISOString(),
      deleted_at: row?.deletedAt || (!row ? new Date().toISOString() : null)
    };
    m.queue=q; writeMeta(m); schedule();
  }
  function schedule(){ if(timer)clearTimeout(timer); timer=setTimeout(()=>syncNow().catch(e=>console.warn('NOMI sync:',e)),1800); }
  function hookStorage(){
    if(hooked || !DB?.storage)return;
    const s=DB.storage; hooked=true;
    for(const method of ['put','add']){
      const original=s[method]?.bind(s); if(!original)continue;
      s[method]=async function(store,row){const result=await original(store,row);enqueue(store,row);return result;};
    }
    const bulk=s.bulkPut?.bind(s);
    if(bulk)s.bulkPut=async function(store,rows){const result=await bulk(store,rows);(rows||[]).forEach(row=>enqueue(store,row));return result;};
    const del=s.delete?.bind(s);
    if(del)s.delete=async function(store,id){const before=STORES.includes(store)?await s.get(store,id):null;const result=await del(store,id);if(before)enqueue(store,{...before,deletedAt:new Date().toISOString()},id);return result;};
  }
  async function cloud(){
    if(!window.NOMICloud?.getClient)throw new Error('Модуль облачного аккаунта не готов. Перезагрузи страницу.');
    const c=await window.NOMICloud.getClient();
    const {data:{session}}=await c.auth.getSession();
    if(!session?.user)throw new Error('Сначала войди в аккаунт.');
    return c;
  }
  async function remoteRows(c){
    const out=[];
    for(let from=0;;from+=PAGE){
      const {data,error}=await c.from('nomi_records').select('store_name,record_id,payload,client_updated_at,deleted_at,revision,device_id').in('store_name',STORES).order('server_updated_at',{ascending:true}).range(from,from+PAGE-1);
      if(error)throw error; out.push(...(data||[])); if(!data||data.length<PAGE)break;
    }
    return out;
  }
  async function activate(){
    if(running) return;
    if(!DB?.isReady || !DB.storage)throw new Error('База NOMI ещё загружается. Подожди несколько секунд и повтори.');
    running=true;
    try{
      const c=await cloud();
      const {data:{session}}=await c.auth.getSession();
      let m=readMeta();
      const local={}; let localCount=0;
      for(const name of STORES){local[name]=await DB.storage.getAll(name);localCount+=local[name].length;}
      const remote=await remoteRows(c);
      if(!m?.enabled){
        if(localCount>0 && remote.length>0)throw new Error('На этом устройстве уже есть локальные записи, и в облаке тоже есть данные. Для защиты от перезаписи синхронизация остановлена.');
        const localOnly=[];
        if(localCount>0) for(const name of STORES) for(const row of local[name]){const id=idOf(name,row);if(id!=null)localOnly.push(queueKey(name,id));}
        m={enabled:true,deviceId:localStorage.getItem('nomi.device.v1')||crypto.randomUUID(),localOnly,queue:{},activatedAt:new Date().toISOString()};
        localStorage.setItem('nomi.device.v1',m.deviceId); writeMeta(m);
      }
      // Download cloud rows first; never overwrite a row that is locally excluded.
      const localOnly=new Set(m.localOnly||[]);
      suppress++;
      try{
        for(const row of remote){
          if(!STORES.includes(row.store_name)||localOnly.has(queueKey(row.store_name,row.record_id)))continue;
          const current=await DB.storage.get(row.store_name,row.record_id);
          const remoteTime=Date.parse(row.client_updated_at||row.server_updated_at||row.updated_at||0);
          const localTime=current?Date.parse(stamp(current)):0;
          if(!current||remoteTime>localTime){
            const payload={...row.payload};
            if(row.deleted_at)payload.deletedAt=row.deleted_at;
            await DB.storage.put(row.store_name,payload);
          }
        }
      } finally {suppress--;}
      hookStorage();
      await pushQueue(c);
      const {error:stateError}=await c.from('nomi_sync_state').upsert({user_id:session.user.id,last_sync_at:new Date().toISOString(),device_label:navigator.userAgent.slice(0,120),updated_at:new Date().toISOString()});
      if(stateError)console.warn('NOMI sync state:',stateError.message);
      return {downloaded:remote.length,uploaded:Object.keys(readMeta()?.queue||{}).length};
    } finally {running=false;}
  }
  async function pushQueue(c){
    const m=readMeta(); if(!m?.enabled)return;
    const entries=Object.entries(m.queue||{});
    for(const [key,item] of entries){
      const {data,error}=await c.rpc('nomi_apply_record',{
        p_store_name:item.store_name,p_record_id:item.record_id,p_payload:item.payload,
        p_client_updated_at:item.client_updated_at,p_device_id:m.deviceId,p_deleted_at:item.deleted_at
      });
      if(error)throw error;
      const latest=readMeta(); if(latest?.queue){delete latest.queue[key];writeMeta(latest);}
    }
  }
  async function syncNow(){
    const m=readMeta(); if(!m?.enabled||running)return;
    running=true;
    try{
      const c=await cloud(); await pushQueue(c);
      const remote=await remoteRows(c); const localOnly=new Set(readMeta()?.localOnly||[]);
      suppress++;
      try{for(const row of remote){if(localOnly.has(queueKey(row.store_name,row.record_id)))continue;const current=await DB.storage.get(row.store_name,row.record_id);const rt=Date.parse(row.client_updated_at||row.server_updated_at||0);const lt=current?Date.parse(stamp(current)):0;if(!current||rt>lt){const payload={...row.payload};if(row.deleted_at)payload.deletedAt=row.deleted_at;await DB.storage.put(row.store_name,payload);}}}finally{suppress--;}
      const fresh=readMeta();fresh.lastSyncAt=new Date().toISOString();writeMeta(fresh);
      return {ok:true};
    } finally {running=false;}
  }
  window.NOMISync={activate,syncNow,status:()=>readMeta()};
  // Storage may become available after this file is evaluated.
  const tryHook=()=>{if(DB?.isReady&&DB.storage){hookStorage();return true;}return false;};
  if(!tryHook()){
    window.addEventListener('load',tryHook,{once:true});
    const hookPoll=setInterval(()=>{if(tryHook())clearInterval(hookPoll);},500);
  }
  // Periodic two-way refresh after activation; local writes also trigger a short debounce.
  setInterval(()=>{if(readMeta()?.enabled && navigator.onLine)syncNow().catch(e=>console.warn('NOMI background sync:',e));},30000);
  window.addEventListener('online',()=>{if(readMeta()?.enabled)syncNow().catch(e=>console.warn('NOMI reconnect sync:',e));});
  document.addEventListener('click',async e=>{
    const b=e.target.closest('#nomi-cloud-sync'); if(!b)return;
    e.preventDefault(); b.disabled=true; const old=b.textContent; b.textContent='Синхронизация…';
    try{const m=readMeta();const result=m?.enabled?await syncNow():await activate();b.textContent='Синхронизировать сейчас';const note=document.querySelector('#nomi-cloud-message');if(note)note.textContent='Синхронизация выполнена.';}
    catch(err){b.textContent=old;const note=document.querySelector('#nomi-cloud-message');if(note){note.textContent=err.message||'Не удалось выполнить синхронизацию.';note.style.color='#a21d45';}}
    finally{b.disabled=false;}
  });
})();

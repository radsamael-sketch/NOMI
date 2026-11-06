/* NOMI Cloud — safe authentication stage.
   This module intentionally does NOT read, upload, download, or modify local data.
   Data synchronization will be enabled only after its conflict/deletion strategy is implemented.
*/
(()=>{
'use strict';
const CFG=window.NOMI_SUPABASE_CONFIG||{};
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let client=null,user=null,connectPromise=null,authListenerAttached=false;
const status=()=>user?`Вход выполнен: ${user.email||'аккаунт'}`:'Не выполнен вход';
function sdk(){
 if(window.supabase?.createClient)return Promise.resolve();
 return new Promise((resolve,reject)=>{
  let s=document.querySelector('#supabase-sdk');
  if(s){const started=Date.now();const timer=setInterval(()=>{if(window.supabase?.createClient){clearInterval(timer);resolve()}else if(Date.now()-started>12000){clearInterval(timer);reject(Error('Не удалось загрузить Supabase SDK. Проверь подключение к интернету.'))}},100);return;}
  s=document.createElement('script');s.id='supabase-sdk';s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';s.async=true;
  s.onload=()=>window.supabase?.createClient?resolve():reject(Error('Supabase SDK загрузился некорректно.'));
  s.onerror=()=>reject(Error('Не удалось загрузить Supabase SDK. Проверь интернет.'));
  document.head.append(s);
 });
}
async function connect(){
 if(client)return client;
 if(connectPromise)return connectPromise;
 connectPromise=(async()=>{
  if(!CFG.url||!CFG.anonKey||CFG.url.includes('YOUR_PROJECT')||CFG.anonKey.includes('YOUR_'))throw Error('Сначала заполни config/supabase.config.js: Project URL и publishable/anon key.');
  if(!/^https:\/\/.+\.supabase\.co$/.test(CFG.url))throw Error('Проверь Project URL в config/supabase.config.js.');
  await sdk();
  const c=window.supabase.createClient(CFG.url,CFG.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const {data,error}=await c.auth.getSession();if(error)throw error;
  client=c;user=data.session?.user||null;
  if(!authListenerAttached){c.auth.onAuthStateChange((_event,session)=>{user=session?.user||null;refreshPanel();updateStatus()});authListenerAttached=true;}
  updateStatus();return client;
 })();
 try{return await connectPromise}catch(e){connectPromise=null;throw e;}
}
function updateStatus(){const n=$('#nomi-cloud-status');if(n)n.textContent=status();const e=$('#nomi-cloud-email');if(e)e.textContent=user?.email||'Аккаунт не подключён';}
function msg(s,bad=false){const n=$('#nomi-cloud-message');if(n){n.textContent=s;n.style.color=bad?'#a21d45':'#416b5c';}}
function panel(){
 $('#nomi-cloud-modal')?.remove();
 const wrap=document.createElement('div');wrap.id='nomi-cloud-modal';
 wrap.innerHTML=`<div class="nomi-cloud-backdrop"><section class="nomi-cloud-dialog" role="dialog" aria-modal="true" aria-labelledby="nomi-cloud-title"><button class="nomi-cloud-close" aria-label="Закрыть">×</button><small>PERSONAL CLOUD</small><h2 id="nomi-cloud-title">Аккаунт и синхронизация</h2><p id="nomi-cloud-status">${esc(status())}</p><div id="nomi-cloud-auth"><label>Email<input id="nomi-cloud-email-input" type="email" autocomplete="email" placeholder="you@example.com"></label><label>Пароль<input id="nomi-cloud-password" type="password" autocomplete="current-password" placeholder="Не менее 6 символов"></label><div class="nomi-cloud-actions"><button id="nomi-cloud-signin" type="button">Войти</button><button id="nomi-cloud-signup" type="button">Создать аккаунт</button></div><button class="nomi-cloud-link" id="nomi-cloud-reset" type="button">Забыли пароль?</button></div><div id="nomi-cloud-account" hidden><p>Ты вошла как <b id="nomi-cloud-email"></b></p><div class="nomi-cloud-actions"><button id="nomi-cloud-sync" type="button">Включить синхронизацию</button><button id="nomi-cloud-logout" class="secondary" type="button">Выйти</button></div><p class="nomi-cloud-note">При первом включении существующие локальные записи останутся только на этом устройстве. В облако будут добавляться новые записи и загружаться данные с других устройств.</p></div><p id="nomi-cloud-message" role="status" aria-live="polite"></p></section></div>`;
 document.body.append(wrap);
 wrap.addEventListener('click',e=>{if(e.target.classList.contains('nomi-cloud-backdrop')||e.target.closest('.nomi-cloud-close'))wrap.remove()});
 $('#nomi-cloud-signin').onclick=()=>auth('signin');$('#nomi-cloud-signup').onclick=()=>auth('signup');$('#nomi-cloud-reset').onclick=reset;$('#nomi-cloud-logout').onclick=logout;
 refreshPanel();
 connect().then(()=>refreshPanel()).catch(e=>msg(e.message||'Ошибка подключения',true));
}
function refreshPanel(){if(!$('#nomi-cloud-modal'))return;$('#nomi-cloud-auth').hidden=!!user;$('#nomi-cloud-account').hidden=!user;const b=$('#nomi-cloud-sync');const sm=window.NOMISync?.status?.();if(b&&sm?.enabled)b.textContent='Синхронизировать сейчас';const note=$('.nomi-cloud-note');if(note&&sm?.enabled)note.textContent='Синхронизация включена. Старые локальные записи сохранены только на этом устройстве; новые записи синхронизируются с облаком.';updateStatus();}
async function auth(kind){
 try{
  const c=await connect(),email=$('#nomi-cloud-email-input')?.value.trim(),password=$('#nomi-cloud-password')?.value;
  if(!email||!password)throw Error('Введи email и пароль.');
  if(password.length<6)throw Error('Пароль должен содержать не менее 6 символов.');
  const result=kind==='signup'?await c.auth.signUp({email,password}):await c.auth.signInWithPassword({email,password});
  if(result.error)throw result.error;
  user=result.data.user||null;refreshPanel();
  msg(kind==='signup'&&!result.data.session?'Аккаунт создан. Проверь почту и подтверди адрес, затем войди.':'Вход выполнен. Локальные данные не переносились.');
 }catch(e){msg(e.message||'Ошибка авторизации',true)}
}
async function reset(){try{const c=await connect(),email=$('#nomi-cloud-email-input')?.value.trim();if(!email)throw Error('Сначала введи email.');const {error}=await c.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});if(error)throw error;msg('Ссылка для восстановления отправлена на почту.')}catch(e){msg(e.message||'Ошибка восстановления пароля',true)}}
async function logout(){try{if(!client)await connect();const {error}=await client.auth.signOut();if(error)throw error;user=null;refreshPanel();msg('Выход выполнен. Локальные данные остались на устройстве.')}catch(e){msg(e.message||'Ошибка выхода',true)}}
window.NOMICloud={getClient:connect,getUser:()=>user};
function mount(){
 const css=document.createElement('style');css.textContent=`.nomi-cloud-backdrop{position:fixed;inset:0;background:#29263188;z-index:10000;display:grid;place-items:center;padding:18px}.nomi-cloud-dialog{width:min(520px,100%);max-height:90vh;overflow:auto;background:#F8F5F0;color:#292631;padding:30px;border:1px solid #292631;box-shadow:12px 12px 0 #A88AE8;position:relative}.nomi-cloud-dialog>small{font:11px 'IBM Plex Mono',monospace;letter-spacing:.15em;color:#8F3155}.nomi-cloud-dialog h2{font:32px 'Cormorant Garamond',serif;margin:8px 0}.nomi-cloud-dialog label{display:block;margin:14px 0;font-size:13px}.nomi-cloud-dialog input{display:block;width:100%;padding:12px;margin-top:6px;border:1px solid #bcb2c3;background:white;font:inherit}.nomi-cloud-close{position:absolute;right:12px;top:10px;border:0;background:none;font-size:26px}.nomi-cloud-actions{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}.nomi-cloud-actions button{background:#C92F61;color:white;border:0;padding:11px 16px;font-weight:700}.nomi-cloud-actions button:disabled{opacity:.6;cursor:not-allowed}.nomi-cloud-actions .secondary,.nomi-cloud-link{background:transparent;color:#8F3155;border:1px solid #8F3155;padding:10px 14px}.nomi-cloud-link{border:0;padding:5px 0;text-decoration:underline}.nomi-cloud-note{font-size:12px;line-height:1.6;color:#65596d}.nomi-cloud-dialog [hidden]{display:none!important}#nomi-cloud-message{min-height:22px;font-size:13px;line-height:1.5}`;document.head.append(css);
 window.NOMIOpenCloudPanel=panel;
}
mount();
})();

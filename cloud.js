// Supabase backend: username + password accounts, automatic backup/sync across devices, shared recipes and unit data.
import * as cfg from './config.js';
export const enabled=!!(cfg.SUPABASE_URL&&cfg.SUPABASE_ANON_KEY);
// Supabase signs people in with an email, so a username becomes username@<domain>. No mail is ever sent
// (email confirmation must be OFF). Change AUTH_EMAIL_DOMAIN in config.js if Supabase rejects the default.
const domain=()=>cfg.AUTH_EMAIL_DOMAIN||'prepd.app';
const mail=u=>`${String(u).trim().toLowerCase()}@${domain()}`;
let sb=null,user=null,ready=null,lastError='';
export const isReady=()=>!!user;
export const signedIn=()=>!!user;
export const username=()=>user?.username||'';
export const getError=()=>lastError;
const keyOf=n=>String(n||'').toLowerCase().replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim().split(' ').map(w=>w.replace(/([bdgkjp])h/g,'$1').replace(/oo/g,'u').replace(/ee/g,'i').replace(/aa/g,'a').replace(/(.)\1+/g,'$1')).join(' ');
const hint=e=>{const m=String(e?.message||e||'');
  if(/register_account|username_available|schema cache|could not find the function|PGRST202/i.test(m))return 'The database is not set up yet. Run supabase.sql in the Supabase SQL Editor.';
  if(/invalid api key|apikey|jwt/i.test(m))return 'The Supabase URL or key in config.js looks wrong. Use the “anon public” key (starts with eyJ).';
  if(/failed to fetch|networkerror|load failed|import/i.test(m))return 'Can’t reach Supabase. Check the URL in config.js and your connection.';
  return m||'Something went wrong. Please try again.';};
const authMsg=e=>{const m=String(e?.message||'');
  if(/invalid login|invalid credentials/i.test(m))return 'Wrong username or password.';
  if(/already|registered/i.test(m))return 'That username is taken. Try another.';
  if(/email.*(invalid|not allowed)|invalid.*email/i.test(m))return 'Supabase rejected the sign-up address. Set AUTH_EMAIL_DOMAIN in config.js to a domain you own.';
  if(/rate limit|too many/i.test(m))return 'Too many attempts. Please wait a minute and try again.';
  if(/weak|password/i.test(m))return 'Choose a stronger password (at least 8 characters).';
  return hint(e);};
async function loadUser(u,name){
  if(!u){user=null;try{localStorage.removeItem('prepd_username')}catch{}return}
  let uname=name||u.user_metadata?.username||'';
  if(!uname){const r=await sb.rpc('register_account',{p_username:u.email.split('@')[0]});if(!r.error)uname=r.data}
  user={id:u.id,username:uname||u.email.split('@')[0]};
  try{localStorage.setItem('prepd_username',user.username)}catch{}
}
// Sets up the client. Returns true when Supabase is reachable (signed in or not).
export function init(){
  if(!enabled)return Promise.resolve(false);
  return ready||(ready=(async()=>{
    try{
      lastError='';
      const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
      sb=createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true}});
      const {data:{session}}=await sb.auth.getSession();
      if(session&&session.user.is_anonymous)await sb.auth.signOut({scope:'local'});   // left over from the old device-id sign-in
      else if(session)await loadUser(session.user);
      return true;
    }catch(e){console.warn('Cloud unavailable',e);ready=null;lastError=hint(e);return false}
  })());
}
// ---- accounts
const checkName=u=>{if(!/^[A-Za-z0-9_]{3,20}$/.test(u))throw new Error('Usernames use 3–20 letters, numbers or underscores.')};
export async function usernameFree(name){
  await init();if(!sb)return null;
  const u=String(name).trim();if(!/^[A-Za-z0-9_]{3,20}$/.test(u))return null;
  const {data,error}=await sb.rpc('username_available',{p_name:u});return error?null:!!data;
}
export async function signUp(name,password){
  await init();if(!sb)throw new Error('Accounts need the cloud backend, which isn’t set up.');
  const u=String(name).trim();checkName(u);
  if(String(password).length<8)throw new Error('Use a password with at least 8 characters.');
  if(await usernameFree(u)===false)throw new Error('That username is taken. Try another.');
  const {data,error}=await sb.auth.signUp({email:mail(u),password,options:{data:{username:u}}});
  if(error)throw new Error(authMsg(error));
  if(!data.session){throw new Error('Sign-up needs “Confirm email” switched off in Supabase (Authentication → Sign In / Providers → Email).')}
  const r=await sb.rpc('register_account',{p_username:u});
  if(r.error){await sb.auth.signOut({scope:'local'});throw new Error(/taken/i.test(r.error.message)?'That username is taken. Try another.':hint(r.error))}
  await loadUser(data.user,r.data);return user.username;
}
export async function signIn(name,password){
  await init();if(!sb)throw new Error('Sign-in needs the cloud backend, which isn’t set up.');
  const u=String(name).trim();checkName(u);
  const {data,error}=await sb.auth.signInWithPassword({email:mail(u),password:String(password)});
  if(error)throw new Error(authMsg(error));
  await loadUser(data.user);return user.username;
}
export async function signOut(){
  if(sb)await sb.auth.signOut({scope:'local'}).catch(()=>{});
  user=null;['prepd_username','prepd_pushed','prepd_dirty'].forEach(k=>{try{localStorage.removeItem(k)}catch{}});
}
export async function verifyPassword(password){
  if(!user)throw new Error('You’re not signed in.');
  const {error}=await sb.auth.signInWithPassword({email:mail(user.username),password:String(password)});
  if(error)throw new Error('Wrong password.');
}
// How many recipes this account shared, and how many of those nobody else has saved yet.
export async function sharedCounts(){
  if(!user)return {total:0,unused:0};
  const {data,error}=await sb.rpc('my_shared_counts');if(error)return {total:0,unused:0};
  const r=Array.isArray(data)?data[0]:data;return {total:r?.total||0,unused:r?.unused||0};
}
export async function deleteAccount(password,deleteShared){
  await verifyPassword(password);
  const {error}=await sb.rpc('delete_my_account',{p_delete_shared:!!deleteShared});
  if(error)throw new Error(hint(error));
  await signOut();
}
// ---- backup & sync (whole-app snapshot, last write wins)
export async function push(json){
  if(!user)return false;
  const ts=new Date().toISOString();
  const {error}=await sb.from('user_data').upsert({user_id:user.id,data:JSON.parse(json),updated_at:ts});
  if(error){console.warn('push',error);return false}
  localStorage.setItem('prepd_pushed',String(Date.parse(ts)));localStorage.removeItem('prepd_dirty');return true;
}
export async function pull(){
  if(!user)return null;
  const {data,error}=await sb.from('user_data').select('data,updated_at').eq('user_id',user.id).maybeSingle();
  if(error){console.warn('pull',error);return null}
  return data;
}
// On launch: push if this device has unsynced edits, otherwise take a newer copy from another device.
export async function pullIfNewer(importFn){
  if(!user)return 'off';
  if(localStorage.getItem('prepd_dirty'))return 'dirty';
  const r=await pull();
  if(!r)return 'dirty';
  const last=+localStorage.getItem('prepd_pushed')||0,t=Date.parse(r.updated_at);
  if(t>last+1500){await importFn(r.data);localStorage.setItem('prepd_pushed',String(t));return 'pulled'}
  return 'same';
}
// ---- shared knowledge (anonymous to other users)
export async function shareRecipe(name,ingredients,servings,sourceUrl,steps=[]){
  if(!user||!name||ingredients.length<2||ingredients.length>60)return;
  const slim=ingredients.map(i=>({name:i.name,qty:i.qty,unit:i.unit,macros:i.macros,taste:!!i.taste,d:i.d??null,pc:i.pc??null}));
  const row={name:name.slice(0,80),name_key:keyOf(name),ingredients:slim,servings:servings||1,source_url:sourceUrl||null,created_by:user.id};
  const r=await sb.from('recipes_public').insert({...row,steps:(steps||[]).slice(0,60)});
  if(r.error)await sb.from('recipes_public').insert(row);
}
export async function findCommunity(name){
  if(!sb)return null;
  const key=keyOf(name);
  let q=await sb.from('recipes_public').select('id,name,ingredients,servings,steps').eq('name_key',key).order('created_at',{ascending:false}).limit(5);
  if(q.error)q=await sb.from('recipes_public').select('id,name,ingredients,servings').eq('name_key',key).order('created_at',{ascending:false}).limit(5);
  const r=(q.data||[]).find(x=>Array.isArray(x.ingredients)&&x.ingredients.length>=3);
  return r?{id:r.id,title:r.name,yield:r.servings||1,steps:Array.isArray(r.steps)?r.steps:[],items:r.ingredients.map(i=>({...i,staple:false,display:`${i.qty} ${i.unit} ${i.name}`}))}:null;
}
// Called when someone saves another person's shared recipe, so it is never deleted along with its author's account.
export async function useRecipe(id){if(user&&id)try{await sb.rpc('use_recipe',{p_id:id})}catch{}}
export async function contributeCorrection(line,result){if(user)try{await sb.rpc('contribute_correction',{p_line:line,p_result:result})}catch{}}
export async function getCorrections(keys){
  if(!sb||!keys.length)return {};
  const {data,error}=await sb.from('parse_corrections').select('line_key,result,n').in('line_key',keys.slice(0,60)).gte('n',2).order('n',{ascending:false});
  if(error)return {};
  const out={};for(const r of data||[])if(!out[r.line_key])out[r.line_key]=r.result;
  return out;
}
export async function getProfile(key){
  if(!sb)return null;
  const {data}=await sb.from('unit_profiles').select('pc,d').eq('name_key',key).maybeSingle();
  return data&&(data.pc||data.d)?{pc:data.pc?+data.pc:null,d:data.d?+data.d:null,src:'community'}:null;
}
export async function contributeProfile(key,pc,d){if(user)try{await sb.rpc('contribute_profile',{p_key:key,p_pc:pc||null,p_d:d||null})}catch{}}
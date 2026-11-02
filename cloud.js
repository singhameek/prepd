// Supabase backend: device identity (anonymous auth), backup/sync, device transfer codes, shared recipes and unit data.
import {SUPABASE_URL,SUPABASE_ANON_KEY} from './config.js';
export const enabled=!!(SUPABASE_URL&&SUPABASE_ANON_KEY);
let sb=null,userId=null,ready=null,lastError='';
export const getError=()=>lastError;
export const isReady=()=>!!userId;
export const supportId=()=>userId?userId.slice(0,8):'';
// Same key for spelling variants ("aloo gobhi" = "aloo gobi") so shared recipes are found either way.
const keyOf=n=>String(n||'').toLowerCase().replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim().split(' ').map(w=>w.replace(/([bdgkjp])h/g,'$1').replace(/oo/g,'u').replace(/ee/g,'i').replace(/aa/g,'a').replace(/(.)\1+/g,'$1')).join(' ');
// Turns common Supabase setup mistakes into plain-language hints.
const hint=e=>{const m=String(e?.message||e||'');
  if(/anonymous/i.test(m)&&/disabled|not enabled|allowed/i.test(m))return 'Anonymous sign-ins are switched off. In Supabase: Authentication → Sign In / Providers → turn on “Allow anonymous sign-ins”.';
  if(/register_device|schema cache|could not find the function|PGRST202/i.test(m))return 'The database functions are missing. Run supabase.sql in the Supabase SQL Editor.';
  if(/invalid api key|apikey|jwt/i.test(m))return 'The Supabase URL or key in config.js looks wrong. Use the “anon public” key (starts with eyJ).';
  if(/failed to fetch|networkerror|load failed|import/i.test(m))return 'Can’t reach Supabase. Check the URL in config.js and your connection.';
  return m||'Unknown error';};
const fail=e=>{throw new Error(e?.message||'Cloud request failed')};
// Each device signs in anonymously (no email or password) and is registered to one account.
export function init(){
  if(!enabled)return Promise.resolve(false);
  return ready||(ready=(async()=>{
    try{
      const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
      sb=createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true}});
      const {data:{session}}=await sb.auth.getSession();
      if(!session){const r=await sb.auth.signInAnonymously();if(r.error)throw r.error}
      const r=await sb.rpc('register_device');if(r.error)throw r.error;
      userId=r.data;return true;
    }catch(e){lastError=hint(e);console.warn('Cloud unavailable:',lastError,e);ready=null;return false}
  })());
}
// ---- backup & sync (whole-app snapshot, last write wins)
export async function push(json){
  if(!userId)return false;
  const ts=new Date().toISOString();
  const {error}=await sb.from('user_data').upsert({user_id:userId,data:JSON.parse(json),updated_at:ts});
  if(error){console.warn('push',error);return false}
  localStorage.setItem('prepd_pushed',String(Date.parse(ts)));localStorage.removeItem('prepd_dirty');return true;
}
export async function pull(){
  if(!userId)return null;
  const {data,error}=await sb.from('user_data').select('data,updated_at').eq('user_id',userId).maybeSingle();
  if(error){console.warn('pull',error);return null}
  return data;
}
// On launch: push if this device has unsynced edits, otherwise take a newer copy from another device.
export async function pullIfNewer(importFn){
  if(!userId)return 'off';
  if(localStorage.getItem('prepd_dirty'))return 'dirty';
  const r=await pull();
  if(!r)return 'dirty'; // nothing in the cloud yet: upload this device's data
  const last=+localStorage.getItem('prepd_pushed')||0,t=Date.parse(r.updated_at);
  if(t>last+1500){await importFn(r.data);localStorage.setItem('prepd_pushed',String(t));return 'pulled'}
  return 'same';
}
// ---- moving to a new device
export async function createCode(){
  await init();const {data,error}=await sb.rpc('create_transfer_code');if(error)fail(error);return data;
}
export async function redeem(code,importFn){
  await init();if(!sb)throw new Error('Cloud backup is not set up.');
  const {data,error}=await sb.rpc('redeem_code',{p_code:String(code).replace(/\s+/g,'')});
  if(error)fail(error);if(!data)throw new Error('That code is invalid or has expired.');
  userId=data;const r=await pull();
  if(r?.data){await importFn(r.data);localStorage.setItem('prepd_pushed',String(Date.parse(r.updated_at)))}
  return true;
}
// ---- shared knowledge (anonymous)
export async function shareRecipe(name,ingredients,servings,sourceUrl,steps=[]){
  if(!userId||!name||ingredients.length<2||ingredients.length>60)return;
  const slim=ingredients.map(i=>({name:i.name,qty:i.qty,unit:i.unit,macros:i.macros,taste:!!i.taste,d:i.d??null,pc:i.pc??null}));
  const row={name:name.slice(0,80),name_key:keyOf(name),ingredients:slim,servings:servings||1,source_url:sourceUrl||null};
  const r=await sb.from('recipes_public').insert({...row,steps:(steps||[]).slice(0,60)});
  if(r.error)await sb.from('recipes_public').insert(row); // older database without the steps column
}
export async function findCommunity(name){
  if(!userId)return null;
  let q=await sb.from('recipes_public').select('name,ingredients,servings,steps').eq('name_key',keyOf(name)).order('created_at',{ascending:false}).limit(5);
  if(q.error)q=await sb.from('recipes_public').select('name,ingredients,servings').eq('name_key',keyOf(name)).order('created_at',{ascending:false}).limit(5);
  const r=(q.data||[]).find(x=>Array.isArray(x.ingredients)&&x.ingredients.length>=3);
  return r?{title:r.name,yield:r.servings||1,steps:Array.isArray(r.steps)?r.steps:[],items:r.ingredients.map(i=>({...i,staple:false,display:`${i.qty} ${i.unit} ${i.name}`}))}:null;
}
// ---- shared learning from user corrections (a fix is only used once 2+ devices agree)
export async function contributeCorrection(line,result){
  if(!userId)return;
  try{await sb.rpc('contribute_correction',{p_line:line,p_result:result})}catch{}
}
export async function getCorrections(keys){
  if(!userId||!keys.length)return {};
  const {data,error}=await sb.from('parse_corrections').select('line_key,result,n').in('line_key',keys.slice(0,60)).gte('n',2).order('n',{ascending:false});
  if(error)return {};
  const out={};for(const r of data||[])if(!out[r.line_key])out[r.line_key]=r.result;
  return out;
}
export async function getProfile(key){
  if(!userId)return null;
  const {data}=await sb.from('unit_profiles').select('pc,d').eq('name_key',key).maybeSingle();
  return data&&(data.pc||data.d)?{pc:data.pc?+data.pc:null,d:data.d?+data.d:null,src:'community'}:null;
}
export async function contributeProfile(key,pc,d){
  if(!userId)return;
  try{await sb.rpc('contribute_profile',{p_key:key,p_pc:pc||null,p_d:d||null})}catch{}
}
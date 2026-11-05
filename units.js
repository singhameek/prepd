// Per-ingredient unit data (grams per piece, grams per ml): learned from recipes, shared community data, or USDA on demand.
import {setProfiles,getProfiles,takeUnresolved,nk} from './inventoryEngine.js';
import {getProfile,contributeProfile} from './cloud.js';
import {db} from './db.js';
const save=()=>db.appSettings.put({key:'unitProfiles',value:getProfiles()});
export async function loadProfiles(){setProfiles((await db.appSettings.get('unitProfiles'))?.value||{})}
// Remember densities / piece weights seen while parsing recipes, and share them anonymously.
export async function learn(items,share=true){
  const p={...getProfiles()};let ch=false;
  for(const i of items){
    const k=nk(i.name),cur=p[k]||{},pc=i.pc&&!cur.pc?i.pc:null,d=i.d&&!cur.d?i.d:null;
    if(pc||d){p[k]={...cur,...(pc&&{pc}),...(d&&{d}),src:cur.src||'recipe'};ch=true;if(share)contributeProfile(k,pc,d)}
  }
  if(ch){setProfiles(p);await save()}
}
const limit=(p,ms)=>Promise.race([p,new Promise(r=>setTimeout(()=>r(null),ms))]);   // never wait long on the network
async function usda(k){
  try{
    const c=new AbortController(),t=setTimeout(()=>c.abort(),4000);
    const r=await fetch('/api/units?name='+encodeURIComponent(k),{signal:c.signal});clearTimeout(t);
    if(!r.ok)return null;const j=await r.json();return j.found?{pc:j.pc,d:j.d,src:'usda'}:null;
  }catch{return null}
}
// Looks up anything the engine had to guess (e.g. a pantry item counted in pcs): community data first, then USDA.
// Runs in the background (never while the user waits); lookups happen in parallel.
export async function resolveUnits(){
  const names=takeUnresolved().slice(0,8);if(!names.length)return false;
  const p={...getProfiles()};let changed=false;
  await Promise.all(names.map(async k=>{
    if(p[k]?.tried)return;
    let r=await limit(getProfile(k),2500),fresh=false;
    if(!r){r=await usda(k);fresh=!!r}
    if(r&&(r.pc||r.d)){p[k]={...p[k],...(r.pc&&{pc:r.pc}),...(r.d&&{d:r.d}),src:r.src};changed=true;if(fresh)contributeProfile(k,r.pc,r.d)}
    else p[k]={...p[k],tried:1};
  }));
  setProfiles(p);await save();return changed;
}
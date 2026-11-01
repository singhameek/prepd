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
async function usda(k){
  try{const r=await fetch('/api/units?name='+encodeURIComponent(k));if(!r.ok)return null;const j=await r.json();return j.found?{pc:j.pc,d:j.d,src:'usda'}:null}catch{return null}
}
// Looks up anything the engine had to guess (e.g. a pantry item counted in pcs): community data first, then USDA.
export async function resolveUnits(){
  const names=takeUnresolved();if(!names.length)return false;
  const p={...getProfiles()};let changed=false;
  for(const k of names){
    if(p[k]?.tried)continue;
    let r=await getProfile(k),fresh=false;
    if(!r){r=await usda(k);fresh=!!r}
    if(r&&(r.pc||r.d)){p[k]={...p[k],...(r.pc&&{pc:r.pc}),...(r.d&&{d:r.d}),src:r.src};changed=true;if(fresh)contributeProfile(k,r.pc,r.d)}
    else p[k]={...p[k],tried:1};
  }
  setProfiles(p);await save();return changed;
}
// Self-learning from user corrections. When someone fixes a parsed ingredient (name, amount, unit, or removes it),
// the fix is remembered on this device and applied the next time the same line appears. Fixes are also shared
// anonymously; a shared fix is only used once at least two different devices agree on it.
import {db} from './db.js';
import * as cloud from './cloud.js';
import {toGrams} from './inventoryEngine.js';
const KEY='parseCorrections';
let st={lines:{},names:{}},shared={};
const lk=l=>String(l||'').toLowerCase().replace(/\s+/g,' ').trim();
export async function loadCorrections(){const v=(await db.appSettings.get(KEY))?.value;st=v&&v.lines?v:{lines:{},names:{}}}
const save=()=>db.appSettings.put({key:KEY,value:st});
// Fetch agreed corrections other users made for these lines (one request; silently skipped when offline).
export async function prefetch(lines){
  const keys=[...new Set(lines.map(lk))].filter(k=>k&&!(k in shared)&&!st.lines[k]);
  if(!keys.length||!cloud.isReady())return;
  try{const got=await cloud.getCorrections(keys);for(const k of keys)shared[k]=got[k]||null}catch{}
}
const scale=(m,s)=>Object.fromEntries(Object.entries(m||{}).map(([k,v])=>[k,Math.round(v*s*10)/10]));
// Applies what was learned to freshly parsed items of one input line.
export function apply(line,items){
  const c=st.lines[lk(line)]||shared[lk(line)];let out=items;
  if(c)out=items.filter(i=>!(c.drop||[]).includes(i.name)).map(i=>{
    const m=(c.items||[]).find(x=>x.from===i.name);
    return m?{...i,name:m.name,qty:m.qty,unit:m.unit,macros:scale(i.macros,m.scale??1)}:i});
  return out.map(i=>st.names[i.name]?{...i,name:st.names[i.name]}:i);
}
// final: items the user kept (each has .orig = what the parser produced); removed: items the user deleted.
export async function learn(final,removed=[]){
  const by={},drop={};
  for(const i of final)if(i.orig&&i.display)(by[lk(i.display)]||=[]).push(i);
  for(const i of removed)if(i.orig&&i.display)(drop[lk(i.display)]||=[]).push(i.orig.name);
  let changed=false;
  for(const k of new Set([...Object.keys(by),...Object.keys(drop)])){
    const ch=(by[k]||[]).filter(i=>i.name!==i.orig.name||i.unit!==i.orig.unit||Math.abs(i.qty-i.orig.qty)>1e-6);
    const dr=drop[k]||[];
    if(!ch.length&&!dr.length)continue;
    const items=ch.map(i=>{const g0=toGrams(i.orig.qty,i.orig.unit,i.orig.name),g1=toGrams(i.qty,i.unit,i.name);
      return {from:i.orig.name,name:i.name,qty:i.qty,unit:i.unit,scale:g0>0?Math.round(g1/g0*1000)/1000:1}});
    const result={items,drop:dr};
    st.lines[k]=result;changed=true;
    for(const i of ch)if(i.name!==i.orig.name)st.names[i.orig.name]=i.name;
    cloud.contributeCorrection(k,result);
  }
  if(changed)await save();
}
export const stats=()=>({lines:Object.keys(st.lines).length,names:Object.keys(st.names).length});
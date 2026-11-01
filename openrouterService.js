import {isStaple} from './inventoryEngine.js';
// Parse compact rows ["name",qty,"unit",kcal,p,c,f,always] from a reply, tolerating fences, prose and truncation.
function rows(t){
  const out=[];
  for(const m of t.matchAll(/\[\s*"[^\[\]]*\]/g)){try{const a=JSON.parse(m[0]);if(a.length>=7&&Number(a[1])>=0)out.push(a)}catch{}}
  return out;
}
class Retry extends Error{}
async function call(text){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),50000);
  try{
    const res=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text}),signal:c.signal});
    const j=await res.json().catch(()=>({}));
    if(res.status===404&&!j.error)throw new Error('AI endpoint not found (/api/chat). The server function is not deployed.');
    if(!res.ok){const m=typeof j.error==='string'?j.error:`Service error (${res.status}).`;
      if(res.status>=500||res.status===408)throw new Retry(m);throw new Error(m)}
    const m=j.choices?.[0]?.message||{};return m.content||m.reasoning||'';
  }catch(e){if(e.name==='AbortError')throw new Retry('The AI took too long.');throw e}
  finally{clearTimeout(t)}
}
// Remember parsed lines on this device so repeated ingredients ("1 tsp salt") skip the AI entirely.
let cache={};try{cache=JSON.parse(localStorage.getItem('pcache')||'{}')}catch{}
const keep=()=>{try{const k=Object.keys(cache);if(k.length>2000)k.slice(0,500).forEach(x=>delete cache[x]);localStorage.setItem('pcache',JSON.stringify(cache))}catch{}};
const U=['g','ml','pcs','tsp','tbsp','cup'];
const item=(a,disp)=>({staple:a[7]==1,name:String(a[0]).toLowerCase(),qty:+a[1]||1,unit:U.includes(a[2])?a[2]:'g',display:disp,
  macros:{calories:+a[3]||0,protein:+a[4]||0,carbs:+a[5]||0,fat:+a[6]||0}});
async function chunk(lines){
  let best=[],err;
  for(let t=0;t<3;t++){
    try{
      const r=rows(await call(lines.join('\n')));
      if(r.length>best.length)best=r;
      if(r.length>=lines.length)break; // at least one entry per line
    }catch(e){err=e;if(!(e instanceof Retry))throw e}
  }
  if(!best.length)throw err||new Error('Could not read those ingredients. Please try again.');
  const exact=best.length===lines.length;
  if(exact){lines.forEach((l,k)=>{cache[l.toLowerCase()]=best[k]});keep()}
  return best.map((a,k)=>item(a,exact?lines[k]:''));
}
// Cached lines are instant; the rest go out in small parallel chunks (much faster than one big reply).
export async function parseIngredients(text){
  const lines=text.split('\n').map(s=>s.trim()).filter(Boolean),jobs=[];let buf=[];
  const flush=()=>{if(buf.length){jobs.push(chunk(buf));buf=[]}};
  for(const l of lines){
    const hit=cache[l.toLowerCase()];
    if(hit){flush();jobs.push(Promise.resolve([item(hit,l)]))}
    else{buf.push(l);if(buf.length>=3)flush()}
  }
  flush();
  return (await Promise.all(jobs)).flat().filter(i=>!isStaple(i));
}
import {isStaple} from './inventoryEngine.js';
// Parse compact rows ["name",qty,"unit",kcal,p,c,f,always] from a reply, tolerating fences, prose and truncation.
function rows(t){
  const out=[];
  for(const m of t.matchAll(/\[\s*"[^\[\]]*\]/g)){try{const a=JSON.parse(m[0]);if(a.length>=7&&Number(a[1])>=0)out.push(a)}catch{}}
  return out;
}
async function call(text){
  const res=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
  const j=await res.json().catch(()=>({}));
  if(res.status===404&&!j.error)throw new Error('AI endpoint not found (/api/chat). The server function is not deployed.');
  if(!res.ok)throw new Error(typeof j.error==='string'?j.error:`Service error (${res.status}). Try again.`);
  const m=j.choices?.[0]?.message||{};return m.content||m.reasoning||'';
}
const U=['g','ml','pcs','tsp','tbsp','cup'];
async function chunk(lines){
  let best=[];
  for(let t=0;t<2;t++){
    try{
      const r=rows(await call(lines.join('\n')));
      if(r.length>best.length)best=r;
      if(r.length>=lines.length)break; // got at least one entry per line
    }catch(e){if(t||!/Could not/.test(e.message))throw e}
  }
  if(!best.length)throw new Error('Could not read those ingredients. Please try again.');
  return best.map((a,k)=>({staple:a[7]==1,name:String(a[0]).toLowerCase(),qty:+a[1]||1,unit:U.includes(a[2])?a[2]:'g',
    display:best.length===lines.length?lines[k]:'',macros:{calories:+a[3]||0,protein:+a[4]||0,carbs:+a[5]||0,fat:+a[6]||0}}));
}
// Long lists are split into small chunks and parsed in parallel (much faster than one big reply).
export async function parseIngredients(text){
  const lines=text.split('\n').map(s=>s.trim()).filter(Boolean),parts=[];
  for(let i=0;i<lines.length;i+=4)parts.push(lines.slice(i,i+4));
  const res=(await Promise.all(parts.map(chunk))).flat().filter(i=>!isStaple(i));
  return res;
}
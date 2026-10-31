import {isStaple} from './inventoryEngine.js';
// Calls the server proxy (/api/chat), which holds the API key and fixed model.
// Pull every complete ingredient object out of the reply, tolerating fences, prose and truncation.
function salvage(t){const out=[],st=[];let str=0,esc=0;
  for(let i=0;i<t.length;i++){const c=t[i];
    if(str){if(esc)esc=0;else if(c==='\\')esc=1;else if(c==='"')str=0;continue}
    if(c==='"')str=1;else if(c==='{')st.push(i);
    else if(c==='}'&&st.length){const a=st.pop();try{const o=JSON.parse(t.slice(a,i+1));if(o&&o.canonical_name)out.push(o)}catch{}}}
  return out}
export async function parseIngredients(text){
  try{return await parseOnce(text)}catch(e){if(/Could not read/.test(e.message))return parseOnce(text);throw e}}
async function parseOnce(text){
  const res=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
  const j=await res.json().catch(()=>({}));
  if(res.status===404&&!j.error)throw new Error('AI endpoint not found (/api/chat). The server function is not deployed.');
  if(!res.ok)throw new Error(typeof j.error==='string'?j.error:`Service error (${res.status}). Try again.`);
  const msg=j.choices?.[0]?.message||{},raw=msg.content||msg.reasoning||'';
  const list=salvage(raw).filter(i=>i.canonical_name&&Number(i.metric_quantity)>0);
  if(!list.length)throw new Error('Could not read those ingredients. Please try again.');
  return list.map(i=>({staple:i.always_available===true,name:String(i.canonical_name).toLowerCase(),qty:+i.metric_quantity,
    unit:['g','ml','pcs'].includes(i.metric_unit)?i.metric_unit:'g',display:i.ui_fractional_display||'',
    macros:{calories:+i.estimated_macros?.calories||0,protein:+i.estimated_macros?.protein||0,carbs:+i.estimated_macros?.carbs||0,fat:+i.estimated_macros?.fat||0}})).filter(i=>!isStaple(i));
}
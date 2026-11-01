import {isStaple} from './inventoryEngine.js';
// Pull every complete ingredient object out of a reply, tolerating fences, prose and truncation.
function salvage(t){const out=[],st=[];let str=0,esc=0;
  for(let i=0;i<t.length;i++){const c=t[i];
    if(str){if(esc)esc=0;else if(c==='\\')esc=1;else if(c==='"')str=0;continue}
    if(c==='"')str=1;else if(c==='{')st.push(i);
    else if(c==='}'&&st.length){const a=st.pop();try{const o=JSON.parse(t.slice(a,i+1));if(o&&o.canonical_name)out.push(o)}catch{}}}
  return out}
const norm=list=>list.filter(i=>i.canonical_name&&Number(i.metric_quantity)>0).map(i=>({staple:i.always_available===true,
  name:String(i.canonical_name).toLowerCase(),qty:+i.metric_quantity,unit:['g','ml','pcs'].includes(i.metric_unit)?i.metric_unit:'g',
  display:i.ui_fractional_display||'',macros:{calories:+i.estimated_macros?.calories||0,protein:+i.estimated_macros?.protein||0,carbs:+i.estimated_macros?.carbs||0,fat:+i.estimated_macros?.fat||0}})).filter(i=>!isStaple(i));
async function call(body){
  const res=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const j=await res.json().catch(()=>({}));
  if(res.status===404&&!j.error)throw new Error('AI endpoint not found (/api/chat). The server function is not deployed.');
  if(!res.ok)throw new Error(typeof j.error==='string'?j.error:`Service error (${res.status}). Try again.`);
  const msg=j.choices?.[0]?.message||{};return msg.content||msg.reasoning||'';
}
const retry=async f=>{try{return await f()}catch(e){if(/Could not/.test(e.message))return f();throw e}};
export const parseIngredients=text=>retry(async()=>{
  const list=norm(salvage(await call({text})));
  if(!list.length)throw new Error('Could not read those ingredients. Please try again.');
  return list});
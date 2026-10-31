// Calls the server proxy (/api/chat), which holds the API key and fixed model.
export async function parseIngredients(text){
  const res=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
  const j=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(j.error||`Service error (${res.status}). Try again.`);
  const raw=j.choices?.[0]?.message?.content||'';
  const m=raw.match(/\{[\s\S]*\}/);
  let o;try{o=JSON.parse(m?m[0]:raw)}catch{throw new Error('Could not read that. Try listing one ingredient per line.')}
  const list=(o.ingredients||[]).filter(i=>i.canonical_name&&Number(i.metric_quantity)>0);
  if(!list.length)throw new Error('No ingredients found. Try listing one per line.');
  return list.map(i=>({name:String(i.canonical_name).toLowerCase(),qty:+i.metric_quantity,
    unit:['g','ml','pcs'].includes(i.metric_unit)?i.metric_unit:'g',display:i.ui_fractional_display||'',
    macros:{calories:+i.estimated_macros?.calories||0,protein:+i.estimated_macros?.protein||0,carbs:+i.estimated_macros?.carbs||0,fat:+i.estimated_macros?.fat||0}}));
}
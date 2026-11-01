// Vercel serverless proxy. Key and model are fixed server-side; clients only send ingredient text.
const MODEL='nvidia/nemotron-3.5-lightning:free';
const ING=`{"canonical_name":"lowercase singular name","original_phrase":"as written","metric_quantity":number,"metric_unit":"g"|"ml"|"pcs","ui_fractional_display":"friendly amount like '~9/10ths of a jug', '¾ full', 'half a block'","always_available":true|false,"estimated_macros":{"calories":number,"protein":number,"carbs":number,"fat":number}}`;
const RULES=`Set always_available true ONLY for free on-demand household items every home has: tap water and ice. Everything else (salt, oil, spices, etc.) is false. Include EVERY ingredient as its own array item. Convert vague amounts (splash, handful, pinch, cloves) to realistic metric estimates; use pcs for countable items. estimated_macros are for the whole quantity listed. Many recipes are South Asian: understand ghee, paneer, atta, besan, dal varieties, jeera, haldi, hing, garam masala, curry leaves, etc., and use their common English or commonly used names. Use 1 cup=240 ml, 1 tbsp=15 ml, 1 tsp=5 ml; 'to taste' means a small realistic amount (e.g. salt 3 g); '1 inch ginger' is about 5 g.`;
const PARSE=`You convert recipe ingredient text into JSON. Reply with ONLY a JSON object, no prose, no code fences:\n{"ingredients":[${ING}]}\n${RULES}`;
const hits=new Map();
module.exports=async(req,res)=>{
  if(req.method==='GET')return res.status(200).json({ok:true,keySet:!!process.env.OPENROUTER_API_KEY});
  if(req.method!=='POST')return res.status(405).json({error:'POST only'});
  const ip=(req.headers['x-forwarded-for']||'').split(',')[0]||'x',now=Date.now();
  const h=(hits.get(ip)||[]).filter(t=>now-t<36e5);
  if(h.length>=40)return res.status(429).json({error:'Too many requests. Try again later.'});
  h.push(now);hits.set(ip,h);
  const input=String(req.body?.text||'').slice(0,4000);
  if(!input.trim())return res.status(400).json({error:'Add some ingredients first.'});
  try{
    const r=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',
      headers:{Authorization:`Bearer ${process.env.OPENROUTER_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({model:MODEL,temperature:0,max_tokens:8000,response_format:{type:'json_object'},reasoning:{effort:'low'},
        messages:[{role:'system',content:PARSE},{role:'user',content:input}]})});
    const body=await r.text();
    if(!r.ok){let msg;try{const e=JSON.parse(body).error;msg=e?.message||e}catch{}
      console.error('OpenRouter',r.status,body.slice(0,500));
      return res.status(502).json({error:`AI service error (${r.status}): ${String(msg||'unknown').slice(0,200)}`})}
    res.status(200).setHeader('Content-Type','application/json').send(body);
  }catch{res.status(502).json({error:'Service unreachable. Try again.'})}
};
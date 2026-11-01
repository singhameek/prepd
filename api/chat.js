// Vercel serverless proxy. Key and model are fixed server-side; clients only send ingredient text.
const MODEL='nvidia/nemotron-3.5-lightning:free';
const PARSE=`You convert recipe ingredient lines into compact JSON. Reply with ONLY this JSON, no prose, no code fences:
{"i":[["name",qty,"unit",kcal,protein,carbs,fat,always]]}
Every input line MUST produce at least one entry; never skip an ingredient. Give one entry per input line, in the same order (a line listing several ingredients gives several entries). name: lowercase singular common name. qty: a number in that unit. unit: "g", "ml", "pcs", "tsp", "tbsp" or "cup". Keep the recipe\'s own tsp, tbsp or cup unit when it uses one (write fractions as decimals, e.g. 1/2 cup = 0.5); use g for weighed items, ml for other liquids, pcs for countable items. kcal/protein/carbs/fat are for the whole quantity. always: 1 only for tap water or ice, otherwise 0 (salt, oil, spices are 0).
Convert vague amounts (splash, handful, pinch, cloves, to taste) to realistic amounts. Many recipes are South Asian: understand ghee, paneer, atta, besan, dal varieties, jeera, haldi, hing, garam masala, curry leaves etc. (1 cup=240 ml, 1 tbsp=15 ml, 1 tsp=5 ml, for macro estimates); "to taste" means a small amount (salt 3 g); "1 inch ginger" is about 5 g.`;
const hits=new Map();
module.exports=async(req,res)=>{
  if(req.method==='GET')return res.status(200).json({ok:true,keySet:!!process.env.OPENROUTER_API_KEY});
  if(req.method!=='POST')return res.status(405).json({error:'POST only'});
  const ip=(req.headers['x-forwarded-for']||'').split(',')[0]||'x',now=Date.now();
  const h=(hits.get(ip)||[]).filter(t=>now-t<36e5);
  if(h.length>=150)return res.status(429).json({error:'Too many requests. Try again later.'});
  h.push(now);hits.set(ip,h);
  const input=String(req.body?.text||'').slice(0,2000);
  if(!input.trim())return res.status(400).json({error:'Add some ingredients first.'});
  try{
    const r=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',
      headers:{Authorization:`Bearer ${process.env.OPENROUTER_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({model:MODEL,temperature:0,response_format:{type:'json_object'},reasoning:{enabled:false},
        messages:[{role:'system',content:PARSE},{role:'user',content:input}]})});
    const body=await r.text();
    if(!r.ok){let msg;try{const e=JSON.parse(body).error;msg=e?.message||e}catch{}
      console.error('OpenRouter',r.status,body.slice(0,500));
      return res.status(502).json({error:`AI service error (${r.status}): ${String(msg||'unknown').slice(0,200)}`})}
    res.status(200).setHeader('Content-Type','application/json').send(body);
  }catch{res.status(502).json({error:'Service unreachable. Try again.'})}
};
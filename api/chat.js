// Vercel serverless proxy. Key and model are fixed server-side; clients only send ingredient text.
const MODEL='nvidia/nemotron-3.5-lightning:free';
const SYSTEM=`You convert recipe ingredient text into JSON. Reply with ONLY a JSON object, no prose, no code fences:
{"ingredients":[{"canonical_name":"lowercase singular name","metric_quantity":number,"metric_unit":"g"|"ml"|"pcs","ui_fractional_display":"friendly amount like '~9/10ths of a jug', '¾ full', 'half a block'","estimated_macros":{"calories":number,"protein":number,"carbs":number,"fat":number}}]}
Include EVERY ingredient as its own array item, even when several are on one line or separated by commas, 'and', or spaces. Convert vague amounts (splash, handful, pinch) to realistic metric estimates. Use pcs for countable items. Macros are for the whole quantity listed.`;
const hits=new Map();
module.exports=async(req,res)=>{
  if(req.method==='GET')return res.status(200).json({ok:true,keySet:!!process.env.OPENROUTER_API_KEY});
  if(req.method!=='POST')return res.status(405).json({error:'POST only'});
  const ip=(req.headers['x-forwarded-for']||'').split(',')[0]||'x',now=Date.now();
  const h=(hits.get(ip)||[]).filter(t=>now-t<36e5);
  if(h.length>=40)return res.status(429).json({error:'Too many requests. Try again later.'});
  h.push(now);hits.set(ip,h);
  const text=String(req.body?.text||'').slice(0,4000);
  if(!text.trim())return res.status(400).json({error:'Add some ingredients first.'});
  try{
    const r=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',
      headers:{Authorization:`Bearer ${process.env.OPENROUTER_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({model:MODEL,temperature:0,max_tokens:8000,response_format:{type:'json_object'},reasoning:{effort:'low'},
        messages:[{role:'system',content:SYSTEM},{role:'user',content:text}]})});
    const body=await r.text();
    if(!r.ok){let msg;try{const e=JSON.parse(body).error;msg=e?.message||e}catch{}
      console.error('OpenRouter',r.status,body.slice(0,500));
      return res.status(502).json({error:`AI service error (${r.status}): ${String(msg||'unknown').slice(0,200)}`})}
    res.status(200).setHeader('Content-Type','application/json').send(body);
  }catch{res.status(502).json({error:'Service unreachable. Try again.'})}
};
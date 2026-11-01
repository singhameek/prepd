// Looks up grams-per-piece and grams-per-ml for an ingredient from USDA FoodData Central (server-side).
// Set USDA_API_KEY in Vercel (free at fdc.nal.usda.gov/api-key-signup); DEMO_KEY works but is tightly rate limited.
const hits=new Map();
module.exports=async(req,res)=>{
  const ip=(req.headers['x-forwarded-for']||'').split(',')[0]||'x',now=Date.now();
  const h=(hits.get(ip)||[]).filter(t=>now-t<6e4);
  if(h.length>=20)return res.status(429).json({error:'Too many requests'});
  h.push(now);hits.set(ip,h);
  const q=String(req.query.name||'').toLowerCase().replace(/[^a-z ]/g,' ').trim().slice(0,60);
  if(!q)return res.status(400).json({error:'Missing name'});
  const key=process.env.USDA_API_KEY||'DEMO_KEY',sig=()=>AbortSignal.timeout(7000);
  try{
    const s=await (await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(q)}&dataType=Foundation,SR%20Legacy&pageSize=5&api_key=${key}`,{signal:sig()})).json();
    const word=q.split(' ').pop();
    const f=(s.foods||[]).find(x=>String(x.description).toLowerCase().includes(word));
    if(!f)return res.status(200).json({found:false});
    const d=await (await fetch(`https://api.nal.usda.gov/fdc/v1/food/${f.fdcId}?api_key=${key}`,{signal:sig()})).json();
    let pc=null,dens=null;
    const ports=(d.foodPortions||[]).map(p=>({g:p.gramWeight/(p.amount||1),t:`${p.modifier||''} ${p.portionDescription||''} ${p.measureUnit?.name||''}`.toLowerCase()})).filter(p=>p.g>0);
    for(const [re,div] of [[/\bcup\b/,240],[/\btbsp\b|tablespoon/,15],[/\btsp\b|teaspoon/,5]]){const p=ports.find(x=>re.test(x.t));if(p){dens=p.g/div;break}}
    for(const re of [/medium/,/\beach\b|\bwhole\b/,/large/,/small/]){const p=ports.find(x=>re.test(x.t)&&!/slice|cup|tbsp|tsp|chunk|oz\b|strip/.test(x.t));if(p){pc=p.g;break}}
    res.setHeader('Cache-Control','s-maxage=86400');
    res.status(200).json({found:!!(pc||dens),pc:pc?Math.round(pc*10)/10:null,d:dens?Math.round(dens*1000)/1000:null,desc:f.description});
  }catch{res.status(200).json({found:false})}
};
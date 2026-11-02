// Tiny allow-listed fetch proxy so the browser can read recipe sites (they block CORS). Not an open proxy.
const ALLOW=['africanbites.com', 'aromaticessence.co', 'budgetbytes.com', 'cafedelites.com', 'cookingwithayeh.com', 'cookwithmanali.com', 'damndelicious.net', 'daringgourmet.com', 'feelgoodfoodie.net', 'hebbarskitchen.com', 'hot-thai-kitchen.com', 'hungryhuy.com', 'isabeleats.com', 'italianrecipebook.com', 'justonecookbook.com', 'laylita.com', 'maangchi.com', 'marionskitchen.com', 'mexicoinmykitchen.com', 'ministryofcurry.com', 'mycolombianrecipes.com', 'mydiasporakitchen.com', 'mymoroccanfood.com', 'natashaskitchen.com', 'omnivorescookbook.com', 'preciouscore.com', 'rasamalaysia.com', 'sisijemimah.com', 'spendwithpennies.com', 'spiceupthecurry.com', 'thecookierookie.com', 'themediterraneandish.com', 'thewoksoflife.com', 'whiskaffair.com'];
const ok=h=>ALLOW.some(d=>h===d||h.endsWith('.'+d));
const hits=new Map();
module.exports=async(req,res)=>{
  const ip=(req.headers['x-forwarded-for']||'').split(',')[0]||'x',now=Date.now();
  const h=(hits.get(ip)||[]).filter(t=>now-t<6e4);
  if(h.length>=120)return res.status(429).json({error:'Too many requests'});
  h.push(now);hits.set(ip,h);
  let u;try{u=new URL(String(req.query.url||''))}catch{return res.status(400).json({error:'Bad URL'})}
  if(u.protocol!=='https:'||!ok(u.hostname))return res.status(403).json({error:'Site not allowed'});
  try{
    const r=await fetch(u,{headers:{'User-Agent':'Mozilla/5.0 (compatible; PrepdBot/1.0)',Accept:'text/html,application/json'},signal:AbortSignal.timeout(5000)});
    if(!ok(new URL(r.url).hostname))return res.status(403).json({error:'Redirect not allowed'});
    const t=(await r.text()).slice(0,2e6);
    res.status(r.status).setHeader('Content-Type',r.headers.get('content-type')||'text/plain').setHeader('Cache-Control','s-maxage=3600').send(t);
  }catch{res.status(502).json({error:'Fetch failed'})}
};
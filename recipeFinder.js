// Finds a recipe without a search engine: queries recipe sites' own search (WordPress REST API)
// through our own /api/fetch proxy (api.allorigins.win as backup), reads the page's schema.org Recipe data, and falls back to TheMealDB.
const PROXIES=['/api/fetch?url=','https://api.allorigins.win/raw?url=']; // own allow-listed proxy first, allorigins as backup
const SITES=['hebbarskitchen.com','cookwithmanali.com','ministryofcurry.com','spiceupthecurry.com','swasthisrecipes.com','vegrecipesofindia.com'];
async function tryFetch(u,ms){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);
  try{return await fetch(u,{signal:c.signal})}finally{clearTimeout(t)}
}
// Fail fast: a firewall block (403/429) skips the site instead of retrying elsewhere.
async function get(url,ms=6000){
  try{const r=await tryFetch(PROXIES[0]+encodeURIComponent(url),ms);
    if(r.ok)return await r.text();if(r.status===403||r.status===429)throw new Error('blocked')}
  catch(e){if(e.message==='blocked')throw e}
  const r=await tryFetch(PROXIES[1]+encodeURIComponent(url),ms);
  if(!r.ok)throw new Error('failed');return r.text();
}
const dom=h=>new DOMParser().parseFromString(h,'text/html');
const clean=s=>dom(String(s)).documentElement.textContent.replace(/\s+/g,' ').trim();
async function search(q){
  const res=await Promise.allSettled(SITES.map(async d=>
    JSON.parse(await get(`https://${d}/wp-json/wp/v2/posts?search=${encodeURIComponent(q)}&per_page=2&_fields=link`)).map(x=>x.link)));
  const lists=res.map(r=>r.status==='fulfilled'?r.value:[]),out=[];
  for(let i=0;i<2;i++)for(const l of lists)if(l[i]&&!out.includes(l[i]))out.push(l[i]); // interleave sites
  return out;
}
function recipeNode(x){
  if(!x||typeof x!=='object')return null;
  if(Array.isArray(x)){for(const i of x){const r=recipeNode(i);if(r)return r}return null}
  if([].concat(x['@type']||[]).includes('Recipe'))return x;
  return recipeNode(x['@graph']);
}
function extract(html){
  for(const s of dom(html).querySelectorAll('script[type="application/ld+json"]')){
    let n;try{n=recipeNode(JSON.parse(s.textContent))}catch{continue}
    const lines=(n?.recipeIngredient||[]).map(clean).filter(Boolean);
    if(lines.length>=3){
      const y=parseInt([].concat(n.recipeYield||[]).join(' ').match(/\d+/)?.[0]);
      return {title:clean(n.name||''),yield:y>0?y:4,lines};
    }
  }
  return null;
}
async function mealDb(name){
  try{
    const m=(await(await fetch('https://www.themealdb.com/api/json/v1/1/search.php?s='+encodeURIComponent(name))).json()).meals?.[0];
    if(!m)return null;
    const lines=[];for(let i=1;i<=20;i++){const n=(m['strIngredient'+i]||'').trim();if(n)lines.push(`${(m['strMeasure'+i]||'').trim()} ${n}`.trim())}
    return lines.length>=3?{title:m.strMeal,yield:4,lines,url:m.strSource||'https://www.themealdb.com/meal/'+m.idMeal}:null;
  }catch{return null}
}
export async function findRecipe(name,onStatus=()=>{}){
  const backup=mealDb(name); // started in parallel, used only if the sites fail
  onStatus('Searching recipe sites…');
  const fromSites=(async()=>{
    const links=await search(name);
    if(!links.length)return null;
    onStatus('Reading recipe…');
    return Promise.any(links.slice(0,4).map(async l=>{const r=extract(await get(l));if(!r)throw 0;return {...r,url:l}})).catch(()=>null);
  })().catch(()=>null);
  const r=await fromSites||await backup;
  if(!r)throw new Error('No recipe found for that name.');
  return r;
}
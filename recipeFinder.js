// Finds a recipe without a search engine: queries recipe sites' own search (WordPress REST API)
// through api.allorigins.win, reads the page's schema.org Recipe data, and falls back to TheMealDB.
const PROXIES=['https://api.allorigins.win/raw?url=','https://corsproxy.io/?url='];
const SITES=['hebbarskitchen.com','indianhealthyrecipes.com','cookwithmanali.com','ministryofcurry.com','spiceupthecurry.com'];
async function get(url,ms=10000){
  for(const p of PROXIES){
    const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);
    try{const r=await fetch(p+encodeURIComponent(url),{signal:c.signal});if(r.ok)return await r.text()}catch{}finally{clearTimeout(t)}
  }
  throw new Error('proxy failed');
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
  onStatus('Searching recipe sites…');
  const links=await search(name);
  for(const l of links.slice(0,4)){
    onStatus('Reading recipe…');
    try{const r=extract(await get(l));if(r)return {...r,url:l}}catch{}
  }
  onStatus('Trying another source…');
  const m=await mealDb(name);if(m)return m;
  throw new Error('No recipe found for that name.');
}
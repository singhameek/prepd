// Finds a recipe online via api.allorigins.win (free CORS proxy) and reads its schema.org JSON-LD.
const PROXY='https://api.allorigins.win/raw?url=';
const PREFER=['hebbarskitchen.com','indianhealthyrecipes.com','vegrecipesofindia.com','cookwithmanali.com','ministryofcurry.com','spiceupthecurry.com','archanaskitchen.com','tarladalal.com','madhurasrecipe.com','myfoodstory.com','swasthisrecipes.com','sanjeevkapoor.com','allrecipes.com','bbcgoodfood.com','seriouseats.com','simplyrecipes.com'];
const SKIP=/youtube|pinterest|facebook|instagram|reddit|tiktok|duckduckgo/i;
async function get(url,ms=12000){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);
  try{const r=await fetch(PROXY+encodeURIComponent(url),{signal:c.signal});if(!r.ok)throw new Error('HTTP '+r.status);return await r.text()}
  finally{clearTimeout(t)}
}
const dom=h=>new DOMParser().parseFromString(h,'text/html');
const clean=s=>dom(String(s)).documentElement.textContent.replace(/\s+/g,' ').trim();
async function search(q){
  for(const base of['https://html.duckduckgo.com/html/?q=','https://lite.duckduckgo.com/lite/?q=']){
    try{
      const out=[];
      dom(await get(base+encodeURIComponent(q))).querySelectorAll('a[href]').forEach(a=>{
        const h=a.getAttribute('href')||'',m=h.match(/uddg=([^&]+)/);
        const l=m?decodeURIComponent(m[1]):(/^https?:/.test(h)?h:'');
        if(l&&!SKIP.test(l)&&!out.includes(l))out.push(l)});
      if(out.length)return out;
    }catch{}
  }
  return [];
}
const rank=l=>{const i=PREFER.findIndex(d=>l.includes(d));return i<0?99:i};
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
export async function findRecipe(name,onStatus=()=>{}){
  onStatus('Searching the web…');
  const links=(await search(name+' recipe')).map((l,i)=>({l,i})).sort((a,b)=>rank(a.l)-rank(b.l)||a.i-b.i).map(x=>x.l);
  if(!links.length)throw new Error('Could not search right now.');
  for(const l of links.slice(0,4)){
    onStatus('Reading recipe…');
    try{const r=extract(await get(l));if(r)return {...r,url:l}}catch{}
  }
  throw new Error('No readable recipe found.');
}
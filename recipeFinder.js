// Finds a recipe without a search engine: asks many recipe blogs (grouped by cuisine, see sources.js) through our own
// /api/fetch proxy (api.allorigins.win as backup), reads the page's schema.org Recipe data (ingredients + steps),
// and falls back to TheMealDB. Tolerates misspellings ("aloo gobhi" finds "aloo gobi").
import {regionPlan} from './sources.js';
const PROXIES=['/api/fetch?url=','https://api.allorigins.win/raw?url='];
async function tryFetch(u,ms){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);
  try{return await fetch(u,{signal:c.signal})}finally{clearTimeout(t)}
}
// Fail fast. Our own proxy answering "not found" or "blocked" is final; only a failure of the proxy itself
// (network error, timeout, 5xx) is retried through the backup proxy.
async function get(url,ms=5000){
  try{
    const r=await tryFetch(PROXIES[0]+encodeURIComponent(url),ms);
    if(r.ok)return await r.text();
    if(r.status<500)throw new Error('final');
  }catch(e){if(e.message==='final')throw e}
  const r=await tryFetch(PROXIES[1]+encodeURIComponent(url),ms);
  if(!r.ok)throw new Error('failed');return r.text();
}
const dom=h=>new DOMParser().parseFromString(h,'text/html');
const clean=s=>dom(String(s)).documentElement.textContent.replace(/\s+/g,' ').trim();
// ---- spelling tolerance
const STOP=new Set(['recipe','recipes','with','and','the','style','easy','how','to','make','in']);
export const words=t=>String(t).toLowerCase().split(/[^a-z0-9]+/).filter(w=>w&&!STOP.has(w));
// Folds common transliteration variants together: gobhi=gobi, aloo=alu, paneer=panir, dhaal=dal …
export const fold=w=>w.toLowerCase().replace(/([bdgkjp])h/g,'$1').replace(/([aeiou])h(?=[^aeiou]|$)/g,'$1').replace(/oo/g,'u').replace(/ee/g,'i').replace(/aa/g,'a').replace(/(.)\1+/g,'$1').replace(/[aeiouy]+$/,'');
function lev(a,b){
  if(a===b)return 0;const m=a.length,n=b.length;if(Math.abs(m-n)>2)return 3;
  let p=Array.from({length:n+1},(_,j)=>j);
  for(let i=1;i<=m;i++){const c=[i];for(let j=1;j<=n;j++)c[j]=Math.min(p[j]+1,c[j-1]+1,p[j-1]+(a[i-1]===b[j-1]?0:1));p=c}
  return p[n];
}
export const same=(a,b)=>{const x=fold(a),y=fold(b);if(x===y)return true;const l=Math.min(x.length,y.length);return l>=4&&lev(x,y)<=(l>=8?2:1)};
// Every hit is checked against the dish name (some sites ignore the search term). Misspellings are allowed.
export const rel=(q,text)=>{
  const w=words(q),t=String(text).toLowerCase(),tk=words(t);if(!w.length)return true;
  return w.filter(x=>t.includes(x)||tk.some(y=>same(x,y))).length/w.length>=(w.length<=2?1:.66);
};
const variants=q=>[...new Set([q.trim(),q.toLowerCase().replace(/([bdgkjp])h(?=[aeiou])/g,'$1').trim()])].filter(Boolean);
// ---- searching
async function viaRest(d,q){
  const r=JSON.parse(await get(`https://${d}/wp-json/wp/v2/posts?search=${encodeURIComponent(q)}&per_page=8&_fields=link,title`));
  return r.map(x=>({link:x.link,title:clean(x.title?.rendered||'')}));
}
// Plain WordPress search page, for sites with the REST API switched off.
async function viaHtml(d,q){
  const h=await get(`https://${d}/?s=${encodeURIComponent(q)}`),out=[];
  dom(h).querySelectorAll('a[href]').forEach(a=>{
    let u;try{u=new URL(a.getAttribute('href'),`https://${d}/`)}catch{return}
    if(u.hostname!==d&&u.hostname!=='www.'+d)return;
    const p=u.pathname;
    if(p.length<8||u.search||/^\/(category|tag|page|author|wp-|feed|search|about|contact|privacy|shop|cart|recipes?\/?$)/.test(p))return;
    out.push({link:u.origin+p,title:a.textContent.replace(/\s+/g,' ').trim()});
  });
  return out;
}
async function siteSearch(d,qs,need,html){
  const out=[];
  await Promise.all(qs.map(async q=>{try{
    for(const x of await (html?viaHtml(d,q):viaRest(d,q)))if(rel(need,x.title+' '+x.link)&&!out.includes(x.link))out.push(x.link);
  }catch{}}));
  return out;
}
async function searchSites(sites,qs,need,html=false){
  const lists=await Promise.all(sites.map(d=>siteSearch(d,qs,need,html))),out=[];
  for(let i=0;i<3;i++)for(const l of lists)if(l[i]&&!out.includes(l[i]))out.push(l[i]); // interleave sites
  return out;
}
// ---- reading a recipe page
function recipeNode(x){
  if(!x||typeof x!=='object')return null;
  if(Array.isArray(x)){for(const i of x){const r=recipeNode(i);if(r)return r}return null}
  if([].concat(x['@type']||[]).includes('Recipe'))return x;
  return recipeNode(x['@graph']);
}
function flat(x){
  if(!x)return [];if(typeof x==='string')return [x];if(Array.isArray(x))return x.flatMap(flat);
  if(typeof x==='object')return x.itemListElement?flat(x.itemListElement):flat(x.text||x.name);
  return [];
}
function extract(html){
  for(const s of dom(html).querySelectorAll('script[type="application/ld+json"]')){
    let n;try{n=recipeNode(JSON.parse(s.textContent))}catch{continue}
    const lines=(n?.recipeIngredient||[]).map(clean).filter(Boolean);
    if(lines.length>=3){
      const y=parseInt([].concat(n.recipeYield||[]).join(' ').match(/\d+/)?.[0]);
      const steps=flat(n.recipeInstructions).flatMap(s=>String(s).split(/\n+/)).map(clean)
        .map(s=>s.replace(/^(?:step\s*)?\d{1,2}\s*[.):\-–]\s*/i,'')).filter(s=>s.length>2);
      return {title:clean(n.name||''),yield:y>0?y:4,lines,steps};
    }
  }
  return null;
}
async function mealDb(name,qs){
  for(const q of qs){try{
    const m=(await(await fetch('https://www.themealdb.com/api/json/v1/1/search.php?s='+encodeURIComponent(q))).json()).meals?.[0];
    if(!m||!rel(name,m.strMeal))continue;
    const lines=[];for(let i=1;i<=20;i++){const n=(m['strIngredient'+i]||'').trim();if(n)lines.push(`${(m['strMeasure'+i]||'').trim()} ${n}`.trim())}
    const steps=String(m.strInstructions||'').split(/\r?\n+/).map(s=>s.replace(/^(?:step\s*)?\d{1,2}\s*[.):\-–]\s*/i,'').trim()).filter(s=>s.length>2);
    if(lines.length>=3)return {title:m.strMeal,yield:4,lines,steps,url:m.strSource||'https://www.themealdb.com/meal/'+m.idMeal};
  }catch{}}
  return null;
}
const readPage=async(l,name)=>{const x=extract(await get(l));if(!x||!rel(name,(x.title||'')+' '+l))throw 0;return {...x,url:l}};
// Asks every site in the list at the same time. The first site whose matching page reads as a recipe wins; sites for
// the dish's likely cuisine get a short head start so a good local match isn't beaten by a lucky stranger.
function race(sites,prio,qs,name,html){
  return new Promise(resolve=>{
    let left=sites.length;if(!left)return resolve(null);
    const no=()=>{if(--left===0)resolve(null)};
    for(const d of sites)
      siteSearch(d,qs,name,html)
        .then(links=>links.length?Promise.any(links.slice(0,2).map(l=>readPage(l,name))):Promise.reject())
        .then(v=>{const wait=prio.has(d)||!prio.size?0:450;wait?setTimeout(()=>resolve(v),wait):resolve(v)},no);
  });
}
const never=new Promise(()=>{});
export async function findRecipe(name,onStatus=()=>{}){
  const qs=variants(name),plan=regionPlan(name),prio=new Set(plan.first),all=[...plan.first,...plan.rest];
  const backup=mealDb(name,qs).then(m=>m?new Promise(res=>setTimeout(()=>res(m),2500)):never); // runs alongside; only wins if the sites are slow
  const deadline=Date.now()+20000;
  const longWords=[...new Set(words(name).filter(w=>w.length>=4))].sort((a,b)=>b.length-a.length).slice(0,2);
  const phases=[
    [`Searching ${all.length} recipe sites…`,()=>race(all,prio,qs,name,false)],
    ['Trying site search pages…',()=>race([...plan.first.slice(0,8),...plan.rest.slice(0,8)],prio,qs,name,true)],
    ['Checking spelling variants…',()=>longWords.length?race(all,prio,longWords,name,false):null]];
  let r=null;
  for(const [msg,run] of phases){
    if(Date.now()>deadline)break;
    onStatus(msg);
    r=await Promise.race([run(),backup]);if(r)break;
  }
  r=r||await Promise.race([backup,new Promise(res=>setTimeout(()=>res(null),600))]);
  if(!r)throw new Error('No recipe found for that name.');
  return r;
}
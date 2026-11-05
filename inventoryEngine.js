import {db,today} from './db.js';
import {engine} from './engine.js';
export const UNITS=['g','kg','oz','lb','ml','l','tsp','tbsp','cup','pcs'];
// Every quantity is converted through grams, using per-ingredient data: grams per piece and grams per ml.
// Sources, in order: learned/looked-up profiles (shared via the cloud), the parser's built-in table, then a default.
// So 3 pcs of potato in the pantry matches 500 g in a recipe, and 2 cups atta matches 5 kg atta.
const MASS={g:1,kg:1000,oz:28.3495,lb:453.592},VOLU={ml:1,l:1000,tsp:5,tbsp:15,cup:240};
let prof={};const unresolved=new Set();
export const setProfiles=p=>{prof=p||{}};
export const getProfiles=()=>prof;
export const takeUnresolved=()=>{const a=[...unresolved];unresolved.clear();return a};
const kc=new Map();
const known=n=>{                       // engine data for an ingredient; cached, and null until the engine has loaded
  const E=engine();if(!E)return null;
  const k=String(n).toLowerCase();if(kc.has(k))return kc.get(k);
  let g=null;try{g=E.getIngredient(k)}catch{}
  kc.set(k,g);return g;
};
const gp=(u,n)=>{
  if(MASS[u])return MASS[u];
  const k=nk(n),p=prof[k];
  if(u==='pcs'){const w=p?.pc??known(n)?.piece;if(w>0)return w;if(engine()&&!p?.tried)unresolved.add(k);return 100}   // only look things up once the engine has had its say
  const d=p?.d??known(n)?.density;
  if(!(d>0)){if(engine()&&!p?.tried)unresolved.add(k);return VOLU[u]||1}
  return (VOLU[u]||1)*d;
};
const baseUnit=u=>u==='pcs'?'pcs':MASS[u]?'g':'ml';
export const toGrams=(q,u,n)=>q*gp(u,n);
// Converts an amount between any two units for one ingredient (e.g. 4900 g -> 4.9 kg).
export const convertAmount=(q,from,to,n)=>from===to?q:q*gp(from,n)/gp(to,n);
// Name matching: ignores case, plurals and common synonyms so "Onions" = "onion" and "curd" = "yogurt".
const SYN=[[/^(whole )?wheat flour$|^atta$|^chapati flour$/,'atta'],[/^(curd|dahi|yogh?urt|plain yogh?urt)$/,'curd'],[/^(coriander leaves?|cilantro|dhania)$/,'cilantro'],
 [/^(capsicum|bell peppers?)$/,'bell pepper'],[/^(green )?chil+(i|ies|y|is|es)?$|^green chil+(i|ies|y|is|es)?$/,'green chili'],[/^(jeera|cumin|cumin seeds?)$/,'cumin'],
 [/^(haldi|turmeric( powder)?)$/,'turmeric'],[/^(vegetable oil|cooking oil|oil)$/,'oil'],[/^(brinjal|eggplants?|aubergines?)$/,'eggplant'],[/^(spring onions?|scallions?)$/,'scallion']];
const sing=w=>w.length>3&&/ies$/.test(w)?w.slice(0,-3)+'y':/(ss|us|is)$/.test(w)?w:/oes$/.test(w)?w.slice(0,-2):w.length>3&&/s$/.test(w)?w.slice(0,-1):w;
const nkc=new Map();
export const nk=n=>{const c=nkc.get(n);if(c!==undefined)return c;const v=nk0(n);if(nkc.size>5000)nkc.clear();nkc.set(n,v);return v};
const nk0=n=>{
  const raw=String(n||'').toLowerCase().replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
  for(const [r,v] of SYN)if(r.test(raw))return v;
  const s=raw.split(' ').map(sing).join(' ');
  for(const [r,v] of SYN)if(r.test(s))return v;
  return s;
};
// Typical shop packages: [pattern, label, size, base unit]. Users can override sizes in Settings.
const PK=[
[/coconut milk/,'can',400,'ml'],[/besan|gram flour/,'pack',500,'g'],[/atta|whole wheat flour|wheat flour/,'bag',5000,'g'],[/rice flour/,'pack',500,'g'],
[/maida|all[- ]purpose flour|flour/,'bag',1000,'g'],[/semolina|rava|suji|sooji|poha|oats/,'pack',500,'g'],[/rice/,'bag',5000,'g'],[/sugar/,'bag',1000,'g'],
[/jaggery/,'pack',500,'g'],[/\bsalt\b/,'pack',1000,'g'],[/dal\b|lentil|moong|toor|chana|masoor|urad|rajma|chickpea/,'pack',1000,'g'],
[/milk/,'carton',1000,'ml'],[/curd|yogh?urt|dahi/,'tub',500,'g'],[/paneer/,'pack',200,'g'],[/butter/,'pack',200,'g'],[/cheese/,'pack',200,'g'],
[/cream/,'carton',200,'ml'],[/ghee/,'jar',500,'ml'],[/\boil\b/,'bottle',1000,'ml'],[/\beggs?\b/,'tray',600,'g'],[/onion|potato/,'bag',2000,'g'],
[/tomato/,'pack',1000,'g'],[/ginger|garlic|green chil/,'pack',100,'g'],[/^curry$|curry leaves?|curry leaf/,'bunch',30,'g'],[/coriander leaves|cilantro|\bmint\b/,'bunch',100,'g'],
[/spinach|palak|methi|fenugreek leaves/,'bunch',250,'g'],[/chicken/,'pack',1000,'g'],[/mutton|lamb|beef|pork/,'pack',500,'g'],[/fish|prawn|shrimp/,'pack',500,'g'],
[/bell pepper|capsicum/,'pack',500,'g'],
[/powder|masala|turmeric|haldi|cumin|jeera|chili|chilli|pepper|cardamom|cinnamon|clove|mustard|fenugreek|\bhing\b|asafoetida|paprika|spice|seeds?/,'packet',100,'g'],
[/\btea\b|coffee/,'pack',250,'g'],[/cashew|almond|raisin|peanut|walnut|pistachio/,'pack',250,'g'],[/tamarind/,'block',200,'g']];
let over={},extra=new Set();
export const setPrefs=({packs={},staples=[]}={})=>{over=Object.fromEntries(Object.entries(packs).map(([k,v])=>[nk(k),v]));extra=new Set(staples.map(nk))};
// Package used for shopping: the user's own size > typical shop size > generic fallback.
export function pkgFor(i){
  const n=(i.name||'').toLowerCase().trim(),bu=baseUnit(i.unit||'g'),pc=bu==='pcs';
  const o=over[nk(n)];if(o?.size>0)return {n:o.n||'pack',size:o.size,unit:o.unit||bu,custom:true};
  const m=PK.find(x=>x[0].test(n));
  if(m)return {n:m[1],size:m[2],unit:m[3]};
  if(i.pkg?.size>0)return {...i.pkg,unit:bu};
  if(pc)return null;
  return bu==='ml'?(['tsp','tbsp'].includes(i.unit)?{n:'packet',size:100,unit:'g'}:{n:'bottle',size:1000,unit:'ml'}):{n:'pack',size:500,unit:'g'};
}
const plural=(w,n)=>n===1?w:w==='loaf'?'loaves':/(x|ch|sh|s)$/.test(w)?w+'es':w+'s';
export const sizeText=(v,u)=>sz(v,u);
const sz=(v,u)=>(v=u==='pcs'?+(+v).toFixed(1):Math.round(v),u==='g')?(v>=1000?+(v/1000).toFixed(2)+' kg':v+' g'):u==='ml'?(v>=1000?+(v/1000).toFixed(2)+' L':v+' ml'):v+' pcs';
// "1 bag of flour" style text for a grocery entry
export function groceryText(g){
  const need=`${+(+g.qty).toFixed(1)} ${g.unit}`;
  if(!g.pkg||!g.packs)return {title:g.name,sub:need};
  return {title:`${g.packs} ${plural(g.pkg.n,g.packs)} of ${g.name}`,sub:`${sz(g.pkg.size*g.packs,g.pkg.unit||baseUnit(g.unit))} · recipe needs ${need}`};
}
// Free, always-on-demand household items (and the user's own staples): never deducted, never on the grocery list.
export const isStaple=i=>{const n=(i.name||i.canonical_name||'').trim();return !!i.staple||extra.has(nk(n))||/^((tap|cold|hot|warm|boiling|filtered|cool|lukewarm|plain|running)\s+)?water$|^ice(\s+cubes?)?$/i.test(n)};
const notifOK=()=>typeof Notification!=='undefined'&&Notification.permission==='granted';
// "To taste" / "as needed" items have no real amount, so they are not tracked.
const skip=i=>isStaple(i)||i.taste;
// How many servings of a recipe a planned meal uses. Older plans only have `scale`.
export const planScale=(p,r)=>p.portions!=null?p.portions/(r.servings||1):(p.scale||1);
const sumMacros=(ings,scale)=>ings.reduce((a,i)=>{const m=i.macros||{};
  for(const k of['calories','protein','carbs','fat'])a[k]+=(m[k]||0)*scale;return a},{calories:0,protein:0,carbs:0,fat:0});

export async function deductIngredientsFromPantry(recipeId,portionScale=1,{logMeal=true}={}){
  const r=await db.recipes.get(recipeId);if(!r)throw new Error('Recipe not found');
  const missing=[];
  await db.transaction('rw',db.pantryItems,db.nutritionLogs,async()=>{
    const pantry=await db.pantryItems.toArray(),by=new Map(),puts=new Map(),dels=new Set();
    for(const p of pantry){const k=nk(p.name);(by.get(k)||by.set(k,[]).get(k)).push(p)}
    for(const ing of r.ingredients){
      if(skip(ing))continue;
      let need=ing.qty*portionScale*gp(ing.unit,ing.name);
      const stock=(by.get(nk(ing.name))||[]).slice().sort((a,b)=>(a.expiry||'9')<(b.expiry||'9')?-1:1);
      for(const p of stock){
        if(need<=0)break;
        const w=gp(p.unit,ing.name),take=Math.min(p.qty*w,need);p.qty-=take/w;need-=take;
        if(p.qty<=0.001){dels.add(p.id);puts.delete(p.id)}else puts.set(p.id,p);
      }
      if(need>0.5)missing.push({name:ing.name,qty:need/gp(ing.unit,ing.name),unit:ing.unit}); // ignore rounding crumbs
    }
    // all the changes are written together (one round trip instead of one per ingredient)
    if(dels.size)await db.pantryItems.bulkDelete([...dels]);
    if(puts.size)await db.pantryItems.bulkPut([...puts.values()]);
    if(logMeal)await db.nutritionLogs.add({date:today(),recipeId,name:r.name,...sumMacros(r.ingredients,portionScale)});
  });
  return {missing};
}

// Compares every unlogged planned meal in the window against pantry stock. With addToGrocery, the grocery list is
// brought in line with the result: one entry per ingredient, only for what is actually missing. Everything is read in
// parallel and written in one transaction. The returned array has .changed = true when the grocery list was edited.
export async function checkUpcomingMenuShortages(forecastHours=24,{addToGrocery=false}={}){
  const end=new Date(Date.now()+forecastHours*36e5).toLocaleDateString('sv');
  const [planned,recipes,pantry]=await Promise.all([
    db.mealPlans.where('date').between(today(),end,true,true).toArray(),db.recipes.toArray(),db.pantryItems.toArray()]);
  const recs=new Map(recipes.map(r=>[r.id,r])),need=new Map(),have=new Map();
  for(const p of planned){
    if(p.logged)continue;const r=recs.get(p.recipeId);if(!r)continue;const sc=planScale(p,r);
    for(const i of r.ingredients){if(skip(i))continue;const k=nk(i.name);
      const e=need.get(k)||need.set(k,{name:i.name,unit:i.unit,qty:0}).get(k);e.qty+=i.qty*sc*gp(i.unit,i.name)}
  }
  for(const p of pantry){const k=nk(p.name);have.set(k,(have.get(k)||0)+p.qty*gp(p.unit,p.name))}
  const shortages=[];
  for(const [k,n] of need){
    const h=have.get(k)||0;
    if(h<n.qty-0.5){
      const pkg=pkgFor(n),base=n.qty-h;
      shortages.push({name:n.name,unit:n.unit,pkg,qty:Math.ceil(base/gp(n.unit,n.name)*10)/10,packs:pkg?Math.max(1,Math.ceil(base/(pkg.size*gp(pkg.unit||baseUnit(n.unit),n.name))-1e-6)):0})}
  }
  shortages.changed=false;
  if(addToGrocery){
    const open=(await db.groceryList.toArray()).filter(g=>!g.checked),byName=new Map(),keep=new Set(),adds=[],puts=[],dels=[];
    for(const g of open){const k=nk(g.name);if(byName.has(k))dels.push(g.id);else byName.set(k,g)}   // duplicates from older versions
    for(const s of shortages){
      const k=nk(s.name);keep.add(k);
      const row={name:s.name,qty:s.qty,unit:s.unit,pkg:s.pkg||null,packs:s.packs,auto:true},ex=byName.get(k);
      if(!ex)adds.push({...row,checked:0});
      else if(ex.qty!==row.qty||ex.unit!==row.unit||ex.packs!==row.packs||!ex.auto||JSON.stringify(ex.pkg)!==JSON.stringify(row.pkg))puts.push({...ex,...row});
    }
    for(const [k,g] of byName)if(g.auto&&!keep.has(k))dels.push(g.id);                              // no longer needed
    if(adds.length||puts.length||dels.length){
      await db.transaction('rw',db.groceryList,async()=>{
        if(dels.length)await db.groceryList.bulkDelete(dels);
        if(puts.length)await db.groceryList.bulkPut(puts);
        if(adds.length)await db.groceryList.bulkAdd(adds);
      });
      shortages.changed=true;
    }
  }else if(shortages.length&&notifOK()){
    try{
      const reg=await navigator.serviceWorker?.ready;
      const o={body:shortages.slice(0,4).map(s=>s.name).join(', ')+(shortages.length>4?'…':''),tag:'shortage',icon:'icon-192.png'};
      reg?reg.showNotification('Short on ingredients',o):new Notification('Short on ingredients',o);
    }catch{}
  }
  return shortages;
}

export function convertMetricToFractionalUI(remainingQuantity,totalCapacity){
  if(!totalCapacity)return `${Math.round(remainingQuantity)}`;
  const r=Math.max(0,Math.min(1,remainingQuantity/totalCapacity));
  if(r<=0.03)return 'empty';
  if(r>=0.97)return 'full';
  if(Math.abs(r-.5)<.06)return 'half full';
  if(Math.abs(r-.75)<.06)return '¾ full';
  if(Math.abs(r-.25)<.06)return '¼ full';
  const t=Math.round(r*10);return t===10?'full':`~${t}/10ths full`;
}

export async function restockFromGrocery(id){
  const g=await db.groceryList.get(id);if(!g)return;
  // Bought packages add the full package amount; manual items add the exact amount.
  const pk=g.pkg&&g.packs,un=pk?(g.pkg.unit||baseUnit(g.unit)):g.unit,amt=pk?g.pkg.size*g.packs:g.qty;
  await db.transaction('rw',db.groceryList,db.pantryItems,async()=>{
    const p=(await db.pantryItems.toArray()).find(x=>nk(x.name)===nk(g.name));
    if(p){const nq=p.qty+amt*gp(un,g.name)/gp(p.unit,g.name);await db.pantryItems.update(p.id,{qty:nq,capacity:Math.max(p.capacity||0,nq)})}
    else await db.pantryItems.add({name:g.name,qty:amt,capacity:amt,unit:un});
    await db.groceryList.delete(id);
  });
}
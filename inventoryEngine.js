import {db,today} from './db.js';
const key=n=>n.trim().toLowerCase();
// Units: volume units convert to ml; g and pcs stand alone. Items match by name + unit family.
export const UNITS=['g','ml','pcs','tsp','tbsp','cup'];
const F={g:1,ml:1,pcs:1,tsp:5,tbsp:15,cup:240};
const f=u=>F[u]||1,fam=u=>u==='g'?'g':u==='pcs'?'pcs':'vol',baseUnit=u=>fam(u)==='vol'?'ml':u;
// Typical shop packages: [pattern, label, size, base unit]. Users can override sizes in Settings.
const PK=[
[/coconut milk/,'can',400,'ml'],[/besan|gram flour/,'pack',500,'g'],[/atta|whole wheat flour|wheat flour/,'bag',5000,'g'],[/rice flour/,'pack',500,'g'],
[/maida|all[- ]purpose flour|flour/,'bag',1000,'g'],[/semolina|rava|suji|sooji|poha|oats/,'pack',500,'g'],[/rice/,'bag',5000,'g'],[/sugar/,'bag',1000,'g'],
[/jaggery/,'pack',500,'g'],[/\bsalt\b/,'pack',1000,'g'],[/dal\b|lentil|moong|toor|chana|masoor|urad|rajma|chickpea/,'pack',1000,'g'],
[/milk/,'carton',1000,'ml'],[/curd|yogh?urt|dahi/,'tub',500,'g'],[/paneer/,'pack',200,'g'],[/butter/,'pack',200,'g'],[/cheese/,'pack',200,'g'],
[/cream/,'carton',200,'ml'],[/ghee/,'jar',500,'ml'],[/\boil\b/,'bottle',1000,'ml'],[/\beggs?\b/,'tray',12,'pcs'],[/onion|potato/,'bag',2000,'g'],
[/tomato/,'pack',1000,'g'],[/ginger|garlic|green chil/,'pack',100,'g'],[/coriander leaves|cilantro|\bmint\b|curry leaves?|curry leaf/,'bunch',1,'pcs'],
[/spinach|palak|methi|fenugreek leaves/,'bunch',250,'g'],[/chicken/,'pack',1000,'g'],[/mutton|lamb|beef|pork/,'pack',500,'g'],[/fish|prawn|shrimp/,'pack',500,'g'],
[/bell pepper|capsicum/,'pack',500,'g'],
[/powder|masala|turmeric|haldi|cumin|jeera|chili|chilli|pepper|cardamom|cinnamon|clove|mustard|fenugreek|\bhing\b|asafoetida|paprika|spice|seeds?/,'packet',100,'g'],
[/\btea\b|coffee/,'pack',250,'g'],[/cashew|almond|raisin|peanut|walnut|pistachio/,'pack',250,'g'],[/tamarind/,'block',200,'g']];
let over={},extra=new Set();
export const setPrefs=({packs={},staples=[]}={})=>{over=packs;extra=new Set(staples.map(key))};
// Package used for shopping: the user's own size > typical shop size > the AI's guess > generic fallback.
export function pkgFor(i){
  const n=(i.name||'').toLowerCase().trim(),bu=baseUnit(i.unit||'g'),pc=bu==='pcs';
  const o=over[n];if(o?.size>0)return {n:o.n||'pack',size:o.size,unit:o.unit||bu,custom:true};
  const m=PK.find(x=>x[0].test(n)&&(x[3]==='pcs')===pc);
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
// Free, always-on-demand household items: never deducted, never put on the grocery list.
export const isStaple=i=>!!i.staple||extra.has(key(i.name||i.canonical_name||''))||/^((tap|cold|hot|warm|boiling|filtered|cool|lukewarm|plain|running)\s+)?water$|^ice(\s+cubes?)?$/i.test((i.name||i.canonical_name||'').trim());
const sumMacros=(ings,scale)=>ings.reduce((a,i)=>{const m=i.macros||{};
  for(const k of['calories','protein','carbs','fat'])a[k]+=(m[k]||0)*scale;return a},{calories:0,protein:0,carbs:0,fat:0});

export async function deductIngredientsFromPantry(recipeId,portionScale=1,{logMeal=true}={}){
  const r=await db.recipes.get(recipeId);if(!r)throw new Error('Recipe not found');
  const missing=[];
  await db.transaction('rw',db.pantryItems,db.nutritionLogs,async()=>{
    const pantry=await db.pantryItems.toArray();
    for(const ing of r.ingredients){
      if(isStaple(ing))continue;
      let need=ing.qty*portionScale*f(ing.unit);
      const stock=pantry.filter(p=>key(p.name)===key(ing.name)&&fam(p.unit)===fam(ing.unit)).sort((a,b)=>(a.expiry||'9')<(b.expiry||'9')?-1:1);
      for(const p of stock){
        if(need<=0)break;
        const take=Math.min(p.qty*f(p.unit),need);p.qty-=take/f(p.unit);need-=take;
        p.qty<=0?await db.pantryItems.delete(p.id):await db.pantryItems.put(p);
      }
      if(need>0.001)missing.push({name:ing.name,qty:need/f(ing.unit),unit:ing.unit});
    }
    if(logMeal)await db.nutritionLogs.add({date:today(),recipeId,name:r.name,...sumMacros(r.ingredients,portionScale)});
  });
  return {missing};
}

export async function checkUpcomingMenuShortages(forecastHours=24,{addToGrocery=false}={}){
  const end=new Date(Date.now()+forecastHours*36e5).toLocaleDateString('sv');
  const plans=(await db.mealPlans.where('date').between(today(),end,true,true).toArray()).filter(p=>!p.logged);
  const need=new Map();
  for(const p of plans){const r=await db.recipes.get(p.recipeId);if(!r)continue;
    for(const i of r.ingredients){if(isStaple(i))continue;const k=key(i.name)+'|'+fam(i.unit);
      const e=need.get(k)||{name:i.name,unit:i.unit,qty:0,pkg:pkgFor(i)};e.qty+=i.qty*(p.scale||1)*f(i.unit);need.set(k,e)}}
  const pantry=await db.pantryItems.toArray(),shortages=[];
  for(const [k,n] of need){
    const have=pantry.filter(p=>key(p.name)+'|'+fam(p.unit)===k).reduce((s,p)=>s+p.qty*f(p.unit),0);
    if(have<n.qty-0.001){const base=n.qty-have;shortages.push({...n,qty:Math.ceil(base/f(n.unit)*10)/10,packs:n.pkg?Math.max(1,Math.ceil(base/n.pkg.size-1e-6)):0})}
  }
  if(addToGrocery)for(const s of shortages){
    const ex=await db.groceryList.where('name').equals(s.name).filter(g=>!g.checked&&fam(g.unit)===fam(s.unit)).first();
    ex?await db.groceryList.update(ex.id,{qty:s.qty,unit:s.unit,pkg:s.pkg||null,packs:s.packs}):await db.groceryList.add({...s,checked:0});
  }
  if(shortages.length&&Notification?.permission==='granted'){
    const reg=await navigator.serviceWorker?.ready;
    const o={body:shortages.slice(0,4).map(s=>s.name).join(', ')+(shortages.length>4?'…':''),tag:'shortage',icon:'icon.svg'};
    reg?reg.showNotification('Short on ingredients',o):new Notification('Short on ingredients',o);
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
    const p=await db.pantryItems.where('name').equals(g.name).filter(x=>fam(x.unit)===fam(un)).first();
    if(p){const nq=p.qty+amt*f(un)/f(p.unit);await db.pantryItems.update(p.id,{qty:nq,capacity:Math.max(p.capacity||0,nq)})}
    else await db.pantryItems.add({name:g.name,qty:amt,capacity:amt,unit:un});
    await db.groceryList.delete(id);
  });
}
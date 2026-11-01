import {db,today} from './db.js';
const key=n=>n.trim().toLowerCase();
// Units: volume units convert to ml; g and pcs stand alone. Items match by name + unit family.
export const UNITS=['g','ml','pcs','tsp','tbsp','cup'];
const F={g:1,ml:1,pcs:1,tsp:5,tbsp:15,cup:240};
const f=u=>F[u]||1,fam=u=>u==='g'?'g':u==='pcs'?'pcs':'vol';
// Free, always-on-demand household items: never deducted, never put on the grocery list.
export const isStaple=i=>!!i.staple||/^((tap|cold|hot|warm|boiling|filtered|cool|lukewarm|plain|running)\s+)?water$|^ice(\s+cubes?)?$/i.test((i.name||i.canonical_name||'').trim());
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
      const e=need.get(k)||{name:i.name,unit:i.unit,qty:0};e.qty+=i.qty*(p.scale||1)*f(i.unit);need.set(k,e)}}
  const pantry=await db.pantryItems.toArray(),shortages=[];
  for(const [k,n] of need){
    const have=pantry.filter(p=>key(p.name)+'|'+fam(p.unit)===k).reduce((s,p)=>s+p.qty*f(p.unit),0);
    if(have<n.qty-0.001)shortages.push({...n,qty:Math.ceil((n.qty-have)/f(n.unit)*10)/10});
  }
  if(addToGrocery)for(const s of shortages){
    const ex=await db.groceryList.where('name').equals(s.name).filter(g=>!g.checked&&g.unit===s.unit).first();
    ex?await db.groceryList.update(ex.id,{qty:s.qty}):await db.groceryList.add({...s,checked:0});
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
  await db.transaction('rw',db.groceryList,db.pantryItems,async()=>{
    const p=await db.pantryItems.where('name').equals(g.name).filter(x=>fam(x.unit)===fam(g.unit)).first();
    if(p){const nq=p.qty+g.qty*f(g.unit)/f(p.unit);await db.pantryItems.update(p.id,{qty:nq,capacity:Math.max(p.capacity||0,nq)})}
    else await db.pantryItems.add({name:g.name,qty:g.qty,capacity:g.qty,unit:g.unit});
    await db.groceryList.delete(id);
  });
}
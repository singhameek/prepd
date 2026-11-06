// Decides whether something added to the grocery list is food (goes to the pantry when bought) or not (napkins,
// soap…), so nobody has to pick. Stages, in order:
//   0. what the user told us before   1. it is an ingredient in their meals (or already in their pantry)
//   2. the ingredient engine knows it  3. it is an ingredient in any recipe saved on the platform (checked online)
// Anything left is not food: it stays on the list but never goes into the pantry.
import {db} from './db.js';
import {engine} from './engine.js';
import {nk} from './inventoryEngine.js';
import * as cloud from './cloud.js';
// Words that mean "not food", even when the engine's fuzzy matching finds something similar ("cling wrap" -> tortillas).
const NONFOOD=/\b(napkins?|tissues?|paper towels?|toilet|soaps?|detergent|shampoo|conditioner|toothpaste|toothbrush|sponges?|scrubber|foil|cling|trash|garbage|bin bags?|batter(?:y|ies)|bulbs?|candles?|matchbox|matches|lighter|cleaner|bleach|phenyl|disinfectant|sanitizer|diapers?|razors?|deodorant|lotion|mask|gloves|brush|mop|broom|dustbin|cutlery|straws?|zip ?lock|containers?|filters?|charger|cable|notebook|tape|glue|scissors|freshener|towels?|dish ?wash|hand ?wash|laundry|floss|cotton|sanitary|pads?)\b/i;
// Everyday groceries the engine doesn't list.
const FOODISH=/\b(biscuits?|cookies?|chips|crisps|snacks?|namkeen|soda|cola|juices?|tea|coffee|maggi|chocolates?|candy|cereal|cornflakes|jam|pickles?|fruits?|vegetables?|veggies|sweets|mithai)\b/i;
let over={};
export async function loadOverrides(){over=(await db.appSettings.get('foodOverrides'))?.value||{}}
export async function setOverride(name,food){over={...over,[nk(name)]:!!food};await db.appSettings.put({key:'foodOverrides',value:over})}
// Names of everything already known to be food on this device: ingredients of saved meals and pantry items.
export async function loadKnown(){
  const [rs,ps]=await Promise.all([db.recipes.toArray(),db.pantryItems.toArray()]),set=new Set();
  for(const r of rs)for(const i of r.ingredients||[])set.add(nk(i.name));
  for(const p of ps)set.add(nk(p.name));
  return set;
}
function engineKnows(name){
  const E=engine();if(!E)return false;
  const lower=name.toLowerCase().trim();
  let r;try{r=E.parseIngredients(lower)[0]}catch{return false}
  if(!r||r.category==='unknown')return false;
  const canon=String(r.name).toLowerCase();
  const bad=lower.match(NONFOOD);                                   // e.g. "coffee filters": only food if the match says so too
  if(bad&&!canon.includes(bad[0].replace(/s$/,'')))return false;
  return true;
}
// Stages 0 to 2: instant, no network. Returns {food, why}.
export function classifyFast(name,known){
  const n=nk(name);
  if(n in over)return {food:over[n],why:'you told us'};
  if(known&&known.has(n))return {food:true,why:'in your meals'};
  if(engineKnows(name))return {food:true,why:'known ingredient'};
  if(FOODISH.test(name)&&!NONFOOD.test(name))return {food:true,why:'known grocery'};
  return {food:false,why:'not found'};
}
// Stage 3: is it an ingredient in any recipe saved on the platform? Null when offline or not set up.
export async function classifyCommunity(name){
  try{return await Promise.race([cloud.ingredientKnown(name),new Promise(r=>setTimeout(()=>r(null),3000))])}catch{return null}
}
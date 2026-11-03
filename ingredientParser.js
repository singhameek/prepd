// Offline ingredient parser: wraps ingredient-engine.js (no network, no AI, instant).
import {parseIngredients as parse} from './ingredient-engine.js';
import {apply as applyCorrections,prefetch} from './corrections.js';
import {cleanLine,suspect} from './quality.js';
const r1=n=>Math.round(n*10)/10,q4=n=>Math.max(.25,Math.round(n*4)/4);
// One engine result → one recipe item, in the unit the recipe used: cups/tsp/tbsp for those lines, pcs for countable
// things (potato, onion, egg), grams or ml otherwise. d = grams per ml and pc = grams per piece are kept for conversions.
function toItem(it,line){
  const name=String(it.name).replace(/\s*\(.*?\)\s*/g,' ').replace(/\s+/g,' ').trim().toLowerCase(),du=it.displayUnit,dq=Number(it.displayQty);
  let qty,unit,d=null,pc=null;
  if(['cup','tbsp','tsp'].includes(du)&&dq>0){qty=q4(dq);unit=du;d=it.density>0?+(+it.density).toFixed(3):null}
  else if(du==='pcs'&&dq>0&&it.grams>0){qty=Math.max(.5,Math.round(dq*2)/2);unit='pcs';pc=+(it.grams/dq).toFixed(1)}
  else{unit=it.unit==='ml'?'ml':'g';qty=r1(it.quantity)||1;if(unit==='ml'&&it.density>0)d=+(+it.density).toFixed(3)}
  const n=it.nutrition||{};
  return {name,qty,unit,staple:false,taste:it.always===true,display:line,d,pc,
    macros:{calories:r1(n.kcal||0),protein:r1(n.protein||0),carbs:r1(n.carbs||0),fat:r1(n.fat||0)}};
}
export async function parseIngredients(text){
  const lines=String(text).split('\n').map(s=>s.trim()).filter(Boolean),out=[];
  await prefetch(lines);   // fixes other users agreed on, if any
  for(const line of lines){
    let items=[];try{items=parse(cleanLine(line))}catch{}
    if(!items.length)throw new Error(`Couldn't read: “${line.slice(0,40)}”. Try something like “2 cups flour”.`);
    const made=applyCorrections(line,items.map(it=>toItem(it,line)));   // what this user (or the community) corrected before
    out.push(...made.map(i=>({...i,suspect:!i.learned&&suspect(line,i.name)})));
  }
  if(!out.length)throw new Error('Paste at least one ingredient.');
  return out;
}
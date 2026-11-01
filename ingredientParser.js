// Offline ingredient parser: wraps ingredient-engine.js (no network, no AI, instant).
import {parseIngredients as parse,getIngredient} from './ingredient-engine.js';
// The engine's own data is thin for South Asian staples (e.g. it treats 1 cup atta as 240 g and ghee as 1 kcal/g),
// so common ones are corrected here: [pattern, g per ml, kcal/100g, protein, carbs, fat].
const OV=[
 [/\b(atta|wheat flour|whole wheat)\b/,.5,340,12,72,2],[/\b(maida|all.?purpose flour)\b/,.53,364,10,76,1],[/\b(besan|gram flour)\b/,.5,387,22,58,7],
 [/\b(semolina|rava|sooji|suji)\b/,.7,360,13,73,1],[/\bghee\b/,.91,900,0,0,100],[/\bpaneer\b/,1.04,296,18,4,23],
 [/\b(curd|dahi|yogh?urt)\b/,1.03,61,3.5,4.7,3.3],[/\b(toor|tur|arhar|moong|mung|masoor|chana|urad|dal|lentils?)\b/,.8,343,22,60,1.5],
 [/\b(jeera|cumin)\b/,.45,375,18,44,22],[/\b(chaat masala|amchur|amchoor|asafoetida|hing|kasuri methi)\b/,.5,300,12,50,8],
 [/\b(poha|flattened rice)\b/,.35,350,7,77,1]];
const F={tsp:5,tbsp:15,cup:240};
const r1=n=>Math.round(n*10)/10,q4=n=>Math.max(.25,Math.round(n*4)/4);
// Works out grams, the original millilitres (when the line used a volume unit) and a g/ml density.
function measure(it){
  const mb=it.matchedBy||'',vol=/unit:(cup|tsp|tbsp|ml|l|cl|dl|floz|pint|quart|gallon|shot|glass)/.test(mb);
  const o=it.category==='other'?OV.find(x=>x[0].test(String(it.name).toLowerCase())):null;
  const dens=it.density||1;
  let g=it.unit==='ml'?it.quantity*dens:it.quantity,ml=null;
  if(vol)ml=it.unit==='ml'?it.quantity:it.quantity/dens;
  let nut=it.nutrition,d=null;
  if(o){g=vol?ml*o[1]:it.quantity;d=o[1];nut={kcal:g*o[2]/100,protein:g*o[3]/100,carbs:g*o[4]/100,fat:g*o[5]/100}}
  else if(ml)d=g/ml;
  return {g,ml,d,nut,mb};
}
// Keeps the unit the recipe used: cups/tsp/tbsp for spoon-and-cup lines, pcs for countable things (potato, onion, egg).
export async function parseIngredients(text){
  const lines=String(text).split('\n').map(s=>s.trim()).filter(Boolean),out=[];
  for(const line of lines){
    let items=[];try{items=parse(line)}catch{}
    if(!items.length)throw new Error(`Couldn't read: “${line.slice(0,40)}”. Try something like “2 cups flour”.`);
    for(const it of items){
      const m=measure(it),name=String(it.name).toLowerCase(),u=(m.mb.match(/unit:(cup|tsp|tbsp)\b/)||[])[1];
      let qty,unit,d=null,pc=null;
      if(u&&m.ml){qty=q4(m.ml/F[u]);unit=u;d=m.d?+m.d.toFixed(3):null}
      else if(/\bpiece\b/.test(m.mb)&&getIngredient(name)?.piece>0){
        pc=getIngredient(name).piece;qty=Math.max(.5,Math.round(m.g/pc*2)/2);unit='pcs'}
      else{unit=it.unit==='ml'?'ml':'g';qty=r1(it.unit==='ml'?it.quantity:m.g)||1;if(m.ml&&m.d)d=+m.d.toFixed(3)}
      out.push({name,qty,unit,staple:false,taste:it.always===true,display:line,d,pc,
        macros:{calories:r1(m.nut.kcal),protein:r1(m.nut.protein),carbs:r1(m.nut.carbs),fat:r1(m.nut.fat)}});
    }
  }
  if(!out.length)throw new Error('Paste at least one ingredient.');
  return out;
}
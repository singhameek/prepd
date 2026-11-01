// Offline ingredient parser: wraps ingredient-engine.js (no network, no AI, instant).
import {parseIngredients as parse} from './ingredient-engine.js';
// The engine's own data is thin for South Asian staples (e.g. it treats 1 cup atta as 240 g and ghee as 1 kcal/g),
// so common ones are corrected here: [pattern, g per ml, kcal/100g, protein, carbs, fat].
const OV=[
 [/\b(atta|wheat flour|whole wheat)\b/,.5,340,12,72,2],[/\b(maida|all.?purpose flour)\b/,.53,364,10,76,1],[/\b(besan|gram flour)\b/,.5,387,22,58,7],
 [/\b(semolina|rava|sooji|suji)\b/,.7,360,13,73,1],[/\bghee\b/,.91,900,0,0,100],[/\bpaneer\b/,1.04,296,18,4,23],
 [/\b(curd|dahi|yogh?urt)\b/,1.03,61,3.5,4.7,3.3],[/\b(toor|tur|arhar|moong|mung|masoor|chana|urad|dal|lentils?)\b/,.8,343,22,60,1.5],
 [/\b(jeera|cumin)\b/,.45,375,18,44,22],[/\b(chaat masala|amchur|amchoor|asafoetida|hing|kasuri methi)\b/,.5,300,12,50,8],
 [/\b(poha|flattened rice)\b/,.35,350,7,77,1]];
const VOL=/unit:(cup|tsp|tbsp|ml|l|cl|dl|floz|pint|quart|gallon|shot|glass)/;
const r1=n=>Math.round(n*10)/10;
function fix(it){
  if(it.category!=='other')return it;
  const o=OV.find(x=>x[0].test(String(it.name).toLowerCase()));if(!o)return it;
  const g=VOL.test(it.matchedBy||'')?it.quantity/(it.density||1)*o[1]:it.quantity;
  return {...it,quantity:r1(g),unit:'g',nutrition:{kcal:r1(g*o[2]/100),protein:r1(g*o[3]/100),carbs:r1(g*o[4]/100),fat:r1(g*o[5]/100)}};
}
// Returns one item per ingredient found. `taste` = the parser's `always` flag ("to taste" / "as needed"): no real amount.
export async function parseIngredients(text){
  const lines=String(text).split('\n').map(s=>s.trim()).filter(Boolean),out=[];
  for(const line of lines){
    let items=[];try{items=parse(line).map(fix)}catch{}
    if(!items.length)throw new Error(`Couldn't read: “${line.slice(0,40)}”. Try something like “2 cups flour”.`);
    for(const it of items)out.push({name:String(it.name).toLowerCase(),qty:r1(+it.quantity)||1,unit:it.unit==='ml'?'ml':'g',staple:false,taste:it.always===true,display:line,
      macros:{calories:r1(it.nutrition.kcal),protein:r1(it.nutrition.protein),carbs:r1(it.nutrition.carbs),fat:r1(it.nutrition.fat)}});
  }
  if(!out.length)throw new Error('Paste at least one ingredient.');
  return out;
}
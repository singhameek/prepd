// Guards around the ingredient engine's guesses: tidy lines it is known to misread, and spot results that look wrong.
import {getIngredient} from './ingredient-engine.js';
// The engine reads "minced" as "minced beef" ("2 cloves minced garlic" → Ground Beef). Keep the word only for beef lines.
export function cleanLine(line){
  const s=String(line);
  if(!/\bminced?\b/i.test(s)||/\bbeef\b/i.test(s))return s;
  return s.replace(/\bminced?\b/gi,' ').replace(/\s{2,}/g,' ').replace(/\s+,/g,',').replace(/[,;]\s*$/,'').trim();
}
const PREP=new Set(['minced','mince','chopped','diced','sliced','grated','crushed','ground','fresh','finely','roughly','small','large','medium','whole','boneless','skinless','cooked','raw','dried','frozen','canned','tinned','packed','heaping','level','cups','cup','tbsp','tsp','tablespoon','tablespoons','teaspoon','teaspoons','of','and','or','the','for','taste','pinch','dash','clove','cloves','pieces','piece','pcs','inch','handful','few','some','about','optional','plus','extra']);
const stem=w=>w.replace(/(ies|es|s)$/,'');
const near=(a,b)=>{const x=stem(a),y=stem(b);return x===y||(Math.min(x.length,y.length)>=4&&(x.startsWith(y)||y.startsWith(x)))};
// True when the name the engine chose shares nothing with what the line says (and the engine itself would not map the
// line's words to that name). Such rows are shown with a "Check this" flag.
export function suspect(line,name){
  const nm=String(name).toLowerCase().replace(/\(.*?\)/g,' ').trim();
  const nw=nm.split(/[^a-z]+/).filter(w=>w.length>2&&!['powder','whole','leaves','leaf','seeds','seed','paste'].includes(w));
  const lw=String(line).toLowerCase().split(/[^a-z]+/).filter(w=>w.length>2&&!PREP.has(w));
  if(!lw.length||!nw.length)return false;
  if(nw.some(w=>lw.some(l=>near(l,w))))return false;
  const first=nm.split(' ')[0];
  const known=l=>{try{const g=getIngredient(l);return !!g&&String(g.name||'').toLowerCase().includes(first)}catch{return false}};
  return !lw.some(known);
}
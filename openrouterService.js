import {getSetting} from './db.js';
const URL_='https://openrouter.ai/api/v1/chat/completions';
const num={type:'number'},str={type:'string'};
const ingredient={type:'object',additionalProperties:false,
  required:['canonical_name','metric_quantity','metric_unit','ui_fractional_display','estimated_macros'],
  properties:{canonical_name:str,metric_quantity:num,metric_unit:{type:'string',enum:['g','ml','pcs']},ui_fractional_display:str,
    estimated_macros:{type:'object',additionalProperties:false,required:['calories','protein','carbs','fat'],
      properties:{calories:num,protein:num,carbs:num,fat:num}}}};
const SCHEMA={name:'recipe_parse',strict:true,schema:{type:'object',additionalProperties:false,
  required:['recipe_name','servings','ingredients'],
  properties:{recipe_name:str,servings:num,ingredients:{type:'array',items:ingredient}}}};
const SYSTEM=`Convert recipe text into JSON. For each ingredient: lowercase singular canonical_name; convert vague amounts ("splash","handful","pinch") to realistic metric estimates (g/ml, or pcs for countable items); ui_fractional_display is a friendly container fraction (e.g. "~9/10ths of a jug", "¾ full", "half a block") or plain amount; estimated_macros are for the whole quantity listed. Output only JSON.`;
export async function parseRecipeText(text,{model}={}){
  const key=await getSetting('openrouterKey');
  if(!key)throw new Error('Add your OpenRouter API key in Settings.');
  model??=await getSetting('model','anthropic/claude-3.5-sonnet');
  const res=await fetch(URL_,{method:'POST',
    headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','HTTP-Referer':location.origin,'X-Title':'SmartKitchen'},
    body:JSON.stringify({model,temperature:0,messages:[{role:'system',content:SYSTEM},{role:'user',content:text}],
      response_format:{type:'json_schema',json_schema:SCHEMA}})});
  if(!res.ok)throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0,200)}`);
  const j=await res.json();
  const content=j.choices?.[0]?.message?.content;
  if(!content)throw new Error('Empty AI response.');
  return JSON.parse(content.replace(/^```json|```$/g,'').trim());
}

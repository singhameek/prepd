import {db,today,requestPersistence,getSetting,setSetting,exportUserData,importUserData,downloadBackup} from './db.js';
import {parseRecipeText} from './openrouterService.js';
import {deductIngredientsFromPantry,checkUpcomingMenuShortages,convertMetricToFractionalUI,restockFromGrocery} from './inventoryEngine.js';
const $=s=>document.querySelector(s),m=$('#m');
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const TABS=[['pantry','Pantry'],['plan','Plan'],['import','Import'],['grocery','Grocery'],['settings','Settings']];
let view=location.hash.slice(1)||'pantry';
$('#n').innerHTML=TABS.map(([k,l])=>`<button data-v="${k}">${l}</button>`).join('');
$('#n').onclick=e=>{const v=e.target.dataset?.v;if(v){view=v;location.hash=v;render()}};
const title=(t,s='')=>{$('#t').textContent=t;$('#s').textContent=s;document.title=t+' · SmartKitchen'};
const bar=(p,low)=>`<div class="bar-t"><div class="bar-f ${low?'low':''}" style="width:${Math.round(p*100)}%"></div></div>`;
const V={
async pantry(){
  const it=await db.pantryItems.toArray();title('Pantry',it.length+' items');
  m.innerHTML=(it.length?it.map(i=>{const p=i.capacity?Math.min(1,i.qty/i.capacity):1;
    return `<div class="row"><div><b>${esc(i.name)}</b> <span class="sum">${convertMetricToFractionalUI(i.qty,i.capacity)} · ${Math.round(i.qty)} ${i.unit}</span>${bar(p,p<.2)}</div><button class="g" data-del="${i.id}">Remove</button></div>`}).join('')
    :'<div class="empty">Nothing here yet. Import a recipe or check off groceries to stock up.</div>')+
  `<h2>Add item</h2><div class="f"><input id="pn" placeholder="Name"><input id="pq" type="number" placeholder="Amount"><select id="pu"><option>g<option>ml<option>pcs</select></div><button id="pa">Add to pantry</button>`;
  m.onclick=async e=>{if(e.target.dataset.del){await db.pantryItems.delete(+e.target.dataset.del);render()}
    if(e.target.id==='pa'){const n=$('#pn').value.trim(),q=+$('#pq').value;if(n&&q>0){await db.pantryItems.add({name:n,qty:q,capacity:q,unit:$('#pu').value});render()}}};
},
async plan(){
  const rs=await db.recipes.toArray(),logs=await db.nutritionLogs.where('date').equals(today()).toArray(),plans=await db.mealPlans.where('date').aboveOrEqual(today()).sortBy('date');
  const t=logs.reduce((a,l)=>{for(const k of['calories','protein','carbs','fat'])a[k]+=l[k]||0;return a},{calories:0,protein:0,carbs:0,fat:0});
  title('Plan',`Today: ${Math.round(t.calories)} kcal · P ${Math.round(t.protein)} C ${Math.round(t.carbs)} F ${Math.round(t.fat)}`);
  const rn=id=>rs.find(r=>r.id===id)?.name||'Deleted recipe';
  m.innerHTML=`<h2>Upcoming meals</h2>`+(plans.length?plans.map(p=>`<div class="row"><div><b>${esc(rn(p.recipeId))}</b><div class="sum">${p.date}${p.logged?' · logged':''}</div></div>${p.logged?'':`<button data-log="${p.id}">Log meal</button>`}<button class="g" data-rm="${p.id}">Remove</button></div>`).join(''):'<div class="empty">No meals planned. Add one from your recipes below.</div>')+
  `<h2>Recipes</h2>`+(rs.length?rs.map(r=>`<div class="row"><div><b>${esc(r.name)}</b><div class="sum">${r.ingredients.length} ingredients</div></div><input type="date" style="width:9rem" data-d="${r.id}" value="${today()}"><button data-add="${r.id}">Plan</button></div>`).join(''):'<div class="empty">No recipes yet. Use Import.</div>')+
  `<h2>Shortages</h2><button id="sh">Check next 48 hours</button><div id="so"></div>`;
  m.onclick=async e=>{const d=e.target.dataset;
    if(d.add){await db.mealPlans.add({date:m.querySelector(`[data-d="${d.add}"]`).value,recipeId:+d.add,scale:1,logged:0});await checkUpcomingMenuShortages(48,{addToGrocery:true});render()}
    if(d.rm){await db.mealPlans.delete(+d.rm);render()}
    if(d.log){const p=await db.mealPlans.get(+d.log);await deductIngredientsFromPantry(p.recipeId,p.scale||1);await db.mealPlans.update(p.id,{logged:1});render()}
    if(e.target.id==='sh'){const s=await checkUpcomingMenuShortages(48,{addToGrocery:true});$('#so').innerHTML=s.length?s.map(x=>`<div class="row">${esc(x.name)}: need ${x.qty} ${x.unit} more</div>`).join('')+'<div class="sum">Added to Grocery.</div>':'<div class="empty">You have everything.</div>'}};
},
async import(){
  title('Import recipe','Paste text, get exact quantities');
  m.innerHTML=`<textarea id="rt" placeholder="Paste a recipe, e.g. 2 eggs, a splash of milk, a handful of spinach…"></textarea><div class="f"><button id="go">Parse recipe</button></div><div class="msg" id="er"></div><div id="pv"></div>`;
  m.onclick=async e=>{if(e.target.id==='go'){const b=e.target;b.disabled=true;b.textContent='Parsing…';$('#er').textContent='';
    try{const r=await parseRecipeText($('#rt').value);
      const ings=r.ingredients.map(i=>({name:i.canonical_name,qty:i.metric_quantity,unit:i.metric_unit,display:i.ui_fractional_display,macros:i.estimated_macros}));
      const id=await db.recipes.add({name:r.recipe_name,servings:r.servings,ingredients:ings});
      $('#pv').innerHTML=`<h2>Saved: ${esc(r.recipe_name)}</h2>`+ings.map(i=>`<div class="row"><div>${esc(i.name)}<div class="sum">${i.qty} ${i.unit} · ${esc(i.display)} · ${Math.round(i.macros.calories)} kcal</div></div></div>`).join('');
    }catch(x){$('#er').textContent=x.message}b.disabled=false;b.textContent='Parse recipe'}};
},
async grocery(){
  const g=await db.groceryList.toArray();title('Grocery',g.length+' to buy');
  m.innerHTML=(g.length?g.map(i=>`<div class="row"><div><b>${esc(i.name)}</b> <span class="sum">${i.qty} ${i.unit}</span></div><button data-buy="${i.id}">Bought</button><button class="g" data-x="${i.id}">Remove</button></div>`).join(''):'<div class="empty">List is clear. Planned meals add missing items here.</div>')+
  `<h2>Add item</h2><div class="f"><input id="gn" placeholder="Name"><input id="gq" type="number" placeholder="Amount"><select id="gu"><option>g<option>ml<option>pcs</select></div><button id="ga">Add to list</button>`;
  m.onclick=async e=>{const d=e.target.dataset;
    if(d.buy){await restockFromGrocery(+d.buy);render()}if(d.x){await db.groceryList.delete(+d.x);render()}
    if(e.target.id==='ga'){const n=$('#gn').value.trim(),q=+$('#gq').value;if(n&&q>0){await db.groceryList.add({name:n,qty:q,unit:$('#gu').value,checked:0});render()}}};
},
async settings(){
  title('Settings');const k=await getSetting('openrouterKey',''),md=await getSetting('model','anthropic/claude-3.5-sonnet');
  m.innerHTML=`<h2>OpenRouter</h2><input id="k" type="password" placeholder="API key" value="${esc(k)}"><div class="f"><input id="md" value="${esc(md)}"></div><button id="sv">Save</button>
  <h2>Data</h2><div class="f"><button id="ex">Export JSON</button><button class="g" id="im">Import JSON</button></div><input id="fi" type="file" accept="application/json" hidden>
  <h2>Alerts</h2><button class="g" id="nt">Enable shortage notifications</button><div class="sum" id="ps"></div>`;
  $('#ps').textContent=(await navigator.storage?.persisted?.())?'Storage is persistent.':'Storage persistence not granted; export backups regularly.';
  m.onclick=async e=>{const i=e.target.id;
    if(i==='sv'){await setSetting('openrouterKey',$('#k').value.trim());await setSetting('model',$('#md').value.trim());e.target.textContent='Saved'}
    if(i==='ex')downloadBackup(await exportUserData());if(i==='im')$('#fi').click();
    if(i==='nt'){e.target.textContent=await Notification.requestPermission()==='granted'?'Enabled':'Blocked in browser settings'}};
  $('#fi').onchange=async e=>{try{await importUserData(await e.target.files[0].text());render()}catch(x){alert(x.message)}};
}};
async function render(){document.querySelectorAll('#n button').forEach(b=>b.classList.toggle('on',b.dataset.v===view));await (V[view]||V.pantry)()}
addEventListener('hashchange',()=>{view=location.hash.slice(1)||'pantry';render()});
requestPersistence();render();
if('serviceWorker'in navigator){navigator.serviceWorker.register('sw.js').then(async r=>{try{await r.periodicSync?.register('shortage-check',{minInterval:36e5})}catch{}});
  navigator.serviceWorker.addEventListener('message',e=>e.data==='check-shortages'&&checkUpcomingMenuShortages(48))}
checkUpcomingMenuShortages(48);setInterval(()=>checkUpcomingMenuShortages(48),36e5);
let dip;addEventListener('beforeinstallprompt',e=>{e.preventDefault();dip=e;window.installApp=()=>dip.prompt()});

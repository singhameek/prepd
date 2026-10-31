import {db,today,requestPersistence,autoRestore} from './db.js';
import {parseIngredients} from './openrouterService.js';
import {deductIngredientsFromPantry,checkUpcomingMenuShortages,convertMetricToFractionalUI,restockFromGrocery} from './inventoryEngine.js';
const $=(s,r=document)=>r.querySelector(s),m=$('#m');
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const SLOTS=[['breakfast','Breakfast','--b','🍳'],['lunch','Lunch','--l','🥪'],['dinner','Dinner','--d','🍝']];
const iso=d=>d.toLocaleDateString('sv');
const addDays=(s,n)=>{const d=new Date(s+'T12:00');d.setDate(d.getDate()+n);return iso(d)};
const monday=s=>addDays(s,-((new Date(s+'T12:00').getDay()+6)%7));
const fmt=(s,o)=>new Date(s+'T12:00').toLocaleDateString('en',o);
const kcal=(r,sc=1)=>Math.round(r.ingredients.reduce((a,i)=>a+i.macros.calories,0)*sc);
const ICON={plan:'<path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>',pantry:'<path d="M8 3h8v3H8zM6 6h12v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1zM6 11h12"/>',grocery:'<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>'};
let tab='plan',sel=today();
const reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
const pop=(el,dx=0)=>!reduce&&el.animate([{opacity:0,transform:`translateX(${dx}px) translateY(${dx?0:10}px)`},{opacity:1,transform:'none'}],{duration:300,easing:'cubic-bezier(.2,.9,.3,1)'});
function toast(t){const e=document.createElement('div');e.className='toast';e.textContent=t;document.body.append(e);requestAnimationFrame(()=>requestAnimationFrame(()=>e.classList.add('on')));setTimeout(()=>{e.classList.remove('on');setTimeout(()=>e.remove(),400)},2600)}
const head=(t,s='')=>{$('#t').textContent=t;$('#s').textContent=s};

// Bottom sheet: spring-like open, drag to dismiss with momentum projection
function sheet(html){
  const sc=document.createElement('div'),sh=document.createElement('div');sc.className='scrim';sh.className='sheet';
  sh.innerHTML=`<div class="grab"><i></i></div><div class="sb">${html}</div>`;document.body.append(sc,sh);
  requestAnimationFrame(()=>requestAnimationFrame(()=>{sc.classList.add('on');sh.classList.add('on')}));
  const close=()=>{sc.classList.remove('on');sh.classList.remove('on');sh.style.transform='';setTimeout(()=>{sc.remove();sh.remove()},500)};
  sc.onclick=close;const g=$('.grab',sh);let y0,ly,lt,v=0,on=0;
  g.onpointerdown=e=>{g.setPointerCapture(e.pointerId);on=1;y0=ly=e.clientY;lt=e.timeStamp;sh.style.transition='none'};
  g.onpointermove=e=>{if(!on)return;const dy=e.clientY-y0;v=(e.clientY-ly)/(e.timeStamp-lt||1);ly=e.clientY;lt=e.timeStamp;sh.style.transform=`translateY(${dy>0?dy:dy*.25}px)`};
  g.onpointerup=e=>{if(!on)return;on=0;sh.style.transition='';const dy=e.clientY-y0;(dy+v*99>140)?close():sh.style.transform=''};
  return {el:sh,close,q:s=>$(s,sh)};
}
const busy=(b,on,t)=>{b.disabled=on;b.innerHTML=on?`<span class="sp"></span>${t}`:t};

const delRecipe=async id=>{await db.mealPlans.where('recipeId').equals(id).delete();await db.recipes.delete(id)};
// Two-tap confirm: first tap arms the button, second tap (within 3s) confirms
const confirmDel=async b=>{if(b.dataset.armed)return true;const t=b.textContent;b.dataset.armed=1;b.textContent='Tap again to delete';setTimeout(()=>{delete b.dataset.armed;b.textContent=t},3000);return false};
async function renderPlan(dx=0){
  const wk=monday(sel),days=[...Array(7)].map((_,i)=>addDays(wk,i));
  const plans=await db.mealPlans.where('date').between(days[0],days[6],true,true).toArray();
  const recs=new Map((await db.recipes.toArray()).map(r=>[r.id,r]));
  const dayPlans=plans.filter(p=>p.date===sel&&recs.has(p.recipeId));
  const total=dayPlans.reduce((a,p)=>a+kcal(recs.get(p.recipeId),p.scale||1),0);
  head(sel===today()?'Today':fmt(sel,{weekday:'long'}),fmt(sel,{day:'numeric',month:'long'})+(total?` · ${total.toLocaleString()} kcal planned`:''));
  m.innerHTML=`<div class="wk"><button class="n" data-wk="-7" aria-label="Previous week">‹</button>${days.map(d=>`<button class="d ${d===sel?'sel':''} ${d===today()?'t':''}" data-d="${d}"><span>${fmt(d,{weekday:'short'})}</span><b>${+d.slice(8)}</b><i class="${plans.some(p=>p.date===d)?'on':''}"></i></button>`).join('')}<button class="n" data-wk="7" aria-label="Next week">›</button></div><div id="body">${SLOTS.map(([k,l,c,em])=>{
    const ps=dayPlans.filter(x=>x.slot===k);
    return ps.map(p=>{const r=recs.get(p.recipeId);
      return `<button class="slot" style="--c:var(${c})" data-meal="${p.id}"><span class="em">${em}</span><div class="t"><div class="l">${l}</div><div class="nm">${esc(r.name)}</div><div class="l">${kcal(r,p.scale||1)} kcal</div></div>${p.logged?'<span class="ok">✓ Eaten</span>':''}</button>`}).join('')+
    (ps.length?`<button class="more" style="--c:var(${c})" data-add="${k}">+ Add another ${l.toLowerCase()}</button>`
    :`<button class="slot e" style="--c:var(${c})" data-add="${k}"><span class="em">${em}</span><div class="t"><div class="l">${l}</div><div class="nm">What’s cooking?</div></div><span class="plus">+</span></button>`)}).join('')}</div>`;
  if(dx)pop($('#body'),dx*24);
  m.onclick=async e=>{const b=e.target.closest('button');if(!b)return;const d=b.dataset;
    if(d.wk){sel=addDays(sel,+d.wk);renderPlan(+d.wk>0?1:-1)}
    else if(d.d){const dir=d.d>sel?1:d.d<sel?-1:0;sel=d.d;renderPlan(dir)}
    else if(d.add)addSheet(d.add);else if(d.meal)mealSheet(+d.meal)};
}
async function plan(slot,recipeId){
  await db.mealPlans.add({date:sel,slot,recipeId,scale:1,logged:0});
  if(Notification?.permission==='default')Notification.requestPermission();
  const s=await checkUpcomingMenuShortages(48,{addToGrocery:true});
  if(s.length)toast(`${s.length} item${s.length>1?'s':''} added to Grocery`);
  render();
}
async function addSheet(slot){
  const label=SLOTS.find(s=>s[0]===slot)[1].toLowerCase(),saved=await db.recipes.toArray();
  const sh=sheet(`<h3>Add ${label}</h3><input id="nm" placeholder="Meal name" autocomplete="off"><textarea id="tx" placeholder="Paste ingredients, one per line&#10;2 eggs&#10;a splash of milk&#10;a handful of spinach"></textarea><div class="err" id="er"></div><button id="go" style="width:100%">Add meal</button>${saved.length?`<h4>Saved meals</h4>${saved.map(r=>`<div class="row" data-row="${r.id}"><button class="r" data-r="${r.id}" style="flex:1;text-align:left;color:var(--ink);padding:0"><b>${esc(r.name)}</b><div class="s">${kcal(r)} kcal · tap to add</div></button><button class="r" data-del="${r.id}" style="padding:.4rem .6rem">Delete</button></div>`).join('')}`:''}`);
  sh.el.onclick=async e=>{const b=e.target.closest('button');if(!b)return;
    if(b.dataset.r){sh.close();plan(slot,+b.dataset.r)}
    if(b.dataset.del&&await confirmDel(b)){await delRecipe(+b.dataset.del);sh.q(`[data-row="${b.dataset.del}"]`).remove();render()}
    if(b.id==='go'){const name=sh.q('#nm').value.trim(),text=sh.q('#tx').value.trim(),er=sh.q('#er');er.textContent='';
      if(!name)return sh.q('#nm').focus(),er.textContent='Give your meal a name.';
      if(!text)return sh.q('#tx').focus(),er.textContent='Paste at least one ingredient.';
      busy(b,1,'Reading ingredients…');
      try{const ingredients=await parseIngredients(text),id=await db.recipes.add({name,text,ingredients});sh.close();plan(slot,id)}
      catch(x){er.textContent=x.message;busy(b,0,'Add meal')}}};
}
async function mealSheet(id){
  const p=await db.mealPlans.get(id),r=await db.recipes.get(p.recipeId);
  const sh=sheet(`<h3>Edit meal</h3><input id="nm" value="${esc(r.name)}"><textarea id="tx">${esc(r.text||'')}</textarea><div class="err" id="er"></div>
  <div class="s" style="color:var(--mute);font-size:.88rem;margin-bottom:1rem">${r.ingredients.map(i=>`${Math.round(i.qty)} ${i.unit} ${esc(i.name)}`).join(' · ')} — ${kcal(r)} kcal</div>
  <div class="f"><button id="sv">Save changes</button>${p.logged?'':'<button class="g" id="eat">I ate this</button>'}</div><button class="r" id="rm" style="width:100%;margin-top:.4rem">Remove from plan</button><button class="r" id="dm" style="width:100%">Delete meal from all plans and saved meals</button>`);
  sh.el.onclick=async e=>{const b=e.target.closest('button');if(!b)return;
    if(b.id==='rm'){await db.mealPlans.delete(id);sh.close();render()}
    if(b.id==='dm'&&await confirmDel(b)){await delRecipe(r.id);sh.close();toast('Meal deleted');render()}
    if(b.id==='eat'){const {missing}=await deductIngredientsFromPantry(r.id,p.scale||1);await db.mealPlans.update(id,{logged:1});sh.close();toast(missing.length?`Logged. Pantry was short on ${missing[0].name}`:'Logged. Pantry updated');render()}
    if(b.id==='sv'){const name=sh.q('#nm').value.trim(),text=sh.q('#tx').value.trim(),er=sh.q('#er');
      if(!name||!text)return er.textContent='Name and ingredients can’t be empty.';
      busy(b,1,'Saving…');
      try{const ch={name};if(text!==r.text){ch.text=text;ch.ingredients=await parseIngredients(text)}
        await db.recipes.update(r.id,ch);sh.close();toast('Saved');checkUpcomingMenuShortages(48,{addToGrocery:true});render()}
      catch(x){er.textContent=x.message;busy(b,0,'Save changes')}}};
}
async function renderPantry(){
  const it=await db.pantryItems.toArray();head('Pantry',it.length?`${it.length} item${it.length>1?'s':''}`:'');
  m.innerHTML=it.length?it.map(i=>{const p=i.capacity?Math.min(1,i.qty/i.capacity):1;return `<button class="row" data-i="${i.id}"><div class="t"><b>${esc(i.name)}</b> <span class="s">${convertMetricToFractionalUI(i.qty,i.capacity)} · ${Math.round(i.qty)} ${i.unit}</span><div class="bt"><div class="bf ${p<.2?'low':''}" style="width:${p*100}%"></div></div></div></button>`}).join('')
   :'<div class="empty" data-e="🧺"><b>Your pantry is empty</b>Add what you have, or tick off groceries to stock it.</div>';
  m.innerHTML+='<button class="fab" data-new aria-label="Add item">+</button>';
  m.onclick=async e=>{const b=e.target.closest('button');if(!b)return;
    if('new'in b.dataset)itemSheet();else if(b.dataset.i)itemSheet(await db.pantryItems.get(+b.dataset.i))};
}
function itemSheet(it){
  const sh=sheet(`<h3>${it?'Edit item':'Add to pantry'}</h3><input id="nm" placeholder="Name" value="${it?esc(it.name):''}"><div class="f"><input id="q" type="number" inputmode="decimal" placeholder="Amount" value="${it?Math.round(it.qty):''}"><input id="u" value="${it?it.unit:'g'}" list="us"><datalist id="us"><option>g<option>ml<option>pcs</datalist></div><div class="err" id="er"></div><button id="sv" style="width:100%">${it?'Save':'Add item'}</button>${it?'<button class="r" id="rm" style="width:100%;margin-top:.4rem">Remove</button>':''}`);
  sh.el.onclick=async e=>{const b=e.target.closest('button');if(!b)return;
    if(b.id==='rm'){await db.pantryItems.delete(it.id);sh.close();render()}
    if(b.id==='sv'){const name=sh.q('#nm').value.trim(),qty=+sh.q('#q').value,unit=sh.q('#u').value;
      if(!name||!(qty>0)||!['g','ml','pcs'].includes(unit))return sh.q('#er').textContent='Enter a name, an amount, and unit g, ml or pcs.';
      it?await db.pantryItems.update(it.id,{name,qty,unit,capacity:Math.max(it.capacity||0,qty)}):await db.pantryItems.add({name,qty,unit,capacity:qty});
      sh.close();render()}};
}
async function renderGrocery(){
  const g=await db.groceryList.toArray();head('Grocery',g.length?`${g.length} to buy`:'');
  m.innerHTML=(g.length?g.map(i=>`<div class="row" data-row="${i.id}"><button class="chk" data-buy="${i.id}" aria-label="Mark ${esc(i.name)} bought"></button><div class="t"><b>${esc(i.name)}</b> <span class="s">${i.qty} ${i.unit}</span></div><button class="r" data-x="${i.id}" style="padding:.4rem">✕</button></div>`).join('')
   :'<div class="empty" data-e="🛒"><b>Nothing to buy</b>Meals you plan add missing ingredients here.</div>')+'<button class="fab" data-new aria-label="Add item">+</button>';
  m.onclick=async e=>{const b=e.target.closest('button');if(!b)return;const d=b.dataset;
    if(d.buy||d.x){const row=$(`[data-row="${d.buy||d.x}"]`);if(d.buy){b.classList.add('on');b.textContent='✓';await new Promise(r=>setTimeout(r,250));await restockFromGrocery(+d.buy);toast('Moved to pantry')}else await db.groceryList.delete(+d.x);
      row.classList.add('gone');setTimeout(render,300)}
    if('new'in d){const sh=sheet(`<h3>Add to list</h3><input id="nm" placeholder="Name"><div class="f"><input id="q" type="number" inputmode="decimal" placeholder="Amount"><input id="u" value="g" list="us"><datalist id="us"><option>g<option>ml<option>pcs</datalist></div><div class="err" id="er"></div><button id="sv" style="width:100%">Add to list</button>`);
      sh.el.onclick=async ev=>{if(ev.target.id!=='sv')return;const name=sh.q('#nm').value.trim(),qty=+sh.q('#q').value,unit=sh.q('#u').value;
        if(!name||!(qty>0)||!['g','ml','pcs'].includes(unit))return sh.q('#er').textContent='Enter a name, an amount, and unit g, ml or pcs.';
        await db.groceryList.add({name,qty,unit,checked:0});sh.close();render()}}};
}
async function render(){
  const n=await db.groceryList.count();
  $('#n').innerHTML=[['plan','Plan'],['pantry','Pantry'],['grocery','Grocery']].map(([k,l])=>`<button data-t="${k}" class="${k===tab?'on':''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>${l}${k==='grocery'&&n?`<span class="bd">${n}</span>`:''}</button>`).join('');
  await({plan:renderPlan,pantry:renderPantry,grocery:renderGrocery}[tab])();
}
$('#n').onclick=e=>{const t=e.target.closest('button')?.dataset.t;if(t&&t!==tab){tab=t;scrollTo(0,0);render().then(()=>pop(m))}};
(async()=>{
  await requestPersistence();await autoRestore();await render();
  if('serviceWorker'in navigator){navigator.serviceWorker.register('sw.js').then(async r=>{try{await r.periodicSync?.register('shortage-check',{minInterval:36e5})}catch{}});
    navigator.serviceWorker.addEventListener('message',e=>e.data==='check-shortages'&&checkUpcomingMenuShortages(48))}
  checkUpcomingMenuShortages(48);setInterval(()=>checkUpcomingMenuShortages(48),36e5);
})();
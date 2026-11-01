import {db,today,requestPersistence,autoRestore,setOnBackup,exportUserData,importUserData} from './db.js';
import {parseIngredients} from './ingredientParser.js';
import {findRecipe} from './recipeFinder.js';
import * as cloud from './cloud.js';
import {resolveUnits,learn,loadProfiles} from './units.js';
import {deductIngredientsFromPantry,checkUpcomingMenuShortages,convertMetricToFractionalUI,restockFromGrocery,groceryText,planScale,isStaple,pkgFor,setPrefs,sizeText} from './inventoryEngine.js';
const UNITS=['g','ml','pcs','tsp','tbsp','cup'],q1=n=>+(+n).toFixed(1);
const $=(s,r=document)=>r.querySelector(s),m=$('#m');
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const SLOTS=[['breakfast','Breakfast','--b','🍳'],['lunch','Lunch','--l','🥪'],['dinner','Dinner','--d','🍝']];
const iso=d=>d.toLocaleDateString('sv');
const addDays=(s,n)=>{const d=new Date(s+'T12:00');d.setDate(d.getDate()+n);return iso(d)};
const monday=s=>addDays(s,-((new Date(s+'T12:00').getDay()+6)%7));
const fmt=(s,o)=>new Date(s+'T12:00').toLocaleDateString('en',o);
const kcal=(r,sc=1)=>Math.round(r.ingredients.reduce((a,i)=>a+i.macros.calories,0)*sc);
const ICON={plan:'<path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>',pantry:'<path d="M8 3h8v3H8zM6 6h12v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1zM6 11h12"/>',settings:'<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',grocery:'<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>'};
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
  const total=dayPlans.reduce((a,p)=>a+kcal(recs.get(p.recipeId),planScale(p,recs.get(p.recipeId))),0);
  head(sel===today()?'Today':fmt(sel,{weekday:'long'}),fmt(sel,{day:'numeric',month:'long'})+(total?` · ${total.toLocaleString()} kcal planned`:''));
  m.innerHTML=`<div class="wk"><button class="n" data-wk="-7" aria-label="Previous week">‹</button>${days.map(d=>`<button class="d ${d===sel?'sel':''} ${d===today()?'t':''}" data-d="${d}"><span>${fmt(d,{weekday:'short'})}</span><b>${+d.slice(8)}</b><i class="${plans.some(p=>p.date===d)?'on':''}"></i></button>`).join('')}<button class="n" data-wk="7" aria-label="Next week">›</button></div><div id="body">${SLOTS.map(([k,l,c,em])=>{
    const ps=dayPlans.filter(x=>x.slot===k);
    return ps.map(p=>{const r=recs.get(p.recipeId);
      return `<button class="slot" style="--c:var(${c})" data-meal="${p.id}"><span class="em">${em}</span><div class="t"><div class="l">${l}</div><div class="nm">${esc(r.name)}</div><div class="l">${kcal(r,planScale(p,r))} kcal</div></div>${p.logged?'<span class="ok">✓ Eaten</span>':''}</button>`}).join('')+
    (ps.length?`<button class="more" style="--c:var(${c})" data-add="${k}">+ Add another ${l.toLowerCase()}</button>`
    :`<button class="slot e" style="--c:var(${c})" data-add="${k}"><span class="em">${em}</span><div class="t"><div class="l">${l}</div><div class="nm">What’s cooking?</div></div><span class="plus">+</span></button>`)}).join('')}</div>`;
  if(dx)pop($('#body'),dx*24);
  m.onclick=async e=>{const b=e.target.closest('button');if(!b)return;const d=b.dataset;
    if(d.wk){sel=addDays(sel,+d.wk);renderPlan(+d.wk>0?1:-1)}
    else if(d.d){const dir=d.d>sel?1:d.d<sel?-1:0;sel=d.d;renderPlan(dir)}
    else if(d.add)addSheet(d.add);else if(d.meal)mealSheet(+d.meal)};
}
// Re-checks the week against the pantry and updates the grocery list; anything the engine had to guess (a pantry item
// counted in pcs, a cup of something unknown) is looked up, then the check is repeated with the real numbers.
const sync=async()=>{const r=await checkUpcomingMenuShortages(168,{addToGrocery:true});
  if(await resolveUnits())return checkUpcomingMenuShortages(168,{addToGrocery:true});return r};
const shareOn=async()=>(await db.appSettings.get('cloud_share'))?.value!==false;
async function plan(slot,recipeId,portions=1){
  await db.mealPlans.add({date:sel,slot,recipeId,portions,logged:0});
  if(Notification?.permission==='default')Notification.requestPermission();
  const s=await sync();
  if(s.length)toast(`${s.length} item${s.length>1?'s':''} added to Grocery`);
  render();
}
async function addSheet(slot){
  const label=SLOTS.find(s=>s[0]===slot)[1].toLowerCase(),saved=await db.recipes.toArray();
  const sh=sheet(`<h3>Add ${label}</h3><input id="nm" placeholder="Meal name, e.g. Paneer butter masala" autocomplete="off"><button class="g" id="find" style="width:100%;margin-bottom:.8rem">🔎 Find recipe online</button><textarea id="tx" placeholder="…or paste ingredients, one per line&#10;2 eggs&#10;a splash of milk"></textarea><div class="f" style="align-items:center"><span>This dish serves</span><input id="sr" type="number" min="1" step="1" value="1" style="margin:0"></div><div class="f" style="align-items:center;margin:.5rem 0 .8rem"><span>My portions</span><input id="pp" type="number" min="0.5" step="0.5" value="1" style="margin:0"></div><div class="err" id="er"></div><button id="go" style="width:100%">Add meal</button>${saved.length?`<h4>Saved meals</h4>${saved.map(r=>`<div class="row" data-row="${r.id}"><button class="r" data-r="${r.id}" style="flex:1;text-align:left;color:var(--ink);padding:0"><b>${esc(r.name)}</b><div class="s">${kcal(r)} kcal · tap to add</div></button><button class="r" data-del="${r.id}" style="padding:.4rem .6rem">Delete</button></div>`).join('')}`:''}`);
  const body=sh.q('.sb'),mainHTML=body.innerHTML;let rv,stash={};
  const draw=()=>{body.innerHTML=`<h3>Check ingredients</h3><div style="color:var(--mute);font-size:.88rem;margin-bottom:.7rem">From ${rv.url?`<a href="${esc(rv.url)}" target="_blank" rel="noopener" style="color:var(--acc)">${esc(new URL(rv.url).hostname.replace('www.',''))}</a>`:'the Prepd community'} · whole recipe. Fix anything that looks off.</div><input id="nm" value="${esc(rv.name)}"><div class="f" style="align-items:center"><span>This dish serves</span><input id="yd" type="number" min="1" step="1" value="${rv.yield}" style="margin:0"></div><div class="f" style="align-items:center;margin:.5rem 0 .8rem"><span>My portions</span><input id="mk" type="number" min="0.25" step="0.25" value="${rv.making}" style="margin:0"></div>${rv.items.map((i,k)=>`<div class="row"><div class="t"><b>${esc(i.name)}</b><div class="s">${esc(i.display)}</div></div><input class="qi" data-k="${k}" type="number" step="any" value="${q1(i.qty)}" style="width:5.2rem;margin:0"><span>${i.unit}</span><button class="r" data-rm="${k}" aria-label="Remove">✕</button></div>`).join('')}<div class="err" id="er"></div><button id="ok" style="width:100%">Add meal</button><button class="g" id="back" style="width:100%;margin-top:.5rem">Back</button>`};
  sh.el.oninput=e=>{if(rv&&e.target.id==='nm')rv.name=e.target.value};
  sh.el.onchange=e=>{if(!rv)return;const t=e.target;
    if(t.id==='mk')rv.making=Math.max(.25,+t.value||1);
    if(t.id==='yd')rv.yield=Math.max(1,Math.round(+t.value)||1);
    if(t.classList.contains('qi'))rv.items[+t.dataset.k].qty=Math.max(0,+t.value||0)};
  const finish=async(name,text,ingredients,sourceUrl,servings=1,portions=1,share=true)=>{const id=await db.recipes.add({name,text,ingredients,sourceUrl,servings});
    const on=share&&await shareOn();learn(ingredients,on);if(on)cloud.shareRecipe(name,ingredients,servings,sourceUrl);sh.close();plan(slot,id,portions)};
  sh.el.onclick=async e=>{const b=e.target.closest('button');if(!b)return;const er=sh.q('#er');
    if(b.dataset.r){const pp=Math.max(.25,+sh.q('#pp')?.value||1);sh.close();plan(slot,+b.dataset.r,pp)}
    if(b.dataset.del&&await confirmDel(b)){await delRecipe(+b.dataset.del);sh.q(`[data-row="${b.dataset.del}"]`).remove();render()}
    if(b.id==='find'){const name=sh.q('#nm').value.trim();er.textContent='';
      if(!name)return sh.q('#nm').focus(),er.textContent='Type the meal name first.';
      try{const c=await cloud.findCommunity(name);
        if(c){stash={nm:name,tx:sh.q('#tx').value};rv={name,url:'',yield:c.yield,making:1,items:c.items,community:true};draw()}
        else{const f=await findRecipe(name,t=>busy(b,1,t));busy(b,1,'Checking ingredients…');
          const items=await parseIngredients(f.lines.join('\n'));
          stash={nm:name,tx:sh.q('#tx').value};rv={name,url:f.url,yield:f.yield,making:1,items};draw()}}
      catch(x){er.textContent=x.message+' Paste the ingredients below instead.';busy(b,0,'🔎 Find recipe online')}}
    if(b.id==='back'){body.innerHTML=mainHTML;sh.q('#nm').value=rv.name;sh.q('#tx').value=stash.tx||'';rv=null}
    if(b.dataset.rm){rv.items.splice(+b.dataset.rm,1);draw()}
    if(b.id==='ok'){const items=rv.items.map(i=>({...i})).filter(i=>i.qty>0);
      const name=rv.name.trim();if(!name)return er.textContent='Give your meal a name.';
      if(!items.length)return er.textContent='Keep at least one ingredient.';
      finish(name,items.map(i=>`${q1(i.qty)} ${i.unit} ${i.name}`).join('\n'),items,rv.url,rv.yield,rv.making,!rv.community)}
    if(b.id==='go'){const name=sh.q('#nm').value.trim(),text=sh.q('#tx').value.trim();er.textContent='';
      if(!name)return sh.q('#nm').focus(),er.textContent='Give your meal a name.';
      if(!text)return sh.q('#tx').focus(),er.textContent='Paste ingredients, or tap Find recipe online.';
      busy(b,1,'Reading ingredients…');
      const serves=Math.max(1,Math.round(+sh.q('#sr').value)||1),portions=Math.max(.25,+sh.q('#pp').value||1);
      try{await finish(name,text,await parseIngredients(text),'',serves,portions)}catch(x){er.textContent=x.message;busy(b,0,'Add meal')}}};
}
async function mealSheet(id){
  const p=await db.mealPlans.get(id),r=await db.recipes.get(p.recipeId);
  const sh=sheet(`<h3>Edit meal</h3><input id="nm" value="${esc(r.name)}"><textarea id="tx">${esc(r.text||'')}</textarea><div class="f" style="align-items:center"><span>This dish serves</span><input id="sr" type="number" min="1" step="1" value="${r.servings||1}" style="margin:0"></div><div class="f" style="align-items:center;margin:.5rem 0 .8rem"><span>My portions</span><input id="pp" type="number" min="0.5" step="0.5" value="${p.portions??(p.scale||1)*(r.servings||1)}" style="margin:0"></div><div class="err" id="er"></div>
  <div class="s" style="color:var(--mute);font-size:.88rem;margin-bottom:1rem">${r.ingredients.map(i=>`${q1(i.qty)} ${i.unit} ${esc(i.name)}`).join(' · ')} — ${kcal(r)} kcal total · ${Math.round(kcal(r)/(r.servings||1))} per serving</div>
  ${r.instructions?.length||r.source_url?`<details style="margin-bottom:1rem"><summary style="cursor:pointer;font-weight:600;color:var(--acc)">Recipe details</summary><div style="color:var(--mute);font-size:.88rem;margin:.5rem 0">${r.prep||r.cook?`Prep ${r.prep||0} min · Cook ${r.cook||0} min · `:''}${r.servings||1} serving${(r.servings||1)>1?'s':''}${r.source_url?` · <a href="${esc(r.source_url)}" target="_blank" rel="noopener" style="color:var(--acc)">${esc(r.source_title||'Source')}</a>`:''}</div>${r.instructions?.length?`<ol style="padding-left:1.2rem;margin:0;font-size:.92rem">${r.instructions.map(x=>`<li style="margin-bottom:.35rem">${esc(x)}</li>`).join('')}</ol>`:''}</details>`:''}
  <div class="f"><button id="sv">Save changes</button>${p.logged?'':'<button class="g" id="eat">I ate this</button>'}</div><button class="r" id="rm" style="width:100%;margin-top:.4rem">Remove from plan</button><button class="r" id="dm" style="width:100%">Delete meal from all plans and saved meals</button>`);
  sh.el.onclick=async e=>{const b=e.target.closest('button');if(!b)return;
    if(b.id==='rm'){await db.mealPlans.delete(id);await sync();sh.close();render()}
    if(b.id==='dm'&&await confirmDel(b)){await delRecipe(r.id);await sync();sh.close();toast('Meal deleted');render()}
    if(b.id==='eat'){await sync();const {missing}=await deductIngredientsFromPantry(r.id,planScale(p,r));await db.mealPlans.update(id,{logged:1});await sync();sh.close();toast(missing.length?`Logged. Pantry was short on ${missing[0].name}`:'Logged. Pantry updated');render()}
    if(b.id==='sv'){const name=sh.q('#nm').value.trim(),text=sh.q('#tx').value.trim(),er=sh.q('#er');
      if(!name||!text)return er.textContent='Name and ingredients can’t be empty.';
      busy(b,1,'Saving…');
      const serves=Math.max(1,Math.round(+sh.q('#sr').value)||1),portions=Math.max(.25,+sh.q('#pp').value||1);
      try{const ch={name,servings:serves};if(text!==r.text){ch.text=text;ch.ingredients=await parseIngredients(text)}
        await db.recipes.update(r.id,ch);await db.mealPlans.update(id,{portions});await sync();sh.close();toast('Saved');render()}
      catch(x){er.textContent=x.message;busy(b,0,'Save changes')}}};
}
async function renderPantry(){
  const it=await db.pantryItems.toArray();head('Pantry',it.length?`${it.length} item${it.length>1?'s':''}`:'');
  m.innerHTML=it.length?it.map(i=>{const p=i.capacity?Math.min(1,i.qty/i.capacity):1;return `<button class="row" data-i="${i.id}"><div class="t"><b>${esc(i.name)}</b> <span class="s">${convertMetricToFractionalUI(i.qty,i.capacity)} · ${amt(i)}</span><div class="bt"><div class="bf ${p<.2?'low':''}" style="width:${p*100}%"></div></div></div></button>`}).join('')
   :'<div class="empty" data-e="🧺"><b>Your pantry is empty</b>Add what you have, or tick off groceries to stock it.</div>';
  m.innerHTML+='<button class="fab" data-new aria-label="Add item">+</button>';
  m.onclick=async e=>{const b=e.target.closest('button');if(!b)return;
    if('new'in b.dataset)itemSheet();else if(b.dataset.i)itemSheet(await db.pantryItems.get(+b.dataset.i))};
}
function itemSheet(it){
  const sh=sheet(`<h3>${it?'Edit item':'Add to pantry'}</h3><input id="nm" placeholder="Name" value="${it?esc(it.name):''}"><div class="f"><input id="q" type="number" inputmode="decimal" placeholder="Amount" value="${it?q1(it.qty):''}"><input id="u" value="${it?it.unit:'g'}" list="us"><datalist id="us"><option>g<option>ml<option>pcs<option>tsp<option>tbsp<option>cup</datalist></div><div class="err" id="er"></div><button id="sv" style="width:100%">${it?'Save':'Add item'}</button>${it?'<button class="r" id="rm" style="width:100%;margin-top:.4rem">Remove</button>':''}`);
  sh.el.onclick=async e=>{const b=e.target.closest('button');if(!b)return;
    if(b.id==='rm'){await db.pantryItems.delete(it.id);await sync();sh.close();render()}
    if(b.id==='sv'){const name=sh.q('#nm').value.trim(),qty=+sh.q('#q').value,unit=sh.q('#u').value;
      if(!name||!(qty>0)||!UNITS.includes(unit))return sh.q('#er').textContent='Enter a name, an amount, and unit g, ml, pcs, tsp, tbsp or cup.';
      it?await db.pantryItems.update(it.id,{name,qty,unit,capacity:Math.max(it.capacity||0,qty)}):await db.pantryItems.add({name,qty,unit,capacity:qty});
      await sync();sh.close();render()}};
}
const amt=i=>['g','ml','pcs'].includes(i.unit)?sizeText(i.qty,i.unit):`${q1(i.qty)} ${i.unit}`;
const saveSet=(key,value)=>db.appSettings.put({key,value});
async function loadPrefs(){await loadProfiles();const [p,s]=await Promise.all([db.appSettings.get('packs'),db.appSettings.get('staples')]);setPrefs({packs:p?.value||{},staples:s?.value||[]})}
function packSheet(name){
  const p=name?pkgFor({name,unit:'g'}):null;
  const sh=sheet(`<h3>${name?esc(name):'Pack size'}</h3>${name?'':'<input id="pn" placeholder="Item name">'}<div class="f"><input id="pl" placeholder="Pack name, e.g. bag" value="${esc(p?.n||'pack')}" list="pls"><datalist id="pls"><option>bag<option>pack<option>packet<option>bottle<option>jar<option>carton<option>tub<option>can<option>box<option>bunch<option>tray</datalist></div><div class="f"><input id="ps" type="number" inputmode="decimal" placeholder="Size" value="${p?.size||''}"><input id="pu" value="${p?.unit||'g'}" list="pus"><datalist id="pus"><option>g<option>ml<option>pcs</datalist></div><div class="err" id="er"></div><button id="sv" style="width:100%">Save</button>${p?.custom?'<button class="r" id="rs" style="width:100%;margin-top:.4rem">Reset to default</button>':''}`);
  sh.el.onclick=async e=>{const b=e.target.closest('button');if(!b)return;
    const k=(name||sh.q('#pn')?.value||'').trim().toLowerCase(),cur=(await db.appSettings.get('packs'))?.value||{};
    if(b.id==='rs')delete cur[k];
    else if(b.id==='sv'){const size=+sh.q('#ps').value,unit=sh.q('#pu').value.trim(),n=sh.q('#pl').value.trim()||'pack';
      if(!k||!(size>0)||!['g','ml','pcs'].includes(unit))return sh.q('#er').textContent='Enter an item, a size, and unit g, ml or pcs.';
      cur[k]={n,size,unit}}
    else return;
    await saveSet('packs',cur);await loadPrefs();await sync();sh.close();toast('Saved');render();
  };
}
let packsOpen=false;
async function renderSettings(){
  head('Settings','Pack sizes, staples and your data');
  const [rs,pi,gl,sv,sh0]=await Promise.all([db.recipes.toArray(),db.pantryItems.toArray(),db.groceryList.toArray(),db.appSettings.get('staples'),shareOn()]);
  const staples=sv?.value||[],seen=new Map();
  for(const i of [...rs.flatMap(r=>r.ingredients),...pi,...gl]){const n=(i.name||'').toLowerCase();if(n&&!seen.has(n))seen.set(n,i.unit||'g')}
  const names=[...seen.keys()].filter(n=>!isStaple({name:n})).sort(),note=t=>`<div style="color:var(--mute);font-size:.88rem;margin:.1rem 0 .6rem">${t}</div>`;
  const state=!cloud.enabled?'Cloud backup is not set up. Your data is saved on this device only.':cloud.isReady()?`Backed up automatically · Support ID <b>${cloud.supportId()}</b>`:'Offline right now. Changes are saved here and will sync when you’re back online.';
  m.innerHTML=`<details class="fold" id="pk" ${packsOpen?'open':''}><summary>Pack sizes <span class="s" style="font-weight:500">${names.length} item${names.length===1?'':'s'}</span></summary>${note('Grocery lists round up to whole packs. Tap an item to set the size you buy.')}`+
   (names.length?names.map(n=>{const p=pkgFor({name:n,unit:seen.get(n)});
     return `<button class="row" data-p="${esc(n)}"><div class="t"><b>${esc(n)}</b><div class="s">${p?`1 ${esc(p.n)} = ${sizeText(p.size,p.unit)}${p.custom?' · yours':''}`:'Bought by count · tap to set a pack'}</div></div><span style="color:var(--mute)">›</span></button>`}).join('')
    :'<div class="empty" data-e="🧺"><b>No ingredients yet</b>Add a meal and its ingredients show up here.</div>')+
   `<button class="g" data-p="" style="width:100%;margin:.2rem 0 .8rem">+ Other item</button></details><h4>Always-available staples</h4>${note('Never added to Grocery or taken from the pantry. Separate several with commas.')}<div><span class="chip">water</span><span class="chip">ice</span>${staples.map(x=>`<span class="chip">${esc(x)}<button data-rs="${esc(x)}" aria-label="Remove ${esc(x)}">✕</button></span>`).join('')}</div><div class="f" style="margin:.4rem 0 1rem"><input id="st" placeholder="e.g. salt, cooking oil" style="margin:0"><button id="addst" style="flex:none">Add</button></div>
   <h4>Your data</h4>${note(state)}<div class="f"><button class="g" id="send">Send data to new device</button><button class="g" id="join">Enter a code</button></div>
   <label class="tog"><div><b>Share recipes anonymously</b><div class="s">Helps everyone get more accurate ingredients. Never includes your name or pantry.</div></div><input type="checkbox" id="shr" ${sh0?'checked':''}></label>`;
  $('#pk').ontoggle=e=>{packsOpen=e.target.open};
  $('#shr').onchange=e=>saveSet('cloud_share',e.target.checked);
  m.onclick=async e=>{const b=e.target.closest('button');if(!b)return;const d=b.dataset;
    if('p'in d)packSheet(d.p);
    if(b.id==='send')sendSheet();if(b.id==='join')joinSheet(false);
    if(d.rs){await saveSet('staples',staples.filter(x=>x!==d.rs));await loadPrefs();await sync();render()}
    if(b.id==='addst'){const add=$('#st').value.split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);if(!add.length)return;
      await saveSet('staples',[...new Set([...staples,...add])]);await loadPrefs();
      const gl2=await db.groceryList.toArray();await db.groceryList.bulkDelete(gl2.filter(g=>add.includes(g.name.toLowerCase())).map(g=>g.id));await sync();render()}};
}
// Old device: shows a one-time code (valid 10 minutes). The latest data is uploaded first.
async function sendSheet(){
  const sh=sheet(`<h3>Send data to new device</h3><div class="code" id="cd"><span class="sp" style="border-color:var(--acc);border-right-color:transparent"></span></div><div class="err" id="er"></div><div style="color:var(--mute);font-size:.92rem">On the new device, open Prepd and choose <b>I already use Prepd on another device</b>, then enter this code. It works once and expires in 10 minutes.</div>`);
  try{
    if(!cloud.enabled)throw new Error('Cloud backup is not set up yet.');
    if(!await cloud.init())throw new Error('You’re offline. Connect to the internet and try again.');
    await cloud.push(await exportUserData());
    const c=await cloud.createCode();sh.q('#cd').textContent=c.replace(/(\d{3})(\d{3})/,'$1 $2');
  }catch(e){sh.q('#cd').textContent='—';sh.q('#er').textContent=e.message}
}
// New device: enter the code, this device joins the account and the data is restored.
function joinSheet(fresh,done){
  const sh=sheet(`<h3>Enter your code</h3><input id="cc" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" style="font-size:1.6rem;text-align:center;letter-spacing:.2em"><div class="err" id="er"></div>${fresh?'':'<div style="color:var(--mute);font-size:.88rem;margin-bottom:.8rem">This replaces the data on this device with the data linked to the code.</div>'}<button id="go" style="width:100%">Restore my data</button>`);
  sh.el.onclick=async e=>{const b=e.target.closest('button');if(!b||b.id!=='go')return;
    const c=sh.q('#cc').value.trim();if(!c)return sh.q('#er').textContent='Enter the code.';
    busy(b,1,'Checking…');
    try{await cloud.redeem(c,importUserData);await db.appSettings.put({key:'onboarded',value:true});localStorage.setItem('prepd_onboarded','1');
      toast('Welcome back! Data restored');setTimeout(()=>location.reload(),600)}
    catch(x){sh.q('#er').textContent=x.message;busy(b,0,'Restore my data')}};
}
// First launch: a short, friendly tour. Resolves when the user is ready.
function welcome(){
  return new Promise(res=>{
    const slides=[['🗓️','Plan your week','Put breakfast, lunch and dinner on a calendar. Prepd does the maths.'],
      ['🧺','Your kitchen keeps count','Eat a meal and your pantry updates. Running low? It lands on your grocery list as whole packs.'],
      ['☁️','Safe on any device',cloud.enabled?'Your data backs up automatically. Switching phones is one code away.':'Your data is saved on this device and backed up automatically.']];
    const el=document.createElement('div');el.className='wel';
    el.innerHTML=`<div class="logo"><svg viewBox="0 0 32 32" width="34" height="34"><circle cx="16" cy="18" r="11" fill="#ff4d3d"/><path d="M16 8c-1-3-4-4-6-3 2 0 3 1 3 3-2 0-4 1-5 2 3-1 6 0 8-1 2 1 5 0 8 1-1-1-3-2-5-2 0-2 1-3 3-3-2-1-5 0-6 3z" fill="#2fb36b"/></svg>Prepd</div>
    <div style="overflow:hidden"><div class="wtrack" id="wt">${slides.map(([e,t,p])=>`<div class="wslide"><div class="big">${e}</div><h2>${t}</h2><p>${p}</p></div>`).join('')}</div></div>
    <div class="dots" id="wd">${slides.map(()=>'<i></i>').join('')}</div>
    <label class="tog" id="wshare" style="display:none"><div><b>Share recipes anonymously</b><div class="s">Helps everyone get more accurate ingredients. No personal info.</div></div><input type="checkbox" id="wsc" checked></label>
    <button id="wn" style="width:100%;padding:.95rem;font-size:1.05rem">Next</button>
    ${cloud.enabled?'<button class="r" id="wj" style="width:100%;margin-top:.4rem;color:var(--acc)">I already use Prepd on another device</button>':''}`;
    document.body.append(el);let i=0;
    const draw=()=>{$('#wt',el).style.transform=`translateX(-${i*100}%)`;[...$('#wd',el).children].forEach((d,k)=>d.classList.toggle('on',k===i));
      $('#wn',el).textContent=i===slides.length-1?'Get started':'Next';$('#wshare',el).style.display=i===slides.length-1?'flex':'none'};
    const finish=async()=>{await db.appSettings.put({key:'onboarded',value:true});localStorage.setItem('prepd_onboarded','1');
      await db.appSettings.put({key:'cloud_share',value:$('#wsc',el).checked});el.classList.add('out');setTimeout(()=>{el.remove();res()},400)};
    el.onclick=e=>{const b=e.target.closest('button');if(!b)return;
      if(b.id==='wn')i<slides.length-1?(i++,draw()):finish();
      if(b.id==='wj')joinSheet(true)};
    draw();
  });
}
async function maybeWelcome(){
  if((await db.appSettings.get('onboarded'))?.value||localStorage.getItem('prepd_onboarded'))return;
  const n=(await Promise.all([db.pantryItems,db.recipes,db.mealPlans,db.groceryList].map(t=>t.count()))).reduce((a,b)=>a+b,0);
  if(n>0){await db.appSettings.put({key:'onboarded',value:true});return}   // existing user from before the tour existed
  await welcome();
}
async function renderGrocery(){
  const g=await db.groceryList.toArray();head('Grocery',g.length?`${g.length} to buy`:'');
  m.innerHTML=(g.length?g.map(i=>`<div class="row" data-row="${i.id}"><button class="chk" data-buy="${i.id}" aria-label="Mark ${esc(i.name)} bought"></button><div class="t"><b>${esc(groceryText(i).title)}</b><div class="s">${esc(groceryText(i).sub)}</div></div><button class="r" data-x="${i.id}" style="padding:.4rem">✕</button></div>`).join('')
   :'<div class="empty" data-e="🛒"><b>Nothing to buy</b>Meals you plan add missing ingredients here.</div>')+'<button class="fab" data-new aria-label="Add item">+</button>';
  m.onclick=async e=>{const b=e.target.closest('button');if(!b)return;const d=b.dataset;
    if(d.buy||d.x){const row=$(`[data-row="${d.buy||d.x}"]`);if(d.buy){b.classList.add('on');b.textContent='✓';await new Promise(r=>setTimeout(r,250));await restockFromGrocery(+d.buy);toast('Moved to pantry')}else await db.groceryList.delete(+d.x);
      row.classList.add('gone');setTimeout(render,300)}
    if('new'in d){const sh=sheet(`<h3>Add to list</h3><input id="nm" placeholder="Name"><div class="f"><input id="q" type="number" inputmode="decimal" placeholder="Amount"><input id="u" value="g" list="us"><datalist id="us"><option>g<option>ml<option>pcs<option>tsp<option>tbsp<option>cup</datalist></div><div class="err" id="er"></div><button id="sv" style="width:100%">Add to list</button>`);
      sh.el.onclick=async ev=>{if(ev.target.id!=='sv')return;const name=sh.q('#nm').value.trim(),qty=+sh.q('#q').value,unit=sh.q('#u').value;
        if(!name||!(qty>0)||!UNITS.includes(unit))return sh.q('#er').textContent='Enter a name, an amount, and unit g, ml, pcs, tsp, tbsp or cup.';
        await db.groceryList.add({name,qty,unit,checked:0});sh.close();render()}}};
}
async function render(){
  const n=await db.groceryList.count();
  $('#n').innerHTML=[['plan','Plan'],['pantry','Pantry'],['grocery','Grocery'],['settings','Settings']].map(([k,l])=>`<button data-t="${k}" class="${k===tab?'on':''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>${l}${k==='grocery'&&n?`<span class="bd">${n}</span>`:''}</button>`).join('');
  await({plan:renderPlan,pantry:renderPantry,grocery:renderGrocery,settings:renderSettings}[tab])();
}
$('#n').onclick=e=>{const t=e.target.closest('button')?.dataset.t;if(t&&t!==tab){tab=t;scrollTo(0,0);render().then(()=>pop(m))}};
(async()=>{
  await requestPersistence();await autoRestore();await loadPrefs();await maybeWelcome();
  setOnBackup(async snap=>{if(cloud.isReady())await cloud.push(snap)});
  await render();
  // Cloud: sign in this device, then upload unsynced edits or take a newer copy from another device.
  cloud.init().then(async ok=>{if(!ok)return;
    const r=await cloud.pullIfNewer(importUserData);
    if(r==='pulled'){await loadPrefs();render()}else if(r==='dirty')cloud.push(await exportUserData());
    if(tab==='settings')render()}).catch(()=>{});
  if('serviceWorker'in navigator){navigator.serviceWorker.register('sw.js').then(async r=>{try{await r.periodicSync?.register('shortage-check',{minInterval:36e5})}catch{}});
    navigator.serviceWorker.addEventListener('message',e=>e.data==='check-shortages'&&checkUpcomingMenuShortages(48))}
  sync().then(render).catch(()=>{});setInterval(()=>checkUpcomingMenuShortages(48),36e5);
})();
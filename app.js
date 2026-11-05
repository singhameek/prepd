import {db,today,requestPersistence,autoRestore,setOnBackup,exportUserData,importUserData} from './db.js';
import {parseIngredients,reprice} from './ingredientParser.js';
import {findRecipe} from './recipeFinder.js';
import * as cloud from './cloud.js';
import {resolveUnits,learn,loadProfiles} from './units.js';
import {loadEngine} from './engine.js';
import {splitSteps,detectTimers,fmtTime} from './steps.js';
import * as timers from './timers.js';
import {loadCorrections,learn as learnCorr} from './corrections.js';
import {UNITS,convertAmount,deductIngredientsFromPantry,checkUpcomingMenuShortages,convertMetricToFractionalUI,restockFromGrocery,groceryText,planScale,isStaple,pkgFor,setPrefs,sizeText} from './inventoryEngine.js';
const q1=n=>+(+n).toFixed(1);
const unitSel=(id,sel='g',extra='',list=UNITS)=>`<select ${id?`id="${id}"`:''} ${extra}>${list.map(u=>`<option value="${u}"${u===sel?' selected':''}>${u==='l'?'L':u}</option>`).join('')}</select>`;
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
const PERF=/[?&]perf\b/.test(location.search);   // open the app with ?perf to log how long each screen takes
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// iOS Safari has no Notification object (touching it throws), so every use goes through these.
const notifState=()=>typeof Notification!=='undefined'?Notification.permission:'denied';
const askNotif=()=>{try{if(notifState()==='default')Notification.requestPermission()}catch{}};
const pop=(el,dx=0)=>!reduce&&el.animate([{opacity:0,transform:`translateX(${dx}px) translateY(${dx?0:10}px)`},{opacity:1,transform:'none'}],{duration:200,easing:'cubic-bezier(.2,.9,.3,1)'});
const EMO=[[/potato|aloo/,'🥔'],[/onion|shallot|scallion/,'🧅'],[/tomato/,'🍅'],[/garlic/,'🧄'],[/ginger/,'🫚'],[/chil+i|capsicum|jalape/,'🌶️'],[/carrot/,'🥕'],[/cauliflower|broccoli|gobi/,'🥦'],[/spinach|palak|kale|lettuce|cabbage|coriander|cilantro|mint|basil|parsley|curry leaf|curry leaves|methi/,'🥬'],[/cucumber|zucchini|courgette/,'🥒'],[/eggplant|brinjal|aubergine|baingan/,'🍆'],[/corn/,'🌽'],[/mushroom/,'🍄'],[/peas|bean|lentil|\bdal\b|chana|rajma|chickpea|moong|toor|urad/,'🫘'],[/rice|poha/,'🍚'],[/atta|flour|maida|besan|semolina|rava|bread|roti|naan/,'🌾'],[/pasta|noodle|spaghetti/,'🍝'],[/milk|cream/,'🥛'],[/curd|yogh?urt|dahi/,'🥣'],[/paneer|cheese/,'🧀'],[/butter|ghee/,'🧈'],[/\beggs?\b/,'🥚'],[/chicken|turkey/,'🍗'],[/beef|mutton|lamb|pork|meat|bacon/,'🥩'],[/fish|salmon|tuna|prawn|shrimp/,'🐟'],[/\boil\b/,'🫒'],[/sugar|jaggery|honey/,'🍯'],[/\bsalt\b/,'🧂'],[/lemon|lime/,'🍋'],[/apple/,'🍎'],[/banana/,'🍌'],[/mango/,'🥭'],[/coconut/,'🥥'],[/nut|almond|cashew|peanut|walnut/,'🥜'],[/\btea\b|coffee/,'☕'],[/cumin|jeera|turmeric|haldi|masala|spice|cardamom|cinnamon|clove|mustard|pepper|powder|seed/,'🌶️']];
const emojiFor=n=>{n=String(n).toLowerCase();for(const [r,e] of EMO)if(r.test(n))return e;return '🥘'};
// A little confetti of ingredients, for happy moments.
function burst(el){
  if(reduce||!el)return;
  const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,list=['🍅','🌿','✨','🧅','🥕','⭐','🍅','✨','🌿','🥕'];
  list.forEach((e,i)=>{const s=document.createElement('span'),a=i/list.length*Math.PI*2,d=50+Math.random()*45;
    s.className='bp';s.textContent=e;
    s.style.cssText=`left:${x}px;top:${y}px;--dx:${Math.cos(a)*d}px;--dy:${Math.sin(a)*d-30}px;--r:${(Math.random()-.5)*180}deg`;
    document.body.append(s);setTimeout(()=>s.remove(),650)});
}
const who=()=>cloud.username()||localStorage.getItem('prepd_username')||'';
const SEED=Math.floor(Math.random()*1000);   // a different greeting each time the app opens
// The friendly card at the top of the home screen.
function helloCard(todayPlans,groceryN,eaten,planned){
  const h=new Date().getHours(),meal=h<11?'breakfast':h<16?'lunch':'dinner',done=new Set(todayPlans.map(p=>p.slot));
  const qs=[`What’s for ${meal} today?`,'Anything tasty on the menu?','Ready to prep something delicious?','Hungry yet? Let’s plan it.','Craving something new today?',`How about a ${meal} you’ll love?`,'What are we cooking next?','Your kitchen is ready when you are.'];
  const line=done.size>=3?['Today’s fully planned. Nicely done! 🎉','Breakfast, lunch and dinner sorted. Chef’s kiss 👌'][SEED%2]:groceryN>=4?`Your grocery list has ${groceryN} items. Shopping day? 🛒`:qs[SEED%qs.length];
  const next=!done.has(meal)?meal:SLOTS.map(s=>s[0]).find(k=>!done.has(k));
  const chips=[next?`<button class="cp" data-chipadd="${next}">${SLOTS.find(s=>s[0]===next)[3]} Plan ${next}</button>`:'',
    `<button class="cp" data-go="pantry">🧺 Pantry</button>`,`<button class="cp" data-go="grocery">🛒 Grocery${groceryN?` (${groceryN})`:''}</button>`,
    cloud.enabled&&!cloud.signedIn()?`<button class="cp" data-acct="1">☁️ Back up my data</button>`:''].join('');
  const pct=planned?Math.min(100,Math.round(eaten/planned*100)):0;
  return `<div class="hello"><div class="hi">Hey ${esc(who()||'there')}! <span class="wave">👋</span></div><div class="hq">${line}</div>${planned?`<div class="dayb"><div class="dl"><span>${eaten.toLocaleString()} eaten</span><span>${planned.toLocaleString()} kcal planned today</span></div><div class="bt"><div class="bf" style="width:${pct}%"></div></div></div>`:''}<div class="chips">${chips}</div></div>`;
}
function toast(t){const e=document.createElement('div');e.className='toast';e.textContent=t;document.body.append(e);requestAnimationFrame(()=>requestAnimationFrame(()=>e.classList.add('on')));setTimeout(()=>{e.classList.remove('on');setTimeout(()=>e.remove(),400)},2600)}
const head=(t,s='')=>{$('#t').textContent=t;$('#s').textContent=s};

// Bottom sheet: spring-like open, drag to dismiss with momentum projection
// Sheets can be closed with the ✕ button, the Escape key, a swipe down, or a tap outside.
const sheetStack=[];
addEventListener('keydown',e=>{if(e.key==='Escape')sheetStack[sheetStack.length-1]?.close()});
function sheet(html){
  const sc=document.createElement('div'),sh=document.createElement('div');sc.className='scrim';sh.className='sheet';
  sh.innerHTML=`<div class="grab"><i></i><button class="x" aria-label="Close">✕</button></div><div class="sb">${html}</div>`;document.body.append(sc,sh);
  requestAnimationFrame(()=>requestAnimationFrame(()=>{sc.classList.add('on');sh.classList.add('on')}));
  let api;const close=()=>{const i=sheetStack.indexOf(api);if(i>=0)sheetStack.splice(i,1);sc.classList.remove('on');sh.classList.remove('on');sh.style.transform='';setTimeout(()=>{sc.remove();sh.remove()},360)};
  sc.onclick=close;const g=$('.grab',sh);let y0,ly,lt,v=0,on=0;
  g.onpointerdown=e=>{if(e.target.closest('.x'))return;g.setPointerCapture(e.pointerId);on=1;y0=ly=e.clientY;lt=e.timeStamp;sh.style.transition='none'};
  g.onpointermove=e=>{if(!on)return;const dy=e.clientY-y0;v=(e.clientY-ly)/(e.timeStamp-lt||1);ly=e.clientY;lt=e.timeStamp;sh.style.transform=`translateY(${dy>0?dy:dy*.25}px)`};
  g.onpointerup=e=>{if(!on)return;on=0;sh.style.transition='';const dy=e.clientY-y0;(dy+v*99>140)?close():sh.style.transform=''};
  api={el:sh,close,q:s=>$(s,sh)};sheetStack.push(api);$('.x',sh).onclick=close;
  return api;
}
const busy=(b,on,t)=>{b.disabled=on;b.innerHTML=on?`<span class="sp"></span>${t}`:t};

const delRecipe=async id=>{await db.mealPlans.where('recipeId').equals(id).delete();await db.recipes.delete(id)};
// Two-tap confirm: first tap arms the button, second tap (within 3s) confirms
const confirmDel=async b=>{if(b.dataset.armed)return true;const t=b.textContent;b.dataset.armed=1;b.textContent='Tap again to delete';setTimeout(()=>{delete b.dataset.armed;b.textContent=t},3000);return false};
async function renderPlan(dx=0){
  const wk=monday(sel),days=[...Array(7)].map((_,i)=>addDays(wk,i));
  const [plans,allRecipes,todayRows,gN]=await Promise.all([db.mealPlans.where('date').between(days[0],days[6],true,true).toArray(),db.recipes.toArray(),db.mealPlans.where('date').equals(today()).toArray(),db.groceryList.count()]);
  const recs=new Map(allRecipes.map(r=>[r.id,r]));
  const dayPlans=plans.filter(p=>p.date===sel&&recs.has(p.recipeId));
  const total=dayPlans.reduce((a,p)=>a+kcal(recs.get(p.recipeId),planScale(p,recs.get(p.recipeId))),0);
  head(sel===today()?'Today':fmt(sel,{weekday:'long'}),fmt(sel,{day:'numeric',month:'long'})+(total?` · ${total.toLocaleString()} kcal planned`:''));
  const tp=todayRows.filter(p=>recs.has(p.recipeId));
  const kc=a=>a.reduce((n,p)=>n+kcal(recs.get(p.recipeId),planScale(p,recs.get(p.recipeId))),0);
  const hello=helloCard(tp,gN,kc(tp.filter(p=>p.logged)),kc(tp));
  m.innerHTML=hello+`<div class="wk"><button class="n" data-wk="-7" aria-label="Previous week">‹</button>${days.map(d=>`<button class="d ${d===sel?'sel':''} ${d===today()?'t':''}" data-d="${d}"><span>${fmt(d,{weekday:'short'})}</span><b>${+d.slice(8)}</b><i class="${plans.some(p=>p.date===d)?'on':''}"></i></button>`).join('')}<button class="n" data-wk="7" aria-label="Next week">›</button></div><div id="body">${SLOTS.map(([k,l,c,em])=>{
    const ps=dayPlans.filter(x=>x.slot===k);
    return ps.map(p=>{const r=recs.get(p.recipeId);
      return `<button class="slot" style="--c:var(${c})" data-meal="${p.id}"><span class="em">${em}</span><div class="t"><div class="l">${l}</div><div class="nm">${esc(r.name)}</div><div class="l">${kcal(r,planScale(p,r))} kcal</div></div>${p.logged?'<span class="ok">✓ Eaten</span>':''}</button>`}).join('')+
    (ps.length?`<button class="more" style="--c:var(${c})" data-add="${k}">+ Add another ${l.toLowerCase()}</button>`
    :`<button class="slot e" style="--c:var(${c})" data-add="${k}"><span class="em">${em}</span><div class="t"><div class="l">${l}</div><div class="nm">What’s cooking?</div></div><span class="plus">+</span></button>`)}).join('')}</div>`;
  if(dx)pop($('#body'),dx*24);
  m.onclick=async e=>{const b=e.target.closest('button');if(!b)return;const d=b.dataset;
    if(d.go){tab=d.go;scrollTo(0,0);m.classList.add('stagger');setTimeout(()=>m.classList.remove('stagger'),600);render()}
    else if(d.chipadd){sel=today();addSheet(d.chipadd)}
    else if(d.acct)authSheet('signup',{done:()=>render()})
    else if(d.wk){sel=addDays(sel,+d.wk);renderPlan(+d.wk>0?1:-1)}
    else if(d.d){const dir=d.d>sel?1:d.d<sel?-1:0;sel=d.d;renderPlan(dir)}
    else if(d.add)addSheet(d.add);else if(d.meal)mealSheet(+d.meal)};
}
// Re-checks the week against the pantry and updates the grocery list; anything the engine had to guess (a pantry item
// counted in pcs, a cup of something unknown) is looked up, then the check is repeated with the real numbers.
// Keeping the grocery list in step with the pantry and plan never holds up the screen: the action finishes and redraws
// first, then this runs in the background (including any network lookups) and redraws again only if something changed.
let syncBusy=false,syncAgain=false;
async function syncSoon(){
  if(syncBusy){syncAgain=true;return null}
  syncBusy=true;let last=null;
  try{
    do{
      syncAgain=false;
      last=await checkUpcomingMenuShortages(168,{addToGrocery:true});let changed=last.changed;
      if(await resolveUnits()){last=await checkUpcomingMenuShortages(168,{addToGrocery:true});changed=changed||last.changed}
      last.changed=changed;
      if(changed&&!sheetStack.length)render();
    }while(syncAgain);
  }catch(e){console.warn('sync',e)}finally{syncBusy=false}
  return last;
}
const shareOn=async()=>(await db.appSettings.get('cloud_share'))?.value!==false;
async function plan(slot,recipeId,portions=1){
  await db.mealPlans.add({date:sel,slot,recipeId,portions,logged:0});
  askNotif();
  render();                                                   // show the new meal straight away
  syncSoon().then(r=>{if(r&&r.changed&&r.length)toast(`${r.length} item${r.length>1?'s':''} on your Grocery list`)});
}
async function addSheet(slot){
  const label=SLOTS.find(s=>s[0]===slot)[1].toLowerCase(),saved=await db.recipes.toArray();
  const sh=sheet(`<h3>Add ${label}</h3><input id="nm" placeholder="Meal name, e.g. Paneer butter masala" autocomplete="off"><button class="g" id="find" style="width:100%;margin-bottom:.8rem">🔎 Find recipe online</button><textarea id="tx" placeholder="…or paste ingredients, one per line&#10;2 eggs&#10;a splash of milk"></textarea><details class="fold" style="margin:.2rem 0 .8rem"><summary>Steps <span class="s" style="font-weight:500">optional</span></summary><textarea id="stx" placeholder="One step per line, e.g.&#10;Heat oil and add cumin.&#10;Simmer for 10 minutes." style="min-height:7rem"></textarea></details><div class="f" style="align-items:center"><span>This dish serves</span><input id="sr" type="number" min="1" step="1" value="1" style="margin:0"></div><div class="f" style="align-items:center;margin:.5rem 0 .8rem"><span>My portions</span><input id="pp" type="number" min="0.5" step="0.5" value="1" style="margin:0"></div><div class="err" id="er"></div><button id="go" style="width:100%">Add meal</button>${saved.length?`<h4>Saved meals</h4>${saved.map(r=>`<div class="row" data-row="${r.id}"><button class="r" data-r="${r.id}" style="flex:1;text-align:left;color:var(--ink);padding:0"><b>${esc(r.name)}</b><div class="s">${kcal(r)} kcal · tap to add</div></button><button class="r" data-del="${r.id}" style="padding:.4rem .6rem">Delete</button></div>`).join('')}`:''}`);
  const body=sh.q('.sb'),mainHTML=body.innerHTML;let rv,stash={};
  const draw=()=>{body.innerHTML=`<h3>Check ingredients</h3><div style="color:var(--mute);font-size:.88rem;margin-bottom:.7rem">From ${rv.url?`<a href="${esc(rv.url)}" target="_blank" rel="noopener" style="color:var(--acc)">${esc(new URL(rv.url).hostname.replace('www.',''))}</a>`:'the Prepd community'} · whole recipe${rv.steps?.length?` · ${rv.steps.length} steps found`:''}. Fix anything that looks off; Prepd learns from your fixes.</div><input id="nm" value="${esc(rv.name)}"><div class="f" style="align-items:center"><span>This dish serves</span><input id="yd" type="number" min="1" step="1" value="${rv.yield}" style="margin:0"></div><div class="f" style="align-items:center;margin:.5rem 0 .8rem"><span>My portions</span><input id="mk" type="number" min="0.25" step="0.25" value="${rv.making}" style="margin:0"></div>${rv.items.map((i,k)=>`<div class="row rvr"><div class="t"><input class="ni${i.suspect?' warnb':''}" data-k="${k}" value="${esc(i.name)}" aria-label="Ingredient name">${i.unknown?'<div class="sus">⚠ Not recognised, so calories aren’t counted. Check the name.</div>':i.suspect?'<div class="sus">⚠ This might be wrong. Please check the name.</div>':''}${i.alts?.length&&(i.suspect||i.unknown)?`<div class="alts">${i.alts.map(a=>`<button class="cp" data-alt="${k}|${esc(a)}">${esc(a)}</button>`).join('')}</div>`:''}<div class="s" style="margin-bottom:.4rem">${esc(i.display||'')}</div><div class="f"><input class="qi" data-k="${k}" type="number" step="any" inputmode="decimal" value="${q1(i.qty)}" aria-label="Amount">${unitSel('',i.unit,`class="ui" data-k="${k}" aria-label="Unit"`)}</div></div><button class="r" data-rm="${k}" aria-label="Remove">✕</button></div>`).join('')}<div class="err" id="er"></div><button id="ok" style="width:100%">Add meal</button><button class="g" id="back" style="width:100%;margin-top:.5rem">Back</button>`};
  sh.el.oninput=e=>{if(rv&&e.target.id==='nm')rv.name=e.target.value};
  sh.el.onchange=e=>{if(!rv)return;const t=e.target;
    if(t.id==='mk')rv.making=Math.max(.25,+t.value||1);
    if(t.id==='yd')rv.yield=Math.max(1,Math.round(+t.value)||1);
    if(t.classList.contains('qi'))rv.items[+t.dataset.k].qty=Math.max(0,+t.value||0);
    if(t.classList.contains('ui'))rv.items[+t.dataset.k].unit=t.value;
    if(t.classList.contains('ni')){const it=rv.items[+t.dataset.k];it.name=t.value.trim()||it.name;t.value=it.name;it.suspect=false;t.classList.remove('warnb');t.parentElement.querySelector('.sus')?.remove()}};
  const finish=async(name,text,ingredients,sourceUrl,servings=1,portions=1,share=true,steps=[])=>{ingredients=ingredients.map(({orig,suspect,learned,unknown,alts,review,...i})=>i);const id=await db.recipes.add({name,text,ingredients,sourceUrl,servings,steps});
    const on=share&&await shareOn();learn(ingredients,on);if(on)cloud.shareRecipe(name,ingredients,servings,sourceUrl,steps);sh.close();plan(slot,id,portions)};
  sh.el.onclick=async e=>{const b=e.target.closest('button');if(!b)return;const er=sh.q('#er');
    if(b.dataset.r){const pp=Math.max(.25,+sh.q('#pp')?.value||1);sh.close();plan(slot,+b.dataset.r,pp)}
    if(b.dataset.del&&await confirmDel(b)){await delRecipe(+b.dataset.del);sh.q(`[data-row="${b.dataset.del}"]`).remove();render()}
    if(b.id==='find'){const name=sh.q('#nm').value.trim();er.textContent='';
      if(!name)return sh.q('#nm').focus(),er.textContent='Type the meal name first.';
      try{const web=findRecipe(name,t=>busy(b,1,t)).then(f=>({f}),e=>({e}));   // the web search starts right away, alongside the community lookup
        const c=await Promise.race([cloud.findCommunity(name).catch(()=>null),sleep(1500).then(()=>null)]);
        if(c){stash={nm:name,tx:sh.q('#tx').value};rv={name,url:'',yield:c.yield,making:1,items:c.items,community:true,communityId:c.id,removed:[],steps:c.steps||[]};draw()}
        else{const w=await web;if(w.e)throw w.e;const f=w.f;busy(b,1,'Checking ingredients…');
          const items=await parseIngredients(f.lines.join('\n'));
          stash={nm:name,tx:sh.q('#tx').value};rv={name,url:f.url,yield:f.yield,making:1,removed:[],steps:f.steps||[],items:items.map(i=>({...i,orig:{name:i.name,qty:i.qty,unit:i.unit}}))};draw()}}
      catch(x){er.textContent=x.message+' Paste the ingredients below instead.';busy(b,0,'🔎 Find recipe online')}}
    if(b.id==='back'){body.innerHTML=mainHTML;sh.q('#nm').value=rv.name;sh.q('#tx').value=stash.tx||'';rv=null}
    if(b.dataset.alt){const [k,nm]=[+b.dataset.alt.split('|')[0],b.dataset.alt.split('|').slice(1).join('|')],it=rv.items[k];Object.assign(it,reprice(it,nm),{suspect:false,unknown:false,alts:[]});draw();return}
    if(b.dataset.rm){rv.removed.push(...rv.items.splice(+b.dataset.rm,1));draw()}
    if(b.id==='ok'){const items=rv.items.map(i=>({...i})).filter(i=>i.qty>0);
      const name=rv.name.trim();if(!name)return er.textContent='Give your meal a name.';
      if(!items.length)return er.textContent='Keep at least one ingredient.';
      if(rv.community&&rv.communityId)cloud.useRecipe(rv.communityId);
      if(!rv.community)await learnCorr(items,rv.removed||[]);   // remember the user's fixes
      finish(name,items.map(i=>`${q1(i.qty)} ${i.unit} ${i.name}`).join('\n'),items.map(({orig,...i})=>i),rv.url,rv.yield,rv.making,!rv.community,rv.steps||[])}
    if(b.id==='go'){const name=sh.q('#nm').value.trim(),text=sh.q('#tx').value.trim();er.textContent='';
      if(!name)return sh.q('#nm').focus(),er.textContent='Give your meal a name.';
      if(!text)return sh.q('#tx').focus(),er.textContent='Paste ingredients, or tap Find recipe online.';
      busy(b,1,'Reading ingredients…');
      const serves=Math.max(1,Math.round(+sh.q('#sr').value)||1),portions=Math.max(.25,+sh.q('#pp').value||1);
      try{await finish(name,text,await parseIngredients(text),'',serves,portions,true,splitSteps(sh.q('#stx')?.value||''))}catch(x){er.textContent=x.message;busy(b,0,'Add meal')}}};
}
// Steps in order, with a timer button wherever a step mentions a time.
async function stepsSheet(r,steps){
  await loadEngine();
  const key=(i,k)=>`${r.id}:${i}:${k}`;
  const sh=sheet(`<h3>${esc(r.name)}</h3><div style="color:var(--mute);font-size:.9rem;margin:-.4rem 0 .9rem">${steps.length} step${steps.length===1?'':'s'} · tap the circle when one is done</div>${steps.map((t,i)=>`<div class="step"><button class="chk" data-done="${i}" aria-label="Mark step ${i+1} done"></button><div class="t"><div class="sn">Step ${i+1}</div><p>${esc(t)}</p>${detectTimers(t).map((d,k)=>`<button class="tm" data-tk="${key(i,k)}" data-secs="${d.seconds}" data-lab="${esc(d.label)}">⏱ ${esc(d.label)}</button>`).join('')}</div></div>`).join('')}<button class="g" id="cl" style="width:100%;margin-top:.4rem">Done</button>`);
  const upd=()=>{if(!document.body.contains(sh.el)){off();return}
    sh.el.querySelectorAll('.tm').forEach(b=>{const t=timers.find(b.dataset.tk);b.classList.toggle('run',!!t);
      b.textContent=t?`⏱ ${b.dataset.lab.split(' · ')[0]} · ${fmtTime(timers.left(t))}`:`⏱ ${b.dataset.lab}`})};
  const off=timers.onTick(upd);upd();
  sh.el.onclick=e=>{const b=e.target.closest('button');if(!b)return;
    if(b.id==='cl')return sh.close();
    if(b.dataset.done!==undefined){const on=b.closest('.step').classList.toggle('done');b.classList.toggle('on',on);b.textContent=on?'✓':''}
    if(b.dataset.tk){
      if(timers.find(b.dataset.tk))timers.stop(b.dataset.tk);
      else{timers.start(b.dataset.tk,`${r.name} · ${b.dataset.lab.split(' · ')[0]}`,+b.dataset.secs);toast('Timer started');
        askNotif()}}};
}
function drawTimers(){
  const tb=$('#tb'),list=timers.all(),have=new Map([...tb.children].map(c=>[c.dataset.id,c]));
  for(const [id,c] of have)if(!list.some(t=>t.id===id))c.remove();
  for(const t of list){
    let c=have.get(t.id);
    if(!c){c=document.createElement('div');c.className='tchip';c.dataset.id=t.id;
      c.innerHTML='<span></span><button aria-label="Stop timer">✕</button>';c.querySelector('button').dataset.stop=t.id;tb.append(c)}
    const sp=c.firstElementChild,txt=`⏱ ${t.label} · ${fmtTime(timers.left(t))}`;
    if(sp.textContent!==txt)sp.textContent=txt;
  }
}
$('#tb').onclick=e=>{const id=e.target.closest('button')?.dataset.stop;if(id)timers.stop(id)};
timers.onTick(drawTimers);
addEventListener('prepd-timer-done',async e=>{
  const t=e.detail;toast(`⏱ ${t.label} is done!`);drawTimers();
  if(notifState()==='granted'){try{const reg=await navigator.serviceWorker?.ready,o={body:t.label,tag:'timer-'+t.id,icon:'icon-192.png',vibrate:[300,150,300]};
    reg?reg.showNotification('Timer done',o):new Notification('Timer done',o)}catch{}}
});
async function mealSheet(id){
  const p=await db.mealPlans.get(id),r=await db.recipes.get(p.recipeId);
  const steps0=r.steps?.length?r.steps:(r.instructions||[]);
  const sh=sheet(`<h3>Edit meal</h3><input id="nm" value="${esc(r.name)}"><textarea id="tx">${esc(r.text||'')}</textarea><div class="f" style="align-items:center"><span>This dish serves</span><input id="sr" type="number" min="1" step="1" value="${r.servings||1}" style="margin:0"></div><div class="f" style="align-items:center;margin:.5rem 0 .8rem"><span>My portions</span><input id="pp" type="number" min="0.5" step="0.5" value="${p.portions??(p.scale||1)*(r.servings||1)}" style="margin:0"></div><div class="err" id="er"></div>
  <div class="s" style="color:var(--mute);font-size:.88rem;margin-bottom:1rem">${r.ingredients.map(i=>`${q1(i.qty)} ${i.unit} ${esc(i.name)}`).join(' · ')} — ${kcal(r)} kcal total · ${Math.round(kcal(r)/(r.servings||1))} per serving</div>
  ${r.source_url?`<div style="color:var(--mute);font-size:.88rem;margin-bottom:.8rem">Source: <a href="${esc(r.source_url)}" target="_blank" rel="noopener" style="color:var(--acc)">${esc(r.source_title||new URL(r.source_url).hostname.replace('www.',''))}</a></div>`:''}
  <details class="fold" style="margin-bottom:.8rem"><summary>Steps <span class="s" style="font-weight:500">${steps0.length||'none yet'}</span></summary><textarea id="stx" placeholder="One step per line…" style="min-height:8rem">${esc(steps0.join('\n'))}</textarea></details>
  <div class="f"><button id="sv">Save changes</button>${p.logged?'':'<button class="g" id="eat">I ate this</button>'}</div>${steps0.length?'<button class="g" id="cook" style="width:100%;margin-top:.5rem">📖 View steps &amp; timers</button>':''}<button class="r" id="rm" style="width:100%;margin-top:.4rem">Remove from plan</button><button class="r" id="dm" style="width:100%">Delete meal from all plans and saved meals</button>`);
  sh.el.onclick=async e=>{const b=e.target.closest('button');if(!b)return;
    if(b.id==='cook')stepsSheet(r,steps0);
    if(b.id==='rm'){await db.mealPlans.delete(id);sh.close();render();syncSoon()}
    if(b.id==='dm'&&await confirmDel(b)){await delRecipe(r.id);sh.close();toast('Meal deleted');render();syncSoon()}
    if(b.id==='eat'){const {missing}=await deductIngredientsFromPantry(r.id,planScale(p,r));await db.mealPlans.update(id,{logged:1});burst(b);sh.close();toast(missing.length?`Logged. Pantry was short on ${missing[0].name}`:'Logged. Pantry updated 🎉');render();syncSoon()}
    if(b.id==='sv'){const name=sh.q('#nm').value.trim(),text=sh.q('#tx').value.trim(),er=sh.q('#er');
      if(!name||!text)return er.textContent='Name and ingredients can’t be empty.';
      busy(b,1,'Saving…');
      const serves=Math.max(1,Math.round(+sh.q('#sr').value)||1),portions=Math.max(.25,+sh.q('#pp').value||1);
      try{const ch={name,servings:serves,steps:splitSteps(sh.q('#stx').value)};if(text!==r.text){ch.text=text;ch.ingredients=await parseIngredients(text)}
        await db.recipes.update(r.id,ch);await db.mealPlans.update(id,{portions});sh.close();toast('Saved');render();syncSoon()}
      catch(x){er.textContent=x.message;busy(b,0,'Save changes')}}};
}
async function renderPantry(){
  const it=await db.pantryItems.toArray();head('Pantry',it.length?`${it.length} item${it.length>1?'s':''}`:'');
  m.innerHTML=it.length?it.map(i=>{const p=i.capacity?Math.min(1,i.qty/i.capacity):1;return `<button class="row" data-i="${i.id}"><span class="em sm">${emojiFor(i.name)}</span><div class="t"><b>${esc(i.name)}</b> <span class="s">${convertMetricToFractionalUI(i.qty,i.capacity)} · ${amt(i)}</span><div class="bt"><div class="bf ${p<.2?'low':''}" style="width:${p*100}%"></div></div></div></button>`}).join('')
   :'<div class="empty" data-e="🧺"><b>Your pantry is empty</b>Add what you have, or tick off groceries to stock it.</div>';
  m.innerHTML+='<button class="fab" data-new aria-label="Add item">+</button>';
  m.onclick=async e=>{const b=e.target.closest('button');if(!b)return;
    if('new'in b.dataset)itemSheet();else if(b.dataset.i)itemSheet(await db.pantryItems.get(+b.dataset.i))};
}
function itemSheet(it){
  const sh=sheet(`<h3>${it?'Edit item':'Add to pantry'}</h3><input id="nm" placeholder="Name" value="${it?esc(it.name):''}"><div class="f"><input id="q" type="number" inputmode="decimal" placeholder="Amount" value="${it?q1(it.qty):''}">${unitSel('u',it?it.unit:'g')}</div><div class="err" id="er"></div><button id="sv" style="width:100%">${it?'Save':'Add item'}</button>${it?'<button class="r" id="rm" style="width:100%;margin-top:.4rem">Remove</button>':''}`);
  sh.el.onclick=async e=>{const b=e.target.closest('button');if(!b)return;
    if(b.id==='rm'){await db.pantryItems.delete(it.id);sh.close();render();syncSoon()}
    if(b.id==='sv'){const name=sh.q('#nm').value.trim(),qty=+sh.q('#q').value,unit=sh.q('#u').value;
      if(!name||!(qty>0)||!UNITS.includes(unit))return sh.q('#er').textContent='Enter a name, an amount, and unit g, ml, pcs, tsp, tbsp or cup.';
      // The bar compares the amount with the most you've had (capacity). Both must use the same unit, so when the unit
      // changes (4900 g -> 4.9 kg) the capacity is converted too; otherwise the bar would read as empty.
      let capacity=qty;
      if(it){let cap=it.capacity||0;if(it.unit!==unit&&cap)cap=convertAmount(cap,it.unit,unit,name);capacity=Math.max(cap,qty)}
      it?await db.pantryItems.update(it.id,{name,qty,unit,capacity}):await db.pantryItems.add({name,qty,unit,capacity});
      sh.close();render();syncSoon()}};
}
const amt=i=>['g','ml','pcs'].includes(i.unit)?sizeText(i.qty,i.unit):`${q1(i.qty)} ${i.unit}`;
const saveSet=(key,value)=>db.appSettings.put({key,value});
async function loadPrefs(){await loadProfiles();await loadCorrections();const [p,s]=await Promise.all([db.appSettings.get('packs'),db.appSettings.get('staples')]);setPrefs({packs:p?.value||{},staples:s?.value||[]})}
function packSheet(name){
  const p=name?pkgFor({name,unit:'g'}):null;
  const big=p&&p.size>=1000&&p.size%1000===0&&(p.unit==='g'||p.unit==='ml');
  const pv=!p?{size:'',unit:'g'}:big?{size:p.size/1000,unit:p.unit==='g'?'kg':'l'}:{size:p.size,unit:p.unit};
  const names=['bag','pack','packet','bottle','jar','carton','tub','can','box','bunch','tray','block'];if(p&&!names.includes(p.n))names.unshift(p.n);
  const sh=sheet(`<h3>${name?esc(name):'Pack size'}</h3>${name?'':'<input id="pn" placeholder="Item name">'}<div class="f"><select id="pl" aria-label="Pack type">${names.map(n=>`<option value="${esc(n)}"${n===(p?.n||'pack')?' selected':''}>${esc(n)}</option>`).join('')}</select></div><div class="f"><input id="ps" type="number" inputmode="decimal" placeholder="Size" value="${pv.size}">${unitSel('pu',pv.unit,'',['g','kg','ml','l','pcs'])}</div><div class="err" id="er"></div><button id="sv" style="width:100%">Save</button>${p?.custom?'<button class="r" id="rs" style="width:100%;margin-top:.4rem">Reset to default</button>':''}`);
  sh.el.onclick=async e=>{const b=e.target.closest('button');if(!b)return;
    const k=(name||sh.q('#pn')?.value||'').trim().toLowerCase(),cur=(await db.appSettings.get('packs'))?.value||{};
    if(b.id==='rs')delete cur[k];
    else if(b.id==='sv'){let size=+sh.q('#ps').value,unit=sh.q('#pu').value;const n=sh.q('#pl').value||'pack';
      if(!k||!(size>0))return sh.q('#er').textContent='Enter an item and a size greater than 0.';
      if(unit==='kg'){size*=1000;unit='g'}else if(unit==='l'){size*=1000;unit='ml'}
      cur[k]={n,size:Math.round(size*100)/100,unit}}
    else return;
    await saveSet('packs',cur);await loadPrefs();sh.close();toast('Saved');render();syncSoon();
  };
}
let packsOpen=false;
async function renderSettings(){
  head('Settings','Account, pack sizes and staples');
  const [rs,pi,gl,sv,sh0]=await Promise.all([db.recipes.toArray(),db.pantryItems.toArray(),db.groceryList.toArray(),db.appSettings.get('staples'),shareOn()]);
  const staples=sv?.value||[],seen=new Map();
  for(const i of [...rs.flatMap(r=>r.ingredients),...pi,...gl]){const n=(i.name||'').toLowerCase();if(n&&!seen.has(n))seen.set(n,i.unit||'g')}
  const names=[...seen.keys()].filter(n=>!isStaple({name:n})).sort(),note=t=>`<div style="color:var(--mute);font-size:.88rem;margin:.1rem 0 .6rem">${t}</div>`;
  const acct=!cloud.enabled?'<div class="acct"><div class="av">💾</div><div class="t"><b>Backup isn’t set up</b><div class="s">Your data is saved on this device only.</div></div></div>'
    :cloud.signedIn()?`<div class="acct"><div class="av">${esc((who()[0]||'?').toUpperCase())}</div><div class="t"><b>@${esc(who())}</b><div class="s">Backed up automatically ☁️</div></div></div><div class="f"><button class="g" id="so">Sign out</button><button class="r" id="da">Delete account</button></div>`
    :`<div class="acct"><div class="av">☁️</div><div class="t"><b>You’re not signed in</b><div class="s">${cloud.getError()?`<span style="color:var(--warn)">${esc(cloud.getError())}</span>`:'Create an account to back up your data and use it on other devices.'}</div></div></div><div class="f"><button id="su">Create account</button><button class="g" id="si">Sign in</button></div>${cloud.getError()?'<button class="g" id="retry" style="width:100%;margin-top:.5rem">Retry connection</button>':''}`;
  m.innerHTML=`<details class="fold" id="pk" ${packsOpen?'open':''}><summary>Pack sizes <span class="s" style="font-weight:500">${names.length} item${names.length===1?'':'s'}</span></summary>${note('Grocery lists round up to whole packs. Tap an item to set the size you buy.')}`+
   (names.length?names.map(n=>{const p=pkgFor({name:n,unit:seen.get(n)});
     return `<button class="row" data-p="${esc(n)}"><div class="t"><b>${esc(n)}</b><div class="s">${p?`1 ${esc(p.n)} = ${sizeText(p.size,p.unit)}${p.custom?' · yours':''}`:'Bought by count · tap to set a pack'}</div></div><span style="color:var(--mute)">›</span></button>`}).join('')
    :'<div class="empty" data-e="🧺"><b>No ingredients yet</b>Add a meal and its ingredients show up here.</div>')+
   `<button class="g" data-p="" style="width:100%;margin:.2rem 0 .8rem">+ Other item</button></details><h4>Always-available staples</h4>${note('Never added to Grocery or taken from the pantry. Separate several with commas.')}<div><span class="chip">water</span><span class="chip">ice</span>${staples.map(x=>`<span class="chip">${esc(x)}<button data-rs="${esc(x)}" aria-label="Remove ${esc(x)}">✕</button></span>`).join('')}</div><div class="f" style="margin:.4rem 0 1rem"><input id="st" placeholder="e.g. salt, cooking oil" style="margin:0"><button id="addst" style="flex:none">Add</button></div>
   <h4>Account</h4>${acct}
   <label class="tog"><div><b>Share recipes anonymously</b><div class="s">Helps everyone get more accurate ingredients. Never includes your name or pantry.</div></div><input type="checkbox" id="shr" ${sh0?'checked':''}></label>`;
  $('#pk').ontoggle=e=>{packsOpen=e.target.open};
  $('#shr').onchange=e=>saveSet('cloud_share',e.target.checked);
  m.onclick=async e=>{const b=e.target.closest('button');if(!b)return;const d=b.dataset;
    if('p'in d)packSheet(d.p);
    if(b.id==='retry'){busy(b,1,'Connecting…');await cloud.init();render()}
    if(b.id==='su')authSheet('signup',{done:()=>render()});
    if(b.id==='si')authSheet('signin');
    if(b.id==='so'){await cloud.signOut();toast('Signed out. Your data stays on this device.');render()}
    if(b.id==='da')deleteFlow();
    if(d.rs){await saveSet('staples',staples.filter(x=>x!==d.rs));await loadPrefs();render();syncSoon()}
    if(b.id==='addst'){const add=$('#st').value.split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);if(!add.length)return;
      await saveSet('staples',[...new Set([...staples,...add])]);await loadPrefs();
      const gl2=await db.groceryList.toArray();await db.groceryList.bulkDelete(gl2.filter(g=>add.includes(g.name.toLowerCase())).map(g=>g.id));render();syncSoon()}};
}
// Create account / sign in (used by Settings, the home card and the welcome screen).
function authSheet(mode='signup',opts={}){
  let md=mode;
  const html=()=>`<h3>${md==='signup'?'Create your account':'Welcome back'}</h3><div style="color:var(--mute);font-size:.92rem;margin:-.4rem 0 .9rem">${md==='signup'?'Pick a username and password. Your data backs up automatically.':'Sign in to bring your data to this device.'}</div><input id="un" placeholder="Username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="20"><div class="uh" id="uh"></div><input id="pw" type="password" placeholder="Password${md==='signup'?' (8+ characters)':''}" autocomplete="${md==='signup'?'new-password':'current-password'}"><div class="err" id="er"></div>${md==='signin'&&!opts.fresh?'<div style="color:var(--mute);font-size:.86rem;margin-bottom:.8rem">This replaces the data on this device with your account’s data.</div>':''}<button id="go" style="width:100%">${md==='signup'?'Create account':'Sign in'}</button><button class="r" id="sw" style="width:100%;margin-top:.4rem;color:var(--acc)">${md==='signup'?'I already have an account':'Create a new account'}</button>`;
  const sh=sheet(html());let t;
  sh.el.oninput=e=>{
    if(e.target.id!=='un'||md!=='signup')return;
    clearTimeout(t);const v=e.target.value.trim(),uh=sh.q('#uh');
    if(!v){uh.textContent='';return}
    if(!/^[A-Za-z0-9_]{3,20}$/.test(v)){uh.textContent='3–20 letters, numbers or underscores';uh.className='uh bad';return}
    uh.textContent='Checking…';uh.className='uh';
    t=setTimeout(async()=>{const f=await cloud.usernameFree(v);if(sh.q('#un')?.value.trim()!==v)return;
      uh.textContent=f===null?'':f?'✓ Available':'✗ Already taken';uh.className='uh '+(f===null?'':f?'ok':'bad')},350);
  };
  sh.el.onclick=async e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.id==='sw'){md=md==='signup'?'signin':'signup';sh.q('.sb').innerHTML=html();return}
    if(b.id!=='go')return;
    const u=sh.q('#un').value.trim(),p=sh.q('#pw').value,er=sh.q('#er');er.textContent='';
    if(!u||!p)return er.textContent='Enter a username and password.';
    busy(b,1,md==='signup'?'Creating…':'Signing in…');
    try{
      let restored=false;
      if(md==='signup'){await cloud.signUp(u,p);await cloud.push(await exportUserData());toast(`Welcome, ${cloud.username()}! 🎉`)}
      else{
        await cloud.signIn(u,p);const r=await cloud.pull();
        if(r?.data){await importUserData(r.data);localStorage.setItem('prepd_pushed',String(Date.parse(r.updated_at)));restored=true;toast('Welcome back! Data restored')}
        else await cloud.push(await exportUserData());
      }
      await db.appSettings.put({key:'onboarded',value:true});localStorage.setItem('prepd_onboarded','1');
      sh.close();
      if(opts.done)opts.done(md,restored);else if(restored)setTimeout(()=>location.reload(),500);else render();
    }catch(x){er.textContent=x.message;busy(b,0,md==='signup'?'Create account':'Sign in')}
  };
}
// Delete account: password first, then a second "are you sure".
async function deleteFlow(){
  const c=await cloud.sharedCounts();
  const sh=sheet(`<h3>Delete account</h3><div style="color:var(--mute);font-size:.92rem;margin:-.4rem 0 .9rem">This permanently deletes <b>@${esc(who())}</b> and its cloud backup. The data on this device stays.</div><input id="dp" type="password" placeholder="Confirm your password" autocomplete="current-password">${c.total?`<label class="tog"><div><b>Also delete my shared recipes</b><div class="s">Removes the ${c.unused} of your ${c.total} shared recipe${c.total>1?'s':''} that nobody else has saved. The others stay, with your name removed.</div></div><input type="checkbox" id="ds"></label>`:''}<div class="err" id="er"></div><button class="danger" id="d1" style="width:100%">Continue</button>`);
  sh.el.onclick=async e=>{
    const b=e.target.closest('button');if(!b||b.id!=='d1')return;
    const pw=sh.q('#dp').value,er=sh.q('#er'),flag=!!sh.q('#ds')?.checked;er.textContent='';
    if(!pw)return er.textContent='Enter your password.';
    busy(b,1,'Checking…');
    try{await cloud.verifyPassword(pw)}catch(x){er.textContent=x.message;return busy(b,0,'Continue')}
    sh.close();
    setTimeout(()=>{
      const s2=sheet(`<h3>Are you absolutely sure?</h3><div style="color:var(--mute);font-size:.92rem;margin:-.4rem 0 .9rem">This can’t be undone. Type <b>DELETE</b> to confirm.</div><input id="cf" placeholder="DELETE" autocapitalize="characters" autocomplete="off"><div class="err" id="er"></div><button class="danger" id="d2" style="width:100%">Permanently delete account</button><button class="g" id="no" style="width:100%;margin-top:.5rem">Keep my account</button>`);
      s2.el.onclick=async ev=>{
        const x=ev.target.closest('button');if(!x)return;
        if(x.id==='no')return s2.close();
        if(x.id!=='d2')return;
        if(s2.q('#cf').value.trim()!=='DELETE')return s2.q('#er').textContent='Type DELETE to confirm.';
        busy(x,1,'Deleting…');
        try{await cloud.deleteAccount(pw,flag);s2.close();toast('Account deleted');render()}
        catch(err){s2.q('#er').textContent=err.message;busy(x,0,'Permanently delete account')}
      };
    },420);
  };
}
// First launch: a short, friendly tour with a back button and swipe. Resolves when the user is ready.
function welcome(){
  return new Promise(res=>{
    const info=[['🗓️','Plan your week','Put breakfast, lunch and dinner on a calendar. Prepd does the maths.'],
      ['🧺','Your kitchen keeps count','Eat a meal and your pantry updates. Running low? It lands on your grocery list as whole packs.'],
      ['⏱️','Cook with confidence','Follow recipe steps one by one, with timers built in so nothing burns.']];
    const acct=cloud.enabled,total=info.length+(acct?1:0);
    const el=document.createElement('div');el.className='wel';
    el.innerHTML=`<div class="logo"><svg viewBox="0 0 32 32" width="34" height="34"><circle cx="16" cy="18" r="11" fill="#ff4d3d"/><path d="M16 8c-1-3-4-4-6-3 2 0 3 1 3 3-2 0-4 1-5 2 3-1 6 0 8-1 2 1 5 0 8 1-1-1-3-2-5-2 0-2 1-3 3-3-2-1-5 0-6 3z" fill="#2fb36b"/></svg>Prepd</div>
    <div class="wclip" id="wc"><div class="wtrack" id="wt">${info.map(([e,t,p])=>`<div class="wslide"><div class="big">${e}</div><h2>${t}</h2><p>${p}</p></div>`).join('')}${acct?'<div class="wslide"><div class="big">☁️</div><h2>Make it yours</h2><p>Create an account to back up your data and use Prepd on any device. Or skip it and stay on this device.</p></div>':''}</div></div>
    <div class="dots" id="wd">${Array.from({length:total},()=>'<i></i>').join('')}</div>
    <label class="tog" id="wshare" style="display:none"><div><b>Share recipes anonymously</b><div class="s">Helps everyone get more accurate ingredients. No personal info.</div></div><input type="checkbox" id="wsc" checked></label>
    <div class="wnav" id="wnav"><button class="g" id="wb">‹ Back</button><button id="wn">Next</button></div>
    <div id="wact" style="display:none"><button id="wcr" style="width:100%;padding:.95rem;font-size:1.05rem">Create my account</button><button class="g" id="wj" style="width:100%;margin-top:.5rem">I already have an account</button><button class="r" id="ws" style="width:100%;margin-top:.2rem">Continue without an account</button></div>`;
    document.body.append(el);let i=0;
    const draw=()=>{
      $('#wt',el).style.transform=`translateX(-${i*100}%)`;
      [...$('#wd',el).children].forEach((d,k)=>d.classList.toggle('on',k===i));
      const last=i===total-1,onAcct=acct&&last;
      $('#wb',el).style.visibility=i?'visible':'hidden';
      $('#wn',el).textContent=last?'Get started':'Next';
      $('#wnav',el).style.display=onAcct?'none':'flex';
      $('#wact',el).style.display=onAcct?'block':'none';
      $('#wshare',el).style.display=last?'flex':'none';
    };
    const finish=async()=>{
      await db.appSettings.put({key:'onboarded',value:true});localStorage.setItem('prepd_onboarded','1');
      await db.appSettings.put({key:'cloud_share',value:$('#wsc',el).checked});
      el.classList.add('out');setTimeout(()=>{el.remove();res()},400);
    };
    const go=n=>{i=Math.max(0,Math.min(total-1,n));draw()};
    el.onclick=e=>{const b=e.target.closest('button');if(!b)return;
      if(b.id==='wn')i<total-1?go(i+1):finish();
      if(b.id==='wb')go(i-1);
      if(b.id==='ws')finish();
      if(b.id==='wcr')authSheet('signup',{done:()=>finish()});
      if(b.id==='wj')authSheet('signin',{fresh:true,done:(md,restored)=>restored?location.reload():finish()})};
    let x0=null;const clip=$('#wc',el);                       // swipe left / right
    clip.onpointerdown=e=>{x0=e.clientX};
    clip.onpointerup=e=>{if(x0==null)return;const dx=e.clientX-x0;x0=null;if(Math.abs(dx)>50)go(i+(dx<0?1:-1))};
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
  m.innerHTML=(g.length?g.map(i=>`<div class="row" data-row="${i.id}"><button class="chk" data-buy="${i.id}" aria-label="Mark ${esc(i.name)} bought"></button><span class="em sm">${emojiFor(i.name)}</span><div class="t"><b>${esc(groceryText(i).title)}</b><div class="s">${esc(groceryText(i).sub)}</div></div><button class="r" data-x="${i.id}" style="padding:.4rem">✕</button></div>`).join('')
   :'<div class="empty" data-e="🛒"><b>Nothing to buy</b>Meals you plan add missing ingredients here.</div>')+'<button class="fab" data-new aria-label="Add item">+</button>';
  m.onclick=async e=>{const b=e.target.closest('button');if(!b)return;const d=b.dataset;
    if(d.buy||d.x){const row=$(`[data-row="${d.buy||d.x}"]`);if(d.buy){b.classList.add('on');b.textContent='✓';burst(b);await new Promise(r=>setTimeout(r,220));await restockFromGrocery(+d.buy);toast('Moved to pantry')}else await db.groceryList.delete(+d.x);
      row.classList.add('gone');setTimeout(render,200)}
    if('new'in d){const sh=sheet(`<h3>Add to list</h3><input id="nm" placeholder="Name"><div class="f"><input id="q" type="number" inputmode="decimal" placeholder="Amount">${unitSel('u','g')}</div><div class="err" id="er"></div><button id="sv" style="width:100%">Add to list</button>`);
      sh.el.onclick=async ev=>{if(ev.target.id!=='sv')return;const name=sh.q('#nm').value.trim(),qty=+sh.q('#q').value,unit=sh.q('#u').value;
        if(!name||!(qty>0)||!UNITS.includes(unit))return sh.q('#er').textContent='Enter a name, an amount, and unit g, ml, pcs, tsp, tbsp or cup.';
        await db.groceryList.add({name,qty,unit,checked:0});sh.close();render()}}};
}
// Earlier versions kept a stale capacity when a unit changed (4900 g -> 4.9 kg left capacity 4900), which made the bar
// read as empty. Repair those items once.
async function healPantry(){
  const fix=(await db.pantryItems.toArray()).filter(i=>(i.unit==='kg'||i.unit==='l')&&i.qty>0&&i.capacity>=200&&i.capacity/i.qty>=50);
  if(fix.length)await db.pantryItems.bulkPut(fix.map(i=>({...i,capacity:Math.max(i.qty,i.capacity/1000)})));
  return fix.length>0;
}
const offline=()=>$('#ob').classList.toggle('on',!navigator.onLine);
addEventListener('online',offline);addEventListener('offline',offline);
let gBadge=0;
const drawNav=()=>{$('#n').innerHTML=[['plan','Plan'],['pantry','Pantry'],['grocery','Grocery'],['settings','Settings']].map(([k,l])=>`<button data-t="${k}" class="${k===tab?'on':''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>${l}${k==='grocery'&&gBadge?`<span class="bd">${gBadge}</span>`:''}</button>`).join('')};
async function render(){
  const t0=performance.now();
  drawNav();                                   // the tab bar responds immediately
  const [n]=await Promise.all([db.groceryList.count(),({plan:renderPlan,pantry:renderPantry,grocery:renderGrocery,settings:renderSettings}[tab])()]);
  if(n!==gBadge){gBadge=n;drawNav()}
  if(PERF)console.log(`[perf] ${tab} drawn in ${Math.round(performance.now()-t0)} ms`);
}
// If the database connection was dropped (iOS does this after the app sits in the background), reopen it and retry.
async function safeRender(){
  const stuck=await Promise.race([render().then(()=>false),sleep(4000).then(()=>true)]);
  if(stuck){try{db.close();await db.open()}catch{}await render()}
}
$('#n').onclick=e=>{const t=e.target.closest('button')?.dataset.t;if(t&&t!==tab){tab=t;scrollTo(0,0);m.classList.add('stagger');setTimeout(()=>m.classList.remove('stagger'),600);render().then(()=>pop(m))}};
offline();
(async()=>{
  requestPersistence().catch(()=>{});
  await autoRestore();await loadPrefs();await maybeWelcome();
  m.classList.add('stagger');setTimeout(()=>m.classList.remove('stagger'),600);
  setOnBackup(async snap=>{if(cloud.isReady())await cloud.push(snap)});
  await safeRender();timers.resume();drawTimers();
  // Everything below happens after the first screen is already visible.
  loadEngine().then(()=>{healPantry().then(c=>c&&render());return syncSoon()});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!sheetStack.length){if(!db.isOpen())db.open().catch(()=>{});safeRender()}});
  cloud.init().then(async ok=>{if(!ok)return;
    const r=await cloud.pullIfNewer(importUserData);
    if(r==='pulled'){await loadPrefs();render()}else if(r==='dirty')cloud.push(await exportUserData());
    if(tab==='settings')render()}).catch(()=>{});
  if('serviceWorker'in navigator){
    const hadController=!!navigator.serviceWorker.controller;let reloading=false;   // a new version took over: restart once so the app isn't a mix of old and new files
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(hadController&&!reloading){reloading=true;location.reload()}});
    navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).then(async r=>{try{await r.periodicSync?.register('shortage-check',{minInterval:36e5})}catch{}});
    navigator.serviceWorker.addEventListener('message',e=>e.data==='check-shortages'&&checkUpcomingMenuShortages(48))}
  setInterval(()=>checkUpcomingMenuShortages(48).catch(()=>{}),36e5);
})();
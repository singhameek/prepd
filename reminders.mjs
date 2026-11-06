// Habit learning and reminder rules, shared by the app (in-app nudge) and the server (push reminders).
// Pure functions only: no browser or Node APIs, so the same file runs in both places.
export const HOUR=36e5,DAY=864e5;
const NAMES=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],LONG=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const PRIOR=[1.5,0,0,0,0,0,1.5];                       // start with weekends (index 0 = Sunday), then adapt to what the user does
function parts(ts,tz){
  try{
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz||undefined,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'}).formatToParts(new Date(ts)).map(x=>[x.type,x.value]));
    return {date:`${p.year}-${p.month}-${p.day}`,wd:NAMES.indexOf(p.weekday)};
  }catch{const d=new Date(ts);return {date:d.toISOString().slice(0,10),wd:d.getUTCDay()}}
}
export const dateKey=(ts,tz)=>parts(ts,tz).date;
export const weekdayOf=(ts,tz)=>parts(ts,tz).wd;
// Records that something happened now ('grocery' run, pantry 'checkin', meal 'plan'). One event per kind per day.
export function addEvent(h,kind,ts,tz){
  const ev=h.ev||(h.ev={}),a=ev[kind]||(ev[kind]=[]);
  if(a.length&&dateKey(a[a.length-1],tz)===dateKey(ts,tz))return h;
  a.push(ts);if(a.length>60)a.splice(0,a.length-60);return h;
}
// How strongly each weekday is "the usual day", from recent events (older events count less) plus the weekend prior.
export function dayWeights(h,now,tz){
  const w=PRIOR.slice();
  for(const k of ['grocery','checkin','plan'])for(const t of h?.ev?.[k]||[]){
    const age=(now-t)/(7*DAY);if(age<0||age>16)continue;w[weekdayOf(t,tz)]+=Math.pow(.9,age);
  }
  return w;
}
// The (up to two) weekdays the user usually shops, plans and checks the pantry.
export function usualDays(h,now,tz){
  const w=dayWeights(h,now,tz),max=Math.max(...w);
  return w.map((v,d)=>[d,v]).filter(([,v])=>v>=Math.max(1.5,max*.6)).sort((a,b)=>b[1]-a[1]).slice(0,2).map(x=>x[0]);
}
export const dayLabel=days=>days.map(d=>NAMES[d]).join(' & ');
export const dayName=wd=>LONG[wd];
const no=why=>({send:false,why});
// Should a reminder go out now? mode 'push' = notification (strictly limited), 'app' = the card inside the app.
// upcoming3 = unlogged meals planned for the next 3 days; pantryCount = items in the pantry.
export function decide({h,now,tz,upcoming3=0,pantryCount=0,mode='push',dismissedDate=null}){
  h=h||{};tz=tz||h.tz;const rem=h.rem||{};
  const wd=weekdayOf(now,tz),today=dateKey(now,tz);
  if(!usualDays(h,now,tz).includes(wd))return no('not a usual day');
  const lastPlan=(h.ev?.plan||[]).slice(-1)[0]||0;
  if(now-lastPlan<24*HOUR)return no('planned recently');                       // they planned something: leave them alone
  const planNeeded=upcoming3<3,checkNeeded=pantryCount>0&&now-(h.lastCheckin||0)>7*DAY;
  if(!planNeeded&&!checkNeeded)return no('nothing to remind about');
  if(mode==='app'){if(dismissedDate===today)return no('dismissed today')}
  else{
    const sent=(rem.sent||[]).filter(t=>now-t<30*DAY).sort((a,b)=>a-b),last=sent[sent.length-1];
    if(sent.some(t=>dateKey(t,tz)===today))return no('already sent today');      // at most one a day
    if(last&&now-last<3*DAY)return no('too soon after the last one');             // at least 3 days apart
    if(sent.filter(t=>now-t<7*DAY).length>=2)return no('weekly limit');          // at most 2 a week
    if((rem.ignored||0)>=2&&last&&now-last<14*DAY)return no('backing off after ignored reminders');
    if(last&&lastPlan>last&&now-last<7*DAY)return no('they planned after the last reminder');
  }
  const type=planNeeded&&checkNeeded?'both':planNeeded?'plan':'checkin';
  return {send:true,type,
    title:type==='checkin'?'Quick pantry check-in 🧺':'Time to plan your week 🍽️',
    body:type==='plan'?'Pick a few meals and Prepd builds your grocery list.':type==='checkin'?'A one-minute look keeps your pantry and grocery list accurate.':'Pick a few meals, and a one-minute pantry check-in keeps your grocery list accurate.',
    url:type==='checkin'?'./#checkin':'./#plan'};
}
// Before deciding: was the last reminder acted on? Opening the app within a day counts. Two ignored in a row = back off.
export function settleIgnored(state,lastOpen,now){
  const sent=state.sent||[],last=sent[sent.length-1];let ignored=state.ignored||0,counted=state.counted||0;
  if(last&&last!==counted&&now-last>24*HOUR){ignored=lastOpen&&lastOpen>last?0:ignored+1;counted=last}
  return {ignored,counted};
}

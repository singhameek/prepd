// Cooking timers: several can run at once, survive a reload, and ring (sound, vibration, notification) when done.
const KEY='prepd_timers';
let list=[],tick=null,ctx=null;const subs=new Set();
try{list=JSON.parse(localStorage.getItem(KEY)||'[]')}catch{}
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(list))}catch{}};
export const all=()=>list;
export const left=t=>Math.max(0,Math.ceil((t.end-Date.now())/1000));
export const find=id=>list.find(t=>t.id===id);
export const onTick=f=>{subs.add(f);return()=>subs.delete(f)};
function beep(){
  try{ctx=ctx||new (window.AudioContext||window.webkitAudioContext)();
    [0,.35,.7].forEach(d=>{const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=880;o.connect(g);g.connect(ctx.destination);
      const t=ctx.currentTime+d;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.35,t+.02);g.gain.exponentialRampToValueAtTime(.0001,t+.25);o.start(t);o.stop(t+.3)})}catch{}
}
function ring(t){beep();navigator.vibrate?.([300,150,300,150,300]);dispatchEvent(new CustomEvent('prepd-timer-done',{detail:t}))}
function run(){
  if(tick||!list.length)return;
  tick=setInterval(()=>{
    const now=Date.now(),done=list.filter(t=>t.end<=now);
    if(done.length){list=list.filter(t=>t.end>now);save();done.forEach(ring)}
    subs.forEach(f=>f());
    if(!list.length){clearInterval(tick);tick=null}
  },1000);
}
export function start(id,label,secs){
  try{ctx=ctx||new (window.AudioContext||window.webkitAudioContext)();ctx.resume?.()}catch{}  // unlock sound on this tap
  stop(id,true);list.push({id,label,secs,end:Date.now()+secs*1000});save();run();subs.forEach(f=>f());
}
export function stop(id,quiet){list=list.filter(t=>t.id!==id);save();if(!quiet)subs.forEach(f=>f())}
// Call once at launch: timers that finished while the app was closed ring now.
export function resume(){
  const now=Date.now(),late=list.filter(t=>t.end<=now);
  list=list.filter(t=>t.end>now);save();run();late.forEach(t=>dispatchEvent(new CustomEvent('prepd-timer-done',{detail:t})));
}
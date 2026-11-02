// Cooking steps: splitting pasted text into steps and finding times that need a timer.
const clean=s=>String(s).replace(/\s+/g,' ').trim();
// "1. Chop… 2. Fry…" or one step per line → array of step strings
export function splitSteps(text){
  let t=String(text||'').replace(/\r/g,'').trim();if(!t)return [];
  let parts=t.split(/\n+/).map(clean).filter(Boolean);
  if(parts.length===1)parts=t.split(/\s*(?=\b\d{1,2}[.)]\s+[A-Z])/).map(clean).filter(Boolean);
  return parts.map(p=>p.replace(/^(?:step\s*)?\d{1,2}\s*[.):\-–]\s*/i,'').replace(/^[•\-*]\s*/,'')).filter(p=>p.length>2);
}
const MULT={h:3600,m:60,s:1};
const unitKey=u=>/^h/i.test(u)?'h':/^m/i.test(u)?'m':'s';
const num=v=>{v=String(v).toLowerCase();if(/^(a|an|one)$/.test(v))return 1;if(v.includes('/')){const [a,b]=v.split('/').map(Number);return b?a/b:0}return parseFloat(v.replace(',','.'))};
const VERBS=/\b(simmer|boil|bake|cook|fry|saut[eé]|roast|rest|chill|marinat|refrigerat|freez|steam|soak|knead|proof|rise|grill|broil|reduc|cool|stand|set|whisk|stir|toast|brown|heat|sear|blend|pressure|ferment|infus|drain|dry)\w*/gi;
export function fmtTime(s){s=Math.round(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60,p=n=>String(n).padStart(2,'0');return h?`${h}:${p(m)}:${p(x)}`:`${m}:${p(x)}`}
const short=s=>s>=3600?`${+(s/3600).toFixed(2)} hr`:s>=60?`${+(s/60).toFixed(1).replace(/\.0$/,'')} min`:`${s} sec`;
// Finds durations such as "10 minutes", "10-15 minutes", "1 hour 30 minutes", "an hour". Ranges use the lower end.
export function detectTimers(text){
  const t=String(text),out=[],seen=new Set();
  const re=/(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?|\ban?\b|\bone\b)(?:\s*(?:-|–|—|to|or)\s*(\d+(?:[.,]\d+)?))?\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b(?:\s*(?:and\s*)?(\d+)\s*(minutes?|mins?|seconds?|secs?)\b)?/gi;
  let m;
  while((m=re.exec(t))){
    const v=num(m[1]);if(!(v>0))continue;
    let secs=v*MULT[unitKey(m[3])];if(m[4])secs+=Number(m[4])*MULT[unitKey(m[5])];
    secs=Math.round(secs);if(secs<5||secs>86400)continue;
    const before=t.slice(Math.max(0,m.index-70),m.index),vs=[...before.matchAll(VERBS)],verb=vs.length?vs[vs.length-1][0]:'';
    const word=verb?verb[0].toUpperCase()+verb.slice(1).toLowerCase():'Timer';
    const range=m[2]?`${m[1]}–${m[2]} ${m[3].toLowerCase()}`:'';
    const key=word+secs;if(seen.has(key))continue;seen.add(key);
    out.push({label:`${word} · ${range||short(secs)}`,seconds:secs});
  }
  return out;
}
// One call for everything: steps with their timers. A smarter engine can replace this later with the same shape.
export function parseSteps(text){return splitSteps(text).map((t,i)=>({index:i,text:t,timers:detectTimers(t)}))}
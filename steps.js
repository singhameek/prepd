// Cooking steps: splitting pasted text into steps and finding times that need a timer (powered by the ingredient engine).
import {engine} from './engine.js';
const clean=s=>String(s).replace(/\s+/g,' ').trim();
const strip=p=>p.replace(/^(?:step\s*)?\d{1,2}\s*[.):\-–]\s*/i,'').replace(/^[•\-*]\s*/,'');
function localSplit(text){
  const t=String(text||'').replace(/\r/g,'').trim();if(!t)return [];
  let parts=t.split(/\n+/).map(clean).filter(Boolean);
  if(parts.length===1)parts=t.split(/\s*(?=\b\d{1,2}[.)]\s+[A-Z])/).map(clean).filter(Boolean);
  return parts.map(strip).filter(p=>p.length>2);
}
// "1. Chop… 2. Fry…" or one step per line → array of step strings
export function splitSteps(text){
  try{const E=engine();if(E){const s=(E.splitStepsText(String(text||''))||[]).map(x=>strip(clean(x))).filter(p=>p.length>2);if(s.length)return s}}catch{}
  return localSplit(text);
}
export function fmtTime(s){s=Math.round(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60,p=n=>String(n).padStart(2,'0');return h?`${h}:${p(m)}:${p(x)}`:`${m}:${p(x)}`}
const short=s=>s>=3600?`${+(s/3600).toFixed(2)} hr`:s>=60?`${+(s/60).toFixed(1).replace(/\.0$/,'')} min`:`${s} sec`;
const cap=w=>w?w[0].toUpperCase()+w.slice(1).toLowerCase():'Timer';
// Times in one step that deserve a timer, e.g. {label:"Simmer · 10–15 min", seconds:600}. Ranges use the lower end.
export function detectTimers(text){
  const out=[],seen=new Set();let d=[];
  try{d=engine()?.detectDurations(String(text))||[]}catch{}
  for(const x of d){
    const secs=Math.round(x.seconds);if(!(secs>=5&&secs<=172800))continue;
    const verb=x.label&&x.label!=='other'?x.label:(x.kind&&x.kind!=='other'?x.kind:'timer');
    const rng=x.rangeText?String(x.rangeText).replace(/(\d)\s*-\s*(\d)/,'$1–$2'):'';
    const key=verb+secs;if(seen.has(key))continue;seen.add(key);
    out.push({label:`${cap(verb)} · ${rng||short(secs)}`,seconds:secs});
  }
  return out;
}
// One call for everything: steps with their timers.
export function parseSteps(text){return splitSteps(text).map((t,i)=>({index:i,text:t,timers:detectTimers(t)}))}
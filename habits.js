// Learns when the user usually shops, plans and checks the pantry (stored with the rest of their data, so it follows
// them to other devices). The rules live in reminders.mjs.
import {db,scheduleAutoBackup} from './db.js';
import * as R from './reminders.mjs';
let H={};
const tzNow=()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone}catch{return undefined}};
export async function loadHabits(){H=(await db.appSettings.get('habits'))?.value||{};H.tz=tzNow()||H.tz}
const save=async()=>{await db.appSettings.put({key:'habits',value:H});scheduleAutoBackup()};   // also syncs to the cloud
export const get=()=>H;
export async function record(kind){R.addEvent(H,kind,Date.now(),H.tz);await save()}      // 'grocery' | 'checkin' | 'plan'
export async function markCheckin(){H.lastCheckin=Date.now();R.addEvent(H,'checkin',H.lastCheckin,H.tz);await save()}
export const usualDays=()=>R.usualDays(H,Date.now(),H.tz);
export const checkinDue=(pantryCount)=>pantryCount>0&&Date.now()-(H.lastCheckin||0)>7*R.DAY;
export const daysSinceCheckin=()=>H.lastCheckin?Math.floor((Date.now()-H.lastCheckin)/R.DAY):null;
// The in-app version of a reminder: shown on the usual days when it would help, and dismissible for the day.
export function nudge({upcoming3,pantryCount}){
  return R.decide({h:H,now:Date.now(),tz:H.tz,upcoming3,pantryCount,mode:'app',dismissedDate:H.dismissed||null});
}
export async function dismissNudge(){H.dismissed=R.dateKey(Date.now(),H.tz);await save()}
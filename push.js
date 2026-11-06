import * as cfg from './config.js';
import * as cloud from './cloud.js';
export const configured=()=>!!cfg.VAPID_PUBLIC_KEY;
export const supported=()=>configured()&&'serviceWorker'in navigator&&'PushManager'in window&&typeof Notification!=='undefined';
const key=s=>{const raw=atob((s+'='.repeat((4-s.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0))};
// 'unconfigured' | 'unsupported' | 'blocked' | 'off' | 'on'
export async function status(){
  if(!configured())return 'unconfigured';
  if(!supported())return 'unsupported';
  if(Notification.permission==='denied')return 'blocked';
  try{const reg=await navigator.serviceWorker.ready;return (await reg.pushManager.getSubscription())?'on':'off'}catch{return 'off'}
}
export async function enable(){
  if(!supported())throw new Error('This browser can’t show reminders. On iPhone, add Prepd to your Home Screen first.');
  if(!cloud.signedIn())throw new Error('Sign in first so reminders can find you.');
  if(await Notification.requestPermission()!=='granted')throw new Error('Notifications are blocked. Allow them in your browser or phone settings.');
  const reg=await navigator.serviceWorker.ready;
  const sub=(await reg.pushManager.getSubscription())||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key(cfg.VAPID_PUBLIC_KEY)});
  let tz;try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone}catch{}
  if(!await cloud.savePushSub(sub.toJSON(),tz))throw new Error('Couldn’t save the reminder setting. Please try again.');
}
export async function disable(){
  try{const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();
    if(sub){await cloud.deletePushSub(sub.endpoint);await sub.unsubscribe()}}catch{}
}
import Dexie from 'https://cdn.jsdelivr.net/npm/dexie@4.0.8/+esm';
export const db=new Dexie('SmartKitchenDB');
db.version(1).stores({
  pantryItems:'++id,name,category,expiry',
  recipes:'++id,name',                    // {name,text,ingredients[]}
  mealPlans:'++id,date,recipeId,logged',  // {date,slot,recipeId,scale,logged}
  nutritionLogs:'++id,date',
  groceryList:'++id,name,checked',
  appSettings:'key'
});
export const today=()=>new Date().toLocaleDateString('sv');
export async function requestPersistence(){
  if(!navigator.storage?.persist)return false;
  return (await navigator.storage.persisted())||navigator.storage.persist();
}
const TABLES=['pantryItems','recipes','mealPlans','nutritionLogs','groceryList'];
export async function exportUserData(){
  const d={app:'SmartKitchen',version:1,exported:new Date().toISOString()};
  for(const t of TABLES)d[t]=await db[t].toArray();
  d.settings=(await db.appSettings.toArray()).filter(x=>!/^(backup|cloud_|device_)/.test(x.key));
  return JSON.stringify(d);
}
export async function importUserData(json){
  const d=typeof json==='string'?JSON.parse(json):json;
  if(d.app!=='SmartKitchen')throw new Error('Not a SmartKitchen backup.');
  await db.transaction('rw',TABLES.map(t=>db[t]),async()=>{
    for(const t of TABLES){await db[t].clear();if(d[t]?.length)await db[t].bulkPut(d[t])}
  });
  if(d.settings?.length)await db.appSettings.bulkPut(d.settings);
}
// Automatic backups: 3 rotating slots, written 2s after any change.
let timer,onBackup=null;
export const setOnBackup=f=>{onBackup=f};
export function scheduleAutoBackup(){
  try{localStorage.setItem('prepd_dirty','1')}catch{}
  clearTimeout(timer);
  timer=setTimeout(async()=>{
    const cur=(await db.appSettings.get('backupCursor'))?.value??-1,n=(cur+1)%3,snap=await exportUserData();
    await db.appSettings.put({key:'backup_'+n,value:snap,ts:Date.now()});
    await db.appSettings.put({key:'backupCursor',value:n});
    try{await onBackup?.(snap)}catch{}  // also copies to the cloud when set up
  },2000);
}
for(const t of TABLES)for(const h of['creating','updating','deleting'])db[t].hook(h,()=>{scheduleAutoBackup()});
// If data vanished (e.g. store corrupted) restore the newest backup automatically.
export async function autoRestore(){
  const counts=await Promise.all(TABLES.map(t=>db[t].count()));
  if(counts.some(c=>c))return false;
  const slots=(await db.appSettings.toArray()).filter(s=>s.key.startsWith('backup_')).sort((a,b)=>b.ts-a.ts);
  if(!slots.length)return false;
  await importUserData(slots[0].value);return true;
}
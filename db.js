import Dexie from 'https://cdn.jsdelivr.net/npm/dexie@4.0.8/+esm';
export const db=new Dexie('SmartKitchenDB');
db.version(1).stores({
  pantryItems:'++id,name,category,expiry',        // {name,qty,capacity,unit,macrosPer100,category,expiry}
  recipes:'++id,name',                             // {name,servings,ingredients[],macros}
  mealPlans:'++id,date,recipeId,logged',           // {date:'YYYY-MM-DD',recipeId,scale,logged}
  nutritionLogs:'++id,date',                       // {date,recipeId,name,calories,protein,carbs,fat}
  groceryList:'++id,name,checked',                 // {name,qty,unit,checked}
  appSettings:'key'                                // {key,value}
});
export const today=()=>new Date().toLocaleDateString('sv');
export async function requestPersistence(){
  if(!navigator.storage?.persist)return false;
  return (await navigator.storage.persisted())||navigator.storage.persist();
}
export const getSetting=async(k,d)=>(await db.appSettings.get(k))?.value??d;
export const setSetting=(k,value)=>db.appSettings.put({key:k,value});
const TABLES=['pantryItems','recipes','mealPlans','nutritionLogs','groceryList','appSettings'];
export async function exportUserData(){
  const data={app:'SmartKitchen',version:1,exported:new Date().toISOString()};
  for(const t of TABLES)data[t]=await db[t].toArray();
  return JSON.stringify(data);
}
export async function importUserData(json){
  const d=typeof json==='string'?JSON.parse(json):json;
  if(d.app!=='SmartKitchen')throw new Error('Not a SmartKitchen backup file.');
  await db.transaction('rw',TABLES.map(t=>db[t]),async()=>{
    for(const t of TABLES){await db[t].clear();if(d[t]?.length)await db[t].bulkPut(d[t])}
  });
}
// Rotating in-DB backup slots (3), plus optional file download
let timer;
export function scheduleAutoBackup(){
  clearTimeout(timer);
  timer=setTimeout(async()=>{
    const n=((await getSetting('backupCursor',-1))+1)%3;
    const snap=await exportUserData();
    await db.appSettings.put({key:'backup_slot_'+n,value:snap,ts:Date.now()});
    await setSetting('backupCursor',n);
  },3000);
}
for(const t of TABLES.filter(t=>t!=='appSettings'))
  for(const h of['creating','updating','deleting'])db[t].hook(h,()=>{scheduleAutoBackup()});
export function downloadBackup(json){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([json],{type:'application/json'}));
  a.download=`smartkitchen-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1e3);
}

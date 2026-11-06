// Daily reminder job (runs from the cron in vercel.json). For each person who turned reminders on, it reads their
// habits and plans from their backup and decides, with the rules in reminders.mjs, whether to send a push notification.
// Environment (Vercel): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET.
// Manual test: /api/remind?key=<CRON_SECRET>&dry=1 shows what it would do without sending anything.
const webpush=require('web-push');
module.exports=async(req,res)=>{
  const SB=process.env.SUPABASE_URL,KEY=process.env.SUPABASE_SERVICE_ROLE_KEY,secret=process.env.CRON_SECRET;
  const auth=req.headers.authorization===`Bearer ${secret}`||(req.query&&req.query.key===secret);
  if(!secret||!auth)return res.status(401).json({error:'Unauthorized'});
  if(!SB||!KEY||!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY)return res.status(500).json({error:'Reminders are not configured (see api/remind.js).'});
  const dry=req.query&&req.query.dry==='1';
  const H={apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'};
  const rest=async(path,o={})=>{
    const r=await fetch(`${SB}/rest/v1/${path}`,{...o,headers:{...H,...(o.headers||{})}});
    if(!r.ok)throw new Error(`${path.split('?')[0]} ${r.status}`);
    return o.method&&o.method!=='GET'?null:r.json();
  };
  try{
    webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:admin@example.com',process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
    const {decide,settleIgnored,dateKey}=await import('../reminders.mjs');
    const now=Date.now(),subs=await rest('push_subs?select=endpoint,user_id,sub,tz');
    const byUser=new Map();for(const s of subs){if(!byUser.has(s.user_id))byUser.set(s.user_id,[]);byUser.get(s.user_id).push(s)}
    if(!byUser.size)return res.status(200).json({users:0,sent:0});
    const ids=[...byUser.keys()].join(',');
    const [rows,states]=await Promise.all([rest(`user_data?select=user_id,data&user_id=in.(${ids})`),rest(`push_state?select=*&user_id=in.(${ids})`)]);
    const dataOf=new Map(rows.map(r=>[r.user_id,r.data||{}])),stateOf=new Map(states.map(s=>[s.user_id,s]));
    const out=[];let sent=0;
    for(const [uid,list] of byUser){
      const data=dataOf.get(uid)||{},habits=((data.settings||[]).find(x=>x.key==='habits')||{}).value||{};
      const tz=habits.tz||list[0].tz||'UTC',st=stateOf.get(uid)||{sent:[],ignored:0,counted:0,last_open:0};
      const today=dateKey(now,tz),soon=new Set([0,1,2].map(i=>dateKey(now+i*864e5,tz)));
      const upcoming3=(data.mealPlans||[]).filter(p=>!p.logged&&soon.has(p.date)).length;
      const {ignored,counted}=settleIgnored({sent:st.sent,ignored:st.ignored,counted:st.counted},st.last_open,now);
      const d=decide({h:{...habits,rem:{sent:st.sent,ignored}},now,tz,upcoming3,pantryCount:(data.pantryItems||[]).length,mode:'push'});
      const item={user:uid.slice(0,8),tz,today,upcoming3,send:d.send,why:d.why||d.type};
      if(d.send&&!dry){
        const payload=JSON.stringify({title:d.title,body:d.body,url:d.url,tag:'prepd-reminder'});
        let delivered=0;
        for(const s of list){
          try{await webpush.sendNotification(s.sub,payload);delivered++}
          catch(e){if(e.statusCode===404||e.statusCode===410)await rest(`push_subs?endpoint=eq.${encodeURIComponent(s.endpoint)}`,{method:'DELETE'}).catch(()=>{})}
        }
        item.delivered=delivered;
        if(delivered){sent++;await rest('push_state?on_conflict=user_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({user_id:uid,sent:[...st.sent.filter(t=>now-t<30*864e5),now].slice(-20),ignored,counted})})}
      }else if(!dry&&(ignored!==st.ignored||counted!==st.counted)){
        await rest('push_state?on_conflict=user_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({user_id:uid,sent:st.sent,ignored,counted})});
      }
      out.push(item);
    }
    return res.status(200).json({users:byUser.size,sent,dry,results:out});
  }catch(e){return res.status(500).json({error:String(e.message||e)})}
};
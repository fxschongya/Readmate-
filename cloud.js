// ReadMate V4.5: three-choice dialog, cache-busted module URL.
import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth,onAuthStateChanged,createUserWithEmailAndPassword,signInWithEmailAndPassword,signOut} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {getFirestore,collection,addDoc,doc,setDoc,query,where,onSnapshot,serverTimestamp,deleteDoc,getDoc} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
const cfg=window.READMATE_FIREBASE_CONFIG;
const bridge=window.readmateBridge;
let auth,db,user=null,role=localStorage.getItem('rm_role')||'student',studentUid=localStorage.getItem('rm_student_uid')||'',unsubs=[],assignments=[],submissions=[];
// Each device has its own backup document, preventing one partner/device from overwriting another.
const DEVICE_KEY='rm_backup_device_v36';
let deviceId=localStorage.getItem(DEVICE_KEY);
if(!deviceId){deviceId=(crypto.randomUUID?.()||('device-'+Date.now()+'-'+Math.random().toString(36).slice(2)));localStorage.setItem(DEVICE_KEY,deviceId)}
let backupTimer=null,backupBusy=false,backupAgain=false;
function scheduleBackup(){if(!user||!db)return;clearTimeout(backupTimer);backupTimer=setTimeout(()=>backupNow(true),10000)}
async function backupNow(silent=false){
 if(!user||!db){if(!silent)say('请先登录并联网，再进行云端备份。');return false}
 if(backupBusy){backupAgain=true;return false}
 backupBusy=true;
 try{
  const snapshot=bridge.getBackupState();
  const raw=JSON.stringify(snapshot);
  // Firestore documents are capped at 1 MiB; leave room for metadata and encoding.
  if(new Blob([raw]).size>850000)throw Error('备份超过单条云端记录安全容量（约 850 KB），请先导出本机 JSON 备份。');
  await setDoc(doc(db,'userBackups',user.uid,'devices',deviceId),{
   ownerUid:user.uid,deviceId,version:36,updatedAt:serverTimestamp(),
   articleCount:snapshot.articles.length,attemptCount:snapshot.attempts.length,
   payload:raw
  });
  if(!silent)say('云端备份成功：已保存本设备的文章、成绩、生词及草稿。');
  return true;
 }catch(err){console.warn('云端备份失败',err);if(!silent)say('云端备份失败：'+err.message);return false}
 finally{backupBusy=false;if(backupAgain){backupAgain=false;scheduleBackup()}}
}
async function restoreBackup(){
 if(!user||!db){say('请先登录并联网。');return}
 try{
  const snap=await getDoc(doc(db,'userBackups',user.uid,'devices',deviceId));
  if(!snap.exists()){say('本设备尚无云端备份。其他设备的备份不会自动覆盖当前设备。');return}
  const b=snap.data(), data=JSON.parse(b.payload);
  if(!confirm('找到本设备云端备份（文章 '+b.articleCount+' 篇，答题 '+b.attemptCount+' 次）。恢复将合并到当前本机数据，跳过重复记录，不覆盖已有进度。历史成绩不会自动补传云端。确认继续？'))return;
  const result=bridge.restoreBackupState(data);
  say(`云端备份合并成功：新增 ${result.articles} 篇文章、${result.attempts} 次作答。`);
 }catch(err){say('恢复失败：'+err.message)}
}
const PENDING_KEY='readmate_pending_submissions_v32';
const seenKey=uid=>'rm_seen_cloud_'+uid;
function seenCloud(uid){try{return JSON.parse(localStorage.getItem(seenKey(uid))||'[]')}catch{return []}}
function getPending(){try{return JSON.parse(localStorage.getItem(PENDING_KEY)||'[]')}catch{return []}}
function savePending(v){try{localStorage.setItem(PENDING_KEY,JSON.stringify(v))}catch(err){say('本机存储空间不足，无法保存待同步记录：'+err.message)}}
let flushing=false;
async function flushPending(){
 if(flushing||!db||!user)return;
 flushing=true;
 try{
   const pending=getPending();let done=0;
   for(const item of pending){
     if(item.studentUid!==user.uid)continue
      const deletion=bridge.deletedAttempts()[item.attemptId];
      if(deletion==='1'||deletion==='both'||deletion==='cloud-only'){savePending(getPending().filter(p=>p.id!==item.id));continue}
      // '2' = only local: cloud submission must still be uploaded.

     if(!assignments.some(a=>a.cloudId===item.payload.assignmentId)){continue}
     try{await setDoc(doc(db,'submissions',item.id),{...item.payload,createdAt:serverTimestamp()});done++}
     catch(err){console.warn('云端补传失败',err);break}
     savePending(getPending().filter(p=>p.id!==item.id));
   }
   if(done)rerender();
 }finally{flushing=false}
}
window.addEventListener('online',()=>flushPending());
const HIDDEN_SUBMISSIONS_KEY='rm_hidden_submissions_v38';
function hiddenSubmissions(){try{return JSON.parse(localStorage.getItem(HIDDEN_SUBMISSIONS_KEY)||'{}')}catch{return {}}}
function isCloudRecordHidden(id){return !!hiddenSubmissions()[id]}
function hideCloudRecord(id){const h=hiddenSubmissions();h[id]=true;localStorage.setItem(HIDDEN_SUBMISSIONS_KEY,JSON.stringify(h))}
function chooseDeletion(){
 return new Promise(resolve=>{
  const old=document.getElementById('rm-delete-dialog');if(old)old.remove();
  const overlay=document.createElement('div');overlay.id='rm-delete-dialog';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(18,27,42,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box';
  const panel=document.createElement('section');
  panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','rm-delete-title');
  panel.style.cssText='width:min(100%,430px);background:#fff;color:#1f2937;border-radius:20px;padding:24px;box-shadow:0 20px 55px rgba(0,0,0,.25);box-sizing:border-box;font-family:system-ui,-apple-system,sans-serif';
  panel.innerHTML=`<h2 id="rm-delete-title" style="font-size:21px;margin:0 0 6px">删除这次作答记录</h2>
   <p style="font-size:14px;color:#64748b;margin:0 0 18px;line-height:1.5">请选择删除范围。其他作答记录不会受到影响。</p>
   <div style="display:grid;gap:10px">
    <button type="button" data-mode="2" style="width:100%;padding:15px;text-align:left;border:1px solid #cbd5e1;background:#f8fafc;border-radius:12px;color:#0f172a;font-size:16px;font-weight:650"><svg class="rm-inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M11 18h2"/></svg> 仅删除本机 <span style="display:block;font-size:12px;font-weight:400;color:#64748b;margin-top:4px">云端成绩保留</span></button>
    <button type="button" data-mode="3" style="width:100%;padding:15px;text-align:left;border:1px solid #cbd5e1;background:#f8fafc;border-radius:12px;color:#0f172a;font-size:16px;font-weight:650"><svg class="rm-inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 19h11a4 4 0 0 0 .5-8 6.5 6.5 0 0 0-12.4-1.3A4.7 4.7 0 0 0 7 19z"/></svg> 仅删除云端 <span style="display:block;font-size:12px;font-weight:400;color:#64748b;margin-top:4px">本机成绩保留</span></button>
    <button type="button" data-mode="1" style="width:100%;padding:15px;text-align:left;border:1px solid #fecaca;background:#fff1f2;border-radius:12px;color:#b91c1c;font-size:16px;font-weight:650"><svg class="rm-inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v7"/><path d="M14 11v7"/><path d="M6 7l1 14h10l1-14"/><path d="M9 7V4h6v3"/></svg> 本机和云端都删除 <span style="display:block;font-size:12px;font-weight:400;color:#b91c1c;margin-top:4px">两边都删除，请谨慎选择</span></button>
   </div><button type="button" data-cancel style="display:block;width:100%;padding:13px;border:0;background:transparent;color:#475569;font-size:15px;margin-top:10px">取消</button>`;
  overlay.append(panel);document.body.append(overlay);
  const previousFocus=document.activeElement;
  const finish=(mode)=>{overlay.remove();document.removeEventListener('keydown',onKey);if(previousFocus?.focus)previousFocus.focus();resolve(mode)};
  const onKey=e=>{if(e.key==='Escape'){e.preventDefault();finish(null)}};
  document.addEventListener('keydown',onKey);
  overlay.addEventListener('click',e=>{if(e.target===overlay)finish(null)});
  panel.querySelector('[data-cancel]').addEventListener('click',()=>finish(null));
  panel.querySelectorAll('[data-mode]').forEach(btn=>btn.addEventListener('click',()=>finish(btn.dataset.mode)));
  panel.querySelector('[data-mode="2"]').focus();
 });
}
let deletionBusy=false;
async function deleteAttempt(localId,cloudId=null){
 if(deletionBusy||document.getElementById('rm-delete-dialog'))return;
 if(!user){alert('请先登录账号。');return}
 const local=bridge.getBackupState().attempts.find(a=>a.id===localId);
 const found=cloudId?submissions.find(s=>s.cloudId===cloudId):submissions.find(s=>s.localAttemptId===localId&&s.studentUid===user.uid);
 const pending=getPending().filter(p=>p.attemptId===localId&&p.studentUid===user.uid);
 if(!local&&!found&&!pending.length){alert('未找到这条答题记录，请重新打开页面后重试。');return}
 const mode=await chooseDeletion();if(!mode)return;
 if((mode==='1'||mode==='3')&&!found&&!pending.length){
  alert('找不到这条记录对应的云端成绩，不能安全删除云端。可以选择仅删除本机。');return;
 }
 if(mode==='2'&&!local){alert('当前设备没有这条本机记录，请选择仅删除云端。');return}
 if(!confirm('确定'+({1:'本机和云端一起删除',2:'仅删除本机',3:'仅删除云端'}[mode])+'这条答题记录吗？此操作不可撤销。'))return;
 deletionBusy=true;
 try{
  if(mode==='1'||mode==='3'){
   if(found){
    if(found.studentUid!==user.uid){alert('只能删除自己提交的云端成绩。');return}
    try{await deleteDoc(doc(db,'submissions',found.cloudId))}
    catch(err){alert('云端删除失败，本机未删除：'+err.message);return}
   }
   // Pending-only record is not in cloud. Cancel it to prevent re-upload.
   if(localId)savePending(getPending().filter(p=>!(p.attemptId===localId&&p.studentUid===user.uid)));
   if(found)hideCloudRecord(found.cloudId);
  }
  if(mode==='1'||mode==='2'){
   if(localId)bridge.deleteLocalAttempt(localId,mode);
   // Only-local deletion must not hide the existing cloud submission.
  }else if(localId){
   // Preserve local attempt and mark cloud-only to suppress future uploads.
   bridge.hideAttempt(localId,'cloud-only');
  }
  rerender();
  say('删除完成：'+({1:'本机和云端',2:'仅本机',3:'仅云端'}[mode]));
 }finally{deletionBusy=false}
}

const e=bridge.escape;const fmt=t=>bridge.formatDate(t);const order=s=>(s.createdAt?.seconds?new Date(s.createdAt.seconds*1000).toISOString():s.clientTime||'');const attemptIndex=(s,all)=>all.filter(x=>x.assignmentId===s.assignmentId&&order(x)<=order(s)).length;
const say=msg=>{const p=document.getElementById('cloudMsg');if(p)p.textContent=msg;else alert(msg)};
function rerender(){if(bridge.currentTab()==='cloud')showCloud();bridge.renderHomeIfVisible()}
function setupListeners(){
 unsubs.forEach(x=>x());unsubs=[];assignments=[];submissions=[];
 if(!user){rerender();return}
 const ownAssignments=new Map(),receivedAssignments=new Map(),ownSubmissions=new Map(),receivedSubmissions=new Map();
 const onError=err=>say('云端读取失败：'+err.message);
 const refresh=()=>{
  assignments=[...new Map([...ownAssignments.values(),...receivedAssignments.values()].map(a=>[a.cloudId,a])).values()];
  submissions=[...new Map([...ownSubmissions.values(),...receivedSubmissions.values()].map(a=>[a.cloudId,a])).values()];
  const received=assignments.filter(a=>a.studentUid===user.uid);
  const old=seenCloud(user.uid);
  bridge.syncCloudArticles(received,old);
  localStorage.setItem(seenKey(user.uid),JSON.stringify([...new Set([...old,...received.map(a=>a.cloudId)])]));
  rerender();
 };
 for(const [field,bucket] of [['teacherUid',ownAssignments],['studentUid',receivedAssignments]]){
  unsubs.push(onSnapshot(query(collection(db,'assignments'),where(field,'==',user.uid)),snap=>{
   bucket.clear();snap.docs.forEach(d=>bucket.set(d.id,{cloudId:d.id,...d.data()}));refresh();
  },onError));
 }
 for(const [field,bucket] of [['teacherUid',ownSubmissions],['studentUid',receivedSubmissions]]){
  unsubs.push(onSnapshot(query(collection(db,'submissions'),where(field,'==',user.uid)),snap=>{
   bucket.clear();snap.docs.forEach(d=>bucket.set(d.id,{cloudId:d.id,...d.data()}));refresh();
  },onError));
 }
}
function roleSet(next){role=next;localStorage.setItem('rm_role',next);setupListeners();flushPending()}
function submissionDate(s){const t=order(s);return /^\d{4}-\d{2}-\d{2}/.test(t)?t.slice(0,10):'日期未知'}

/* V4.10: cloud archives share the same collapsed year/month/day layout. */
function cloudTreeArchive(entries,makeItem,emptyText='暂无文章',unit='篇',renderDay=null){
 if(!entries.length)return '<p class="muted">'+e(emptyText)+'</p>';
 const years=new Map();
 for(const item of entries){const d=/^\d{4}-\d{2}-\d{2}$/.test(item.date||'')?item.date:null;
  const y=d?d.slice(0,4):'日期未设置',m=d?d.slice(5,7):'未设置',day=d?d.slice(8):'未设置';
  if(!years.has(y))years.set(y,new Map());const months=years.get(y);if(!months.has(m))months.set(m,new Map());const days=months.get(m);if(!days.has(day))days.set(day,[]);days.get(day).push(item.value);
 }
 const count=x=>[...x.values()].reduce((n,v)=>n+(v instanceof Map?count(v):v.length),0);
 const sorted=x=>[...x].sort(([a],[b])=>b.localeCompare(a,'zh-CN'));
 return '<div class="rm-tree">'+sorted(years).map(([y,months])=>'<details class="rm-tree-year"><summary>'+e(y)+(y==='日期未设置'?'':' 年')+' <span class="pill">'+count(months)+' '+e(unit)+'</span></summary>'+sorted(months).map(([m,days])=>'<details class="rm-tree-month"><summary>'+e(m)+(m==='未设置'?'':' 月')+' <span class="pill">'+count(days)+' '+e(unit)+'</span></summary>'+sorted(days).map(([d,items])=>'<div class="rm-tree-day rm-tree-day-open"><div class="rm-tree-day-label">'+e(d)+(d==='未设置'?'':' 日')+' <span class="pill">'+items.length+' '+e(unit)+'</span></div><div class="rm-tree-items">'+(renderDay?renderDay(items):items.map(makeItem).join(''))+'</div></div>').join('')+'</details>').join('')+'</details>').join('')+'</div>';
}
function publishedArchive(){
 const published=assignments.filter(a=>a.teacherUid===user.uid);
 const date=a=>{const d=a.publishedDate||(a.createdAt?.seconds?fmt(a.createdAt.seconds*1000):'');return /^\d{4}-\d{2}-\d{2}/.test(d)?d.slice(0,10):''};
 return '<p class="tiny muted">按发布日期：年份 → 月份可折叠，展开月份后直接显示每天的文章。</p>'+cloudTreeArchive(published.map(a=>({date:date(a),value:a})),a=>`<details class="item"><summary><b>${e(bridge.dayLabel(a))} · ${e(a.title||'无标题阅读')}</b></summary><div style="padding:8px"><p class="tiny">学习日期：${e(a.studyDate||'未设置')}<br>发布日期：${e(date(a)||'未设置')}<br>接收者：${a.studentUid===user.uid?'我自己':'对象'}</p><button class="danger" data-delete-cloud="${e(a.cloudId)}">删除这份云端任务</button></div></details>`,'暂无已发布文章');
}
function studyArchive(list,makeItem,empty){
 return '<p class="tiny muted">按学习日期：年份 → 月份可折叠，展开月份后直接显示每天的文章。</p>'+cloudTreeArchive(list.map(a=>({date:a.studyDate||bridge.assignedDate(a)||'',value:a})),makeItem,empty);
}
function localPublishArchive(){return studyArchive(bridge.getArticles(),a=>`<div class="item row" style="margin:8px 0 0 8px"><span style="flex:1"><b>${e(bridge.dayLabel(a))} · ${e(a.title||'无标题')}</b><div class="small">${e(a.level||'阅读')} · ${Array.isArray(a.questions)?a.questions.length:0} 题</div></span><button class="secondary" data-publish="${e(a.id)}">发布</button></div>`,'请先去「管理」导入题目');}
function receivedArchive(){return studyArchive(assignments.filter(a=>a.studentUid===user.uid),a=>`<div class="item row" style="margin:8px 0 0 8px"><span style="flex:1"><b>${e(bridge.dayLabel(a))} · ${e(a.title||'无标题')}</b><div class="small">${e(a.level||'阅读')} · ${Array.isArray(a.questions)?a.questions.length:0} 题</div></span><button class="secondary" data-study="${e(a.cloudId)}">开始阅读${bridge.isCloudHidden(a.cloudId)?'（恢复本机）':''}</button></div>`,'还没有收到新阅读；发布后保持联网，通常会自动出现。');}
function cloudHistory(historyRecords=submissions){
 historyRecords=historyRecords.filter(s=>!isCloudRecordHidden(s.cloudId));
 if(!historyRecords.length)return '<p class="muted">还没有收到答题记录。</p>';
 return '<p class="tiny muted">按实际作答日期：年份 → 月份可折叠，日期及文章直接显示；点击文章可查看各次作答，旧成绩不会删除。</p>'+cloudTreeArchive(historyRecords.map(s=>({date:submissionDate(s),value:s})),s=>'', '暂无答题记录', '次',arr=>{
   const byArticle=new Map();for(const s of arr){const key=s.assignmentId||s.title||'unknown';if(!byArticle.has(key))byArticle.set(key,[]);byArticle.get(key).push(s)}
   const groups=[...byArticle].map(([key,items])=>{
     items.sort((a,b)=>order(a).localeCompare(order(b)));
     const first=items[0],as=assignments.find(a=>a.cloudId===first.assignmentId);
     const attempts=items.map(s=>{
       const number=s.attemptNo||attemptIndex(s,historyRecords);
       const qs=Array.isArray(s.articleSnapshot?.questions)?s.articleSnapshot.questions:(as?.questions||[]);const detail=qs.map((q,i)=>{
         const chosen=Array.isArray(s.answers)?s.answers[i]:undefined;
         const correct=q.answer;
         const opts=Array.isArray(q.options)?q.options:[];
         const label=n=>Number.isInteger(n)&&n>=0&&n<opts.length?opts[n]:(n===undefined?'未保存':String(n));
         return `<div class="item"><b>${i+1}. ${e(q.q||'题目')}</b><p class="tiny">${s.studentUid===user.uid?'我的选择':'对方选择'}：${e(label(chosen))} ${chosen===correct?'<svg class="rm-inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>':'<svg class="rm-inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 5l14 14"/><path d="M19 5 5 19"/></svg>'}<br>正确答案：${e(label(correct))}</p><p class="tiny muted">${e(q.explanation||'暂无解析')}</p></div>`;
       }).join('');
       const fallback=(s.wrongs||[]).map(w=>`<div class="item tiny"><svg class="rm-inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 5l14 14"/><path d="M19 5 5 19"/></svg> ${e(w.question||'')}<br>${s.studentUid===user.uid?'我的选择':'对方选'} ${e(w.chosen||'')}；正确 ${e(w.correct||'')}<br>${e(w.explanation||'')}</div>`).join('');
       return `<details style="margin:9px 0 0 10px"><summary style="cursor:pointer;padding:10px 4px">第 ${number} 次 · ${e(order(s).slice(11,16)||'时间未知')} · ${Number(s.score)||0}/${Number(s.total)||0}（${Math.round(100*(Number(s.score)||0)/Math.max(1,Number(s.total)||1))}%）</summary><div class="rm-cloud-attempt">${s.studentUid===user.uid?`<button type="button" class="rm-delete" data-delete-submission="${e(s.cloudId)}"><svg class="rm-inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v7"/><path d="M14 11v7"/><path d="M6 7l1 14h10l1-14"/><path d="M9 7V4h6v3"/></svg> 删除</button>`:''}</div><div style="padding:6px 0 12px">${s.articleSnapshot?.passage?'<details class="item"><summary>查看当时的阅读原文</summary><p style="white-space:pre-wrap">'+e(s.articleSnapshot.passage)+'</p></details>':''}${detail||fallback||'<p class="muted tiny">这条旧记录只保存了分数，暂无完整选项详情。</p>'}</div></details>`;
     }).join('');
     return `<details style="margin:8px 0 0 8px"><summary style="cursor:pointer;padding:10px 4px"><b>${e(first.title||as?.title||'阅读')}</b> · ${e(first.day?'Day '+first.day:'未编号')} · ${items.length} 次</summary>${attempts}</details>`;
   }).join('');
   return groups;
 });
}
function showCloud(){const root=document.getElementById('app');if(!root)return;
if(!cfg){root.innerHTML=`<h1><svg class="rm-inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 19h11a4 4 0 0 0 .5-8 6.5 6.5 0 0 0-12.4-1.3A4.7 4.7 0 0 0 7 19z"/></svg> 双人同步</h1><section class="card"><h2>首次配置 Firebase</h2><p>尚未填写 firebase-config.js。请依照压缩包内 README.md 配置 Firebase Auth、Firestore 和安全规则后重新部署。</p><p class="notice">本地阅读、答题、错题和生词仍然正常使用。</p></section>`;return}
root.innerHTML=`<h1><svg class="rm-inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 19h11a4 4 0 0 0 .5-8 6.5 6.5 0 0 0-12.4-1.3A4.7 4.7 0 0 0 7 19z"/></svg> 双人阅读空间</h1><section class="card"><div class="row"><button class="secondary" id="asTeacher">我是出题方</button><button class="secondary" id="asStudent">我是答题方</button></div><p class="muted">当前模式：${role==='teacher'?'出题方':'答题方'}（两个人请使用不同邮箱账号）</p>${user?`<p>已登录：${e(user.email||'')} </p><p class="tiny">账号 ID：<code>${e(user.uid)}</code></p><button class="secondary" id="logout">退出登录</button>`:`<label>邮箱</label><input id="cloudEmail" type="email" autocomplete="email" placeholder="example@mail.com"><label>密码（至少6位）</label><input id="cloudPassword" type="password" autocomplete="current-password"><div class="row" style="margin-top:12px"><button class="primary" id="login">登录</button><button class="secondary" id="signup">注册账号</button></div>`}<p id="cloudMsg" class="tiny muted"></p></section>${!user?'':`<section class="card"><h2><svg class="rm-inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V3"/><path d="m7 8 5-5 5 5"/><path d="M4 16v4h16v-4"/></svg> 发布阅读</h2><p class="muted">你的账号既可以发布也可以答题。请选择本篇文章发送给谁；自己和对方的学习记录分开保存。</p><label>发布对象</label><select id="publishTarget"><option value="partner">仅对象</option><option value="self">仅自己</option><option value="both">我和对象</option></select><label>对方的账号 ID（仅对象或双方时需要）</label><input id="recipient" value="${e(studentUid)}" placeholder="粘贴对象的账号 ID"><p class="tiny muted">点击下方文章的「发布」，按当前选择发送。修改 Day 和日期请前往「管理」。</p><h3>本机文章</h3>${localPublishArchive()}<h3>已发布（${assignments.filter(a=>a.teacherUid===user.uid).length}）</h3>${publishedArchive()}</section><section class="card"><h2><svg class="rm-inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v13"/><path d="m7 11 5 5 5-5"/><path d="M4 17v3h16v-3"/></svg> 我的阅读（${assignments.filter(a=>a.studentUid===user.uid).length}）</h2><p class="tiny muted">发给自己的阅读会出现在这里，答题后上传到自己的云端档案。</p>${receivedArchive()}</section><section class="card"><h2><svg class="rm-inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v5H4z"/><path d="M6 9v11h12V9"/><path d="M10 13h4"/></svg> 我的云端答题档案</h2><p class="tiny muted">待同步：${getPending().filter(p=>p.studentUid===user.uid).length} 条</p><button class="secondary" id="retryCloud">重新上传待同步成绩</button>${cloudHistory(submissions.filter(s=>s.studentUid===user.uid))}</section><section class="card"><h2><svg class="rm-inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v5H4z"/><path d="M6 9v11h12V9"/><path d="M10 13h4"/></svg> 对方答题档案</h2>${cloudHistory(submissions.filter(s=>s.teacherUid===user.uid&&s.studentUid!==user.uid))}</section><section class="card"><h2>我的账号 ID</h2><textarea readonly id="myUid" style="min-height:65px">${e(user.uid)}</textarea><button class="secondary" id="copyUid">复制 ID</button></section>`}`;
const hook=(id,fn)=>{const el=document.getElementById(id);if(el)el.onclick=fn};hook('asTeacher',()=>roleSet('teacher'));hook('asStudent',()=>roleSet('student'));hook('logout',()=>signOut(auth));
const authAction=async create=>{try{const em=document.getElementById('cloudEmail').value.trim(),pw=document.getElementById('cloudPassword').value;await (create?createUserWithEmailAndPassword(auth,em,pw):signInWithEmailAndPassword(auth,em,pw));say('登录成功')}catch(err){say('登录失败：'+err.message)}};hook('login',()=>authAction(false));hook('signup',()=>authAction(true));
hook('retryCloud',async()=>{await flushPending();say('补传检查完成。若仍有待同步记录，请检查网络或 Firebase 规则。')});hook('copyUid',async()=>{try{await navigator.clipboard.writeText(user.uid);say('已复制')}catch{document.getElementById('myUid').select();say('请长按复制文本')}});
root.querySelectorAll('[data-publish]').forEach(btn=>btn.onclick=async()=>{
 const target=document.getElementById('publishTarget').value;
 const uid=document.getElementById('recipient').value.trim();
 if(target!=='self'&&(!/^[A-Za-z0-9]{20,128}$/.test(uid)||uid===user.uid)){
  say('请填写对象正确的账号 ID；如果发给自己，请选择「仅自己」。');return;
 }
 const a=bridge.getArticles().find(x=>x.id===btn.dataset.publish);if(!a)return;
 const targets=target==='self'?[user.uid]:target==='both'?[user.uid,uid]:[uid];
 if(target!=='self'){studentUid=uid;localStorage.setItem('rm_student_uid',uid)}
 let successes=0,errors=[];
 btn.disabled=true;
 try{
  for(const recipientUid of targets){
   try{
    await addDoc(collection(db,'assignments'),{teacherUid:user.uid,studentUid:recipientUid,title:a.title,level:a.level||'阅读',day:Number(a.day)||null,studyDate:a.studyDate||fmt(Date.now()),publishedDate:fmt(Date.now()),passage:a.passage,questions:a.questions,createdAt:serverTimestamp()});
    successes++;
   }catch(err){errors.push(err.message)}
  }
  say(`已发布 ${successes}/${targets.length} 份。`+(errors.length?' 失败原因：'+errors.join('；'):''));
 }finally{btn.disabled=false}
});
root.querySelectorAll('[data-delete-cloud]').forEach(btn=>btn.onclick=()=>deleteAssignment(btn.dataset.deleteCloud));
root.querySelectorAll('[data-delete-submission]').forEach(btn=>btn.onclick=ev=>{ev.preventDefault();ev.stopPropagation();const sub=submissions.find(x=>x.cloudId===btn.dataset.deleteSubmission);if(sub)deleteAttempt(sub.localAttemptId||'',sub.cloudId);else alert('未找到对应云端成绩，请刷新同步后重试。')});
root.querySelectorAll('[data-study]').forEach(btn=>btn.onclick=()=>{const a=assignments.find(a=>a.cloudId===btn.dataset.study);if(a){bridge.upsertCloudArticle(a);bridge.openArticle('cloud-'+a.cloudId)}});
}
async function deleteAssignment(id){const a=assignments.find(x=>x.cloudId===id);if(!user||!a){alert('请先登录并等待云端任务同步完成。');return}if(a.teacherUid!==user.uid){alert('只有发布者才能删除云端任务。若只想移除本机文章，请使用「仅从本机移除」。');return}if(!confirm('确定永久删除「'+a.title+'」发给'+(a.studentUid===user.uid?'自己':'对象')+'的这一份云端任务？联网同步后接收者设备也会移除副本；历史成绩保留。此操作不可撤销。'))return;try{await deleteDoc(doc(db,'assignments',id));bridge.removeCloudArticles([id]);savePending(getPending().filter(x=>x.payload.assignmentId!==id));say('云端任务已删除。双方设备联网同步后会移除对应副本；历史成绩保留。');rerender()}catch(err){alert('删除失败：'+err.message)}}
window.readmateCloud={currentUid:()=>user?.uid||null,isActiveAssignment:id=>!!user&&assignments.some(a=>a.cloudId===id&&a.studentUid===user.uid),deleteAttempt,scheduleBackup,backupNow,restoreBackup,deleteAssignment,render:showCloud,submit:async(article,answers,score,attempt)=>{
 const active=assignments.find(a=>a.cloudId===article.cloudId&&a.studentUid===user?.uid);
  if(!cfg||!user||!active){return 'local'}
 const id=(user.uid+'_'+attempt.id).replace(/[^A-Za-z0-9_-]/g,'_');
 const wrongs=answers.flatMap((v,i)=>v===article.questions[i].answer?[]:[{question:article.questions[i].q,chosen:String.fromCharCode(65+v),correct:String.fromCharCode(65+article.questions[i].answer),explanation:article.questions[i].explanation}]);
 const payload={assignmentId:active.cloudId,teacherUid:active.teacherUid,studentUid:user.uid,title:article.title,day:article.day||null,studyDate:article.studyDate||article.publishedDate||'',score,total:article.questions.length,answers,wrongs,localAttemptId:attempt.id,attemptNo:attempt.attemptNo||1,articleSnapshot:{title:article.title,level:article.level||'',day:article.day||null,studyDate:article.studyDate||'',passage:article.passage,questions:article.questions},clientTime:attempt.time};
 const pending=getPending();if(!pending.some(p=>p.id===id))pending.push({id,attemptId:attempt.id,studentUid:user.uid,payload});savePending(pending);
 await flushPending();
 if(getPending().some(p=>p.id===id)){alert('成绩已保存在本机，等待云端补传。请到「同步」点击重新上传。');return 'pending'}
 return 'synced';
}};
if(cfg){try{const app=initializeApp(cfg);auth=getAuth(app);db=getFirestore(app);onAuthStateChanged(auth,u=>{user=u;setupListeners();if(user){flushPending();scheduleBackup()}})}catch(err){console.error(err)}}

import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth,onAuthStateChanged,createUserWithEmailAndPassword,signInWithEmailAndPassword,signOut} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {getFirestore,collection,addDoc,doc,setDoc,query,where,onSnapshot,serverTimestamp,deleteDoc} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
const cfg=window.READMATE_FIREBASE_CONFIG;
const bridge=window.readmateBridge;
let auth,db,user=null,role=localStorage.getItem('rm_role')||'student',studentUid=localStorage.getItem('rm_student_uid')||'',unsubs=[],assignments=[],submissions=[];
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
     if(item.studentUid!==user.uid)continue;
     if(!assignments.some(a=>a.cloudId===item.payload.assignmentId)){continue}
     try{await setDoc(doc(db,'submissions',item.id),{...item.payload,createdAt:serverTimestamp()});done++}
     catch(err){console.warn('云端补传失败',err);break}
     savePending(getPending().filter(p=>p.id!==item.id));
   }
   if(done)rerender();
 }finally{flushing=false}
}
window.addEventListener('online',()=>flushPending());
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
function publishedArchive(){
 const published=assignments.filter(a=>a.teacherUid===user.uid);
 if(!published.length)return '<p class="muted">暂无已发布文章。</p>';
 const grouped=new Map();
 const publishDate=a=>{
   // Older posts may lack a publication date: use server creation time, never today's date.
   const d=a.publishedDate||(a.createdAt?.seconds?fmt(a.createdAt.seconds*1000):'');
   return /^\d{4}-\d{2}-\d{2}$/.test(d)?d:'日期未知';
 };
 for(const a of published){const d=publishDate(a);if(!grouped.has(d))grouped.set(d,[]);grouped.get(d).push(a)}
 return '<p class="tiny muted">按实际发布日期归档，点击日期查看文章；学习日期与发布日期分别显示。</p>'+[...grouped].sort(([a],[b])=>b.localeCompare(a)).map(([d,items])=>{
   items.sort((a,b)=>{const da=Number(a.day),db=Number(b.day);return Number.isFinite(da)&&Number.isFinite(db)?da-db:String(a.title||'').localeCompare(String(b.title||''))});
   const content=items.map(a=>`<details class="item" style="margin:8px 0 0 8px"><summary style="cursor:pointer;padding:8px 2px"><b>${e(bridge.dayLabel(a))} · ${e(a.title||'无标题阅读')}</b> <span class="tiny muted">${Array.isArray(a.questions)?a.questions.length:0} 题</span></summary><div style="padding:8px 0 4px 10px"><p class="tiny">学习日期：${e(a.studyDate||'未设置')}<br>发布日期：${e(d)}<br>接收者：${a.studentUid===user.uid?'我自己':'对象'}<br>阅读难度：${e(a.level||'未设置')}</p><button class="danger" data-delete-cloud="${e(a.cloudId)}">删除这份云端任务</button></div></details>`).join('');
   return `<details class="item" style="margin-bottom:10px"><summary style="cursor:pointer;padding:5px 0"><b>📅 ${e(d)}</b> <span class="pill">${items.length} 篇文章</span></summary>${content}</details>`;
 }).join('');
}
function studyArchive(list,makeItem,empty){
 if(!list.length)return `<p class="muted">${e(empty)}</p>`;
 const buckets=new Map();
 const validDate=x=>/^\d{4}-\d{2}-\d{2}$/.test(x||'')?x:'日期未设置';
 for(const a of list){const date=validDate(a.studyDate||bridge.assignedDate(a)||'');if(!buckets.has(date))buckets.set(date,[]);buckets.get(date).push(a)}
 const rank=a=>Number.isInteger(Number(a.day))&&Number(a.day)>0?Number(a.day):999999;
 return '<p class="tiny muted">按学习日期归档；点击日期展开文章。未设置日期的文章集中收纳。</p>'+[...buckets].sort((a,b)=>a[0]==='日期未设置'?1:b[0]==='日期未设置'?-1:b[0].localeCompare(a[0])).map(([date,items])=>{
   items.sort((a,b)=>rank(a)-rank(b)||String(a.title||'').localeCompare(String(b.title||'')));
   return `<details class="item" style="margin-bottom:10px"><summary style="cursor:pointer;padding:7px 0"><b>📅 ${e(date)}</b> <span class="pill">${items.length} 篇</span></summary>${items.map(makeItem).join('')}</details>`;
 }).join('');
}
function localPublishArchive(){return studyArchive(bridge.getArticles(),a=>`<div class="item row" style="margin:8px 0 0 8px"><span style="flex:1"><b>${e(bridge.dayLabel(a))} · ${e(a.title||'无标题')}</b><div class="small">${e(a.level||'阅读')} · ${Array.isArray(a.questions)?a.questions.length:0} 题</div></span><button class="secondary" data-publish="${e(a.id)}">发布</button></div>`,'请先去「管理」导入题目');}
function receivedArchive(){return studyArchive(assignments.filter(a=>a.studentUid===user.uid),a=>`<div class="item row" style="margin:8px 0 0 8px"><span style="flex:1"><b>${e(bridge.dayLabel(a))} · ${e(a.title||'无标题')}</b><div class="small">${e(a.level||'阅读')} · ${Array.isArray(a.questions)?a.questions.length:0} 题</div></span><button class="secondary" data-study="${e(a.cloudId)}">开始阅读${bridge.isCloudHidden(a.cloudId)?'（恢复本机）':''}</button></div>`,'还没有收到新阅读；发布后保持联网，通常会自动出现。');}
function cloudHistory(historyRecords=submissions){
 if(!historyRecords.length)return '<p class="muted">还没有收到答题记录。</p>';
 const byDate=new Map();
 for(const s of historyRecords){const d=submissionDate(s);if(!byDate.has(d))byDate.set(d,[]);byDate.get(d).push(s)}
 return '<p class="tiny muted">按实际提交日期归档。点击日期 → 文章 → 第几次练习，查看完整记录；旧成绩不会删除。</p>'+[...byDate].sort((a,b)=>b[0].localeCompare(a[0])).map(([d,arr])=>{
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
         return `<div class="item"><b>${i+1}. ${e(q.q||'题目')}</b><p class="tiny">${s.studentUid===user.uid?'我的选择':'对方选择'}：${e(label(chosen))} ${chosen===correct?'✅':'❌'}<br>正确答案：${e(label(correct))}</p><p class="tiny muted">${e(q.explanation||'暂无解析')}</p></div>`;
       }).join('');
       const fallback=(s.wrongs||[]).map(w=>`<div class="item tiny">❌ ${e(w.question||'')}<br>${s.studentUid===user.uid?'我的选择':'对方选'} ${e(w.chosen||'')}；正确 ${e(w.correct||'')}<br>${e(w.explanation||'')}</div>`).join('');
       return `<details style="margin:9px 0 0 10px"><summary style="cursor:pointer;padding:10px 4px">第 ${number} 次 · ${e(order(s).slice(11,16)||'时间未知')} · ${Number(s.score)||0}/${Number(s.total)||0}（${Math.round(100*(Number(s.score)||0)/Math.max(1,Number(s.total)||1))}%）</summary><div style="padding:6px 0 12px">${s.articleSnapshot?.passage?'<details class="item"><summary>查看当时的阅读原文</summary><p style="white-space:pre-wrap">'+e(s.articleSnapshot.passage)+'</p></details>':''}${detail||fallback||'<p class="muted tiny">这条旧记录只保存了分数，暂无完整选项详情。</p>'}</div></details>`;
     }).join('');
     return `<details style="margin:8px 0 0 8px"><summary style="cursor:pointer;padding:10px 4px"><b>${e(first.title||as?.title||'阅读')}</b> · ${e(first.day?'Day '+first.day:'未编号')} · ${items.length} 次</summary>${attempts}</details>`;
   }).join('');
   return `<details class="item" style="margin-bottom:10px"><summary style="cursor:pointer;padding:5px 0"><b>📅 ${e(d)}</b> <span class="pill">${arr.length} 次提交 · ${byArticle.size} 篇</span></summary>${groups}</details>`;
 }).join('');
}
function showCloud(){const root=document.getElementById('app');if(!root)return;
if(!cfg){root.innerHTML=`<h1>☁️ 双人同步</h1><section class="card"><h2>首次配置 Firebase</h2><p>尚未填写 firebase-config.js。请依照压缩包内 README.md 配置 Firebase Auth、Firestore 和安全规则后重新部署。</p><p class="notice">本地阅读、答题、错题和生词仍然正常使用。</p></section>`;return}
root.innerHTML=`<h1>☁️ 双人阅读空间</h1><section class="card"><div class="row"><button class="secondary" id="asTeacher">我是出题方</button><button class="secondary" id="asStudent">我是答题方</button></div><p class="muted">当前模式：${role==='teacher'?'出题方':'答题方'}（两个人请使用不同邮箱账号）</p>${user?`<p>已登录：${e(user.email||'')} </p><p class="tiny">账号 ID：<code>${e(user.uid)}</code></p><button class="secondary" id="logout">退出登录</button>`:`<label>邮箱</label><input id="cloudEmail" type="email" autocomplete="email" placeholder="example@mail.com"><label>密码（至少6位）</label><input id="cloudPassword" type="password" autocomplete="current-password"><div class="row" style="margin-top:12px"><button class="primary" id="login">登录</button><button class="secondary" id="signup">注册账号</button></div>`}<p id="cloudMsg" class="tiny muted"></p></section>${!user?'':`<section class="card"><h2>📤 发布阅读</h2><p class="muted">你的账号既可以发布也可以答题。请选择本篇文章发送给谁；自己和对方的学习记录分开保存。</p><label>发布对象</label><select id="publishTarget"><option value="partner">仅对象</option><option value="self">仅自己</option><option value="both">我和对象</option></select><label>对方的账号 ID（仅对象或双方时需要）</label><input id="recipient" value="${e(studentUid)}" placeholder="粘贴对象的账号 ID"><p class="tiny muted">点击下方文章的「发布」，按当前选择发送。修改 Day 和日期请前往「管理」。</p><h3>本机文章</h3>${localPublishArchive()}<h3>已发布（${assignments.filter(a=>a.teacherUid===user.uid).length}）</h3>${publishedArchive()}</section><section class="card"><h2>📥 我的阅读（${assignments.filter(a=>a.studentUid===user.uid).length}）</h2><p class="tiny muted">发给自己的阅读会出现在这里，答题后上传到自己的云端档案。</p>${receivedArchive()}</section><section class="card"><h2>🗂️ 我的云端答题档案</h2><p class="tiny muted">待同步：${getPending().filter(p=>p.studentUid===user.uid).length} 条</p><button class="secondary" id="retryCloud">重新上传待同步成绩</button>${cloudHistory(submissions.filter(s=>s.studentUid===user.uid))}</section><section class="card"><h2>🗂️ 对方答题档案</h2>${cloudHistory(submissions.filter(s=>s.teacherUid===user.uid&&s.studentUid!==user.uid))}</section><section class="card"><h2>我的账号 ID</h2><textarea readonly id="myUid" style="min-height:65px">${e(user.uid)}</textarea><button class="secondary" id="copyUid">复制 ID</button></section>`}`;
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
root.querySelectorAll('[data-study]').forEach(btn=>btn.onclick=()=>{const a=assignments.find(a=>a.cloudId===btn.dataset.study);if(a){bridge.upsertCloudArticle(a);bridge.openArticle('cloud-'+a.cloudId)}});
}
async function deleteAssignment(id){const a=assignments.find(x=>x.cloudId===id);if(!user||!a){alert('请先登录并等待云端任务同步完成。');return}if(a.teacherUid!==user.uid){alert('只有发布者才能删除云端任务。若只想移除本机文章，请使用「仅从本机移除」。');return}if(!confirm('确定永久删除「'+a.title+'」发给'+(a.studentUid===user.uid?'自己':'对象')+'的这一份云端任务？联网同步后接收者设备也会移除副本；历史成绩保留。此操作不可撤销。'))return;try{await deleteDoc(doc(db,'assignments',id));bridge.removeCloudArticles([id]);savePending(getPending().filter(x=>x.payload.assignmentId!==id));say('云端任务已删除。双方设备联网同步后会移除对应副本；历史成绩保留。');rerender()}catch(err){alert('删除失败：'+err.message)}}
window.readmateCloud={deleteAssignment,render:showCloud,submit:async(article,answers,score,attempt)=>{
 if(!cfg||!user||!article.cloudId||article.studentUid!==user.uid){return 'local'}
 const id=(user.uid+'_'+attempt.id).replace(/[^A-Za-z0-9_-]/g,'_');
 const wrongs=answers.flatMap((v,i)=>v===article.questions[i].answer?[]:[{question:article.questions[i].q,chosen:String.fromCharCode(65+v),correct:String.fromCharCode(65+article.questions[i].answer),explanation:article.questions[i].explanation}]);
 const payload={assignmentId:article.cloudId,teacherUid:article.teacherUid,studentUid:user.uid,title:article.title,day:article.day||null,studyDate:article.studyDate||article.publishedDate||'',score,total:article.questions.length,answers,wrongs,attemptNo:attempt.attemptNo||1,articleSnapshot:{title:article.title,level:article.level||'',day:article.day||null,studyDate:article.studyDate||'',passage:article.passage,questions:article.questions},clientTime:attempt.time};
 const pending=getPending();if(!pending.some(p=>p.id===id))pending.push({id,studentUid:user.uid,payload});savePending(pending);
 await flushPending();
 if(getPending().some(p=>p.id===id)){alert('成绩已保存在本机，等待云端补传。请到「同步」点击重新上传。');return 'pending'}
 return 'synced';
}};
if(cfg){try{const app=initializeApp(cfg);auth=getAuth(app);db=getFirestore(app);onAuthStateChanged(auth,u=>{user=u;setupListeners();if(user)flushPending()})}catch(err){console.error(err)}}

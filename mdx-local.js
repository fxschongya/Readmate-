/* ReadMate local MDict 1.x reader. User-selected dictionaries never leave the device. */
const DB='readmate-local-mdx-v1', STORE='dictionary';
const td=new TextDecoder('utf-8');
const u32=(v,p)=>v.getUint32(p,false);
const wait=()=>new Promise(r=>setTimeout(r,0));
function dbOpen(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function dbGet(){const db=await dbOpen();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly');const q=tx.objectStore(STORE).get('active');q.onsuccess=()=>{db.close();resolve(q.result||null)};q.onerror=()=>{db.close();reject(q.error)}})}
async function dbPut(value){const db=await dbOpen();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(value,'active');tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(tx.error)}})}
async function dbDelete(){const db=await dbOpen();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete('active');tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(tx.error)}})}
async function bytes(file,start,len){return new Uint8Array(await file.slice(start,start+len).arrayBuffer())}
async function decompress(block){const kind=block[0];if(kind===0)return block.slice(8);if(kind!==2)throw Error('此词库使用暂不支持的 LZO 压缩方式');if(!('DecompressionStream'in window))throw Error('当前浏览器不支持解压，请更新 Safari');const stream=new Blob([block.slice(8)]).stream().pipeThrough(new DecompressionStream('deflate'));return new Uint8Array(await new Response(stream).arrayBuffer())}
function cstr(data,offset){let end=offset;while(end<data.length&&data[end]!==0)end++;return [td.decode(data.subarray(offset,end)),end+1]}
function normalized(s){return s.toLowerCase().replace(/[\s\-_.']/g,'')}
let active=null;
export async function status(){if(!active)active=await dbGet();return active?{name:active.name,count:active.keys.length,size:active.file.size}:null}
export async function remove(){await dbDelete();active=null;lookupMap=null;lookupOwner=null}
export async function install(file,onProgress=()=>{}){
 if(!/\.mdx$/i.test(file.name))throw Error('请选择 .mdx 词典文件');
 if(typeof Worker==='undefined')throw Error('当前浏览器不支持后台词典导入');
 const worker=new Worker('./mdx-worker.js?v=491');
 let data;
 try{data=await new Promise((resolve,reject)=>{
  worker.onmessage=e=>{const m=e.data;if(m.type==='progress')onProgress(m.progress);else if(m.type==='done')resolve(m.data);else if(m.type==='error')reject(Error(m.message))};
  worker.onerror=e=>reject(Error('后台解析失败：'+(e.message||'未知错误')));
  worker.postMessage({file});
 })}finally{worker.terminate()}
 // Commit only after full parsing succeeds; previous dictionary remains usable on failure.
 const value={...data,file};onProgress(97);
 try{await dbPut(value)}catch(err){throw Error('本地保存失败（可能是存储空间不足）：'+(err.message||err))}
 active=value;lookupMap=null;lookupOwner=null;onProgress(100);return {name:file.name,count:value.keys.length};
}

let lookupMap=null, lookupOwner=null;
function findKey(d,w){
 if(lookupOwner!==d){lookupMap=new Map();for(let i=0;i<d.keys.length;i++){
  const key=d.keys[i].toLowerCase();if(!lookupMap.has(key))lookupMap.set(key,i);
  const simple=normalized(key);if(!lookupMap.has('~'+simple))lookupMap.set('~'+simple,i);
 }lookupOwner=d}
 return lookupMap.get(w)??lookupMap.get('~'+normalized(w))??-1;
}
async function recordBytes(d,start,end){const chunks=[];let total=0;for(const b of d.records){if(b.rawEnd<=start||b.rawStart>=end)continue;const raw=await decompress(await bytes(d.file,b.start,b.compressed));const part=raw.slice(Math.max(0,start-b.rawStart),Math.min(raw.length,end-b.rawStart));chunks.push(part);total+=part.length}const out=new Uint8Array(total);let pos=0;for(const part of chunks){out.set(part,pos);pos+=part.length}return out}
export async function query(word){const d=active||await dbGet();if(!d)return null;active=d;let i=findKey(d,word.toLowerCase());if(i<0)return null;
 const start=d.offsets[i];let j=i+1;while(j<d.offsets.length&&d.offsets[j]===start)j++;const end=j<d.offsets.length?d.offsets[j]:d.totalBytes;
 if(end<=start||end-start>3000000)throw Error('词条大小异常');
 return {word:d.keys[i],html:td.decode(await recordBytes(d,start,end))};
}

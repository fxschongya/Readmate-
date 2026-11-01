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

async function parse(file,onProgress=()=>{}){
 if(!/\.mdx$/i.test(file.name))throw Error('请选择 .mdx 词典文件');
 const first=await bytes(file,0,4);const headerLen=u32(new DataView(first.buffer),0);if(headerLen>1000000)throw Error('MDX 文件头异常');
 // MDict XML headers use UTF-16LE, not UTF-8.
 const headerText=new TextDecoder('utf-16le').decode(await bytes(file,4,headerLen));
 if(!/RequiredEngineVersion="1\./.test(headerText))throw Error('目前仅支持 MDict 1.x 词典');
 if(!/Encrypted="0"/.test(headerText))throw Error('加密 MDX 暂不支持');
 if(!/Encoding="UTF-8"/i.test(headerText))throw Error('目前仅支持 UTF-8 编码的 MDX');
 const start=4+headerLen+4;const kh=new DataView((await bytes(file,start,16)).buffer);
 const numBlocks=u32(kh,0),numEntries=u32(kh,4),infoSize=u32(kh,8),keySize=u32(kh,12);
 if(numBlocks>100000||numEntries>2000000||infoSize>20000000)throw Error('词库索引异常');
 const info=await bytes(file,start+16,infoSize);let pos=0;const blocks=[];let keyStart=start+16+infoSize;
 for(let i=0;i<numBlocks;i++){
  const dv=new DataView(info.buffer,info.byteOffset+pos);const count=u32(dv,0);pos+=4;
  const a=info[pos++];pos+=a;const b=info[pos++];pos+=b;
  const cv=new DataView(info.buffer,info.byteOffset+pos);const compressed=u32(cv,0),decompressed=u32(cv,4);pos+=8;
  if(!compressed||compressed>file.size||!decompressed||decompressed>100000000)throw Error("词条索引块异常");
  blocks.push({start:keyStart,compressed,decompressed,count});keyStart+=compressed;
 }
 if(pos!==infoSize)throw Error('词库索引布局不兼容');
 const keys=[],offsets=[];let last=-1;
 for(let i=0;i<blocks.length;i++){
  const block=await decompress(await bytes(file,blocks[i].start,blocks[i].compressed));
  let p=0;const view=new DataView(block.buffer,block.byteOffset,block.byteLength);
  for(let j=0;j<blocks[i].count;j++){
   if(p+4>block.length)throw Error('索引数据不完整');const off=u32(view,p);p+=4;
   const [key,next]=cstr(block,p);p=next;keys.push(key);offsets.push(off);if(off<last)throw Error('词条位置异常');last=off;
  }
  if(i%4===0){onProgress(Math.round((i+1)/blocks.length*85));await wait()}
 }
 if(keyStart>file.size)throw Error("索引超出文件范围");
 if(keys.length!==numEntries)throw Error('索引数量不匹配');
 const rhStart=keyStart;const rh=new DataView((await bytes(file,rhStart,16)).buffer);
 const recCount=u32(rh,0),recEntries=u32(rh,4),recInfoSize=u32(rh,8),recSize=u32(rh,12);
 if(recEntries!==numEntries||recCount>100000)throw Error('词条数据布局不兼容');
 if(recInfoSize!==recCount*8||recInfoSize>8000000)throw Error("词条块索引异常");
 const rinfo=await bytes(file,rhStart+16,recInfoSize);const riView=new DataView(rinfo.buffer,rinfo.byteOffset,rinfo.byteLength);
 const records=[];let cursor=rhStart+16+recInfoSize,raw=0;
 for(let i=0;i<recCount;i++){const compressed=u32(riView,i*8),uncompressed=u32(riView,i*8+4);records.push({start:cursor,compressed,rawStart:raw,rawEnd:raw+uncompressed});cursor+=compressed;raw+=uncompressed}
 if(cursor>file.size)throw Error("词条数据超出文件范围");
 onProgress(95);return {name:file.name,keys,offsets,records,totalBytes:raw,installedAt:Date.now()};
}
self.onmessage=async e=>{try{const data=await parse(e.data.file,p=>self.postMessage({type:"progress",progress:p}));self.postMessage({type:"done",data})}catch(err){self.postMessage({type:"error",message:err.message||String(err)})}};

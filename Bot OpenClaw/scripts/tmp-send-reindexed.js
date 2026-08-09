'use strict';
const fs=require('node:fs'); const cp=require('node:child_process');
const root='F:\\Hình Ảnh\\anhYoutube\\Seomichill';
const items=[['0001','Velvet Afterglow'],['0002','Borrowed Flash'],['0003','TANGLED SIDE B']];
const sender='C:\\Bot Discord\\Bot OpenClaw\\scripts\\send-discord-message.js';
const out=[];
for(const [id,title] of items){for(const kind of ['background','playlist']){
 const req={channel:'1533105740145758248',content:`${id} — ${title} — ${kind==='background'?'Background':'Playlist'}`,files:[`${root}\\${id} — ${title} (${kind}).png`]};
 const rp=`C:\\Users\\songt\\.openclaw\\workspace\\tmp\\send-${id}-${kind}.json`; fs.writeFileSync(rp,JSON.stringify(req),'utf8');
 const s=cp.execFileSync('node',[sender,'--request',rp],{encoding:'utf8'}); const j=JSON.parse(s); out.push(j); if(!j.ok) throw new Error(s);
}}
fs.writeFileSync('C:\\Users\\songt\\.openclaw\\workspace\\tmp\\reindexed-delivery.json',JSON.stringify(out,null,2),'utf8');
console.log(JSON.stringify(out.map(x=>({ok:x.ok,messageId:x.messageId,channelId:x.channelId})),null,2));

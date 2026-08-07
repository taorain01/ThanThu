'use strict';
const sharp = require('sharp');
(async()=>{
  const f = process.argv[2];
  const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let opaque=0, transl=0, trans=0;
  for(let i=0;i<data.length;i+=4){ const a=data[i+3]; if(a===255)opaque++; else if(a>0)transl++; else trans++; }
  const total=data.length/4;
  console.log(JSON.stringify({file:f,w:info.width,h:info.height,
    opaquePct:(opaque/total*100).toFixed(1), translucent:transl, transparent:trans},null,2));
})();

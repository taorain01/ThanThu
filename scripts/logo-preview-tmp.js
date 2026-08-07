'use strict';
const sharp=require('sharp');
(async()=>{
  const logo="C:\\Users\\songt\\.openclaw\\workspace\\tmp\\namizuko-logo-white.png";
  await sharp({create:{width:400,height:200,channels:3,background:{r:120,g:40,b:108}}}).png()
    .composite([{input:await sharp(logo).resize({width:90,height:90}).png().toBuffer(),left:30,top:50,blend:'over'}])
    .toFile("C:\\Users\\songt\\.openclaw\\workspace\\tmp\\logo-preview-90.png");
  console.log('ok');
})();

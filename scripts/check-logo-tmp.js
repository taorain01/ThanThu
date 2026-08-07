'use strict';
const sharp=require('sharp');
(async()=>{
  const m=await sharp("C:\\Users\\songt\\.openclaw\\workspace\\assets\\channels\\Namizuko\\namizuko-logo-source.png").metadata();
  console.log(JSON.stringify({width:m.width,height:m.height,alpha:typeof m.alpha!=='undefined'},null,2));
})();

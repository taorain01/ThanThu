'use strict';
// Đặt logo ở góc TRÁI (custom left) thay vì center, 3.5% chiều rộng, nhuộm màu từ vùng logo thật.
// Reuse logic từ apply-channel-logo.js nhưng cho phép nhập vị trí góc.
const path = require('node:path');
const sharp = require('sharp');

const LOGO_ALPHA_GAMMA = 0.65;
const MAX_SHADOW_ALPHA = 130;

async function regionColor(inputPath, region, sample=16){
  const { data } = await sharp(inputPath).ensureAlpha().extract(region)
    .resize({ width: sample, height: sample, fit: 'fill' }).raw().toBuffer({resolveWithObject:true});
  let r=0,g=0,b=0,w=0;
  for(let i=0;i<data.length;i+=4){const a=data[i+3]; if(a===0)continue; r+=data[i]*a; g+=data[i+1]*a; b+=data[i+2]*a; w+=a;}
  if(w===0) return {r:255,g:255,b:255};
  return {r:Math.round(r/w),g:Math.round(g/w),b:Math.round(b/w)};
}
function lum({r,g,b}){ return (0.2126*r+0.7152*g+0.0722*b)/255; }
function relLum({r,g,b}){ const lin=c=>{const s=c/255; return s<=0.03928? s/12.92: ((s+0.055)/1.055)**2.4;}; return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b); }
function contrast(a,b){ const la=relLum(a), lb=relLum(b); return (Math.max(la,lb)+0.05)/(Math.min(la,lb)+0.05); }
function darken(c,f){ return {r:Math.round(c.r*f),g:Math.round(c.g*f),b:Math.round(c.b*f)}; }
function hex(c){ const h=v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0'); return `#${h(c.r)}${h(c.g)}${h(c.b)}`; }

async function buildLogo(logoPath, width, height){
  const { data, info } = await sharp(logoPath).ensureAlpha().resize({width,height,fit:'fill'}).raw().toBuffer({resolveWithObject:true});
  for(let i=0;i<data.length;i+=4){ const a=data[i+3]; if(a===0||a===255)continue; data[i+3]=Math.min(255,Math.round(255*(a/255)**LOGO_ALPHA_GAMMA)); }
  return sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();
}
async function buildShadow(logoBuffer, canvasW, canvasH, strength){
  const blur=Math.max(1.2, canvasW/2000*strength);
  const { data, info } = await sharp(logoBuffer).ensureAlpha().blur(blur).raw().toBuffer({resolveWithObject:true});
  const alphaScale=1+strength*0.5;
  for(let i=0;i<data.length;i+=4){ data[i]=0;data[i+1]=0;data[i+2]=0; data[i+3]=Math.min(MAX_SHADOW_ALPHA,Math.round(data[i+3]*alphaScale)); }
  return sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();
}

(async ()=>{
  const [,, input, logo, output, widthPct, leftPct, topPct, shadowStr, dry] = process.argv;
  const widthPercent=Number(widthPct||3.5), leftPercent=Number(leftPct||3), topPercent=Number(topPct||3), strength=Number(shadowStr||2);
  const im=await sharp(input).metadata(); const lm=await sharp(logo).metadata();
  const width=Math.max(1,Math.round(im.width*widthPercent/100));
  const height=Math.max(1,Math.round(width*lm.height/lm.width));
  const left=Math.max(0,Math.round(im.width*leftPercent/100));
  const top=Math.max(0,Math.round(im.height*topPercent/100));
  if(left+width>im.width||top+height>im.height) throw new Error('out of bounds');

  const zoneW=Math.min(im.width, width*4), zoneH=Math.min(im.height, height*3);
  const zoneLeft=Math.max(0,left), zoneTop=Math.max(0,top);
  const zoneColor=await regionColor(input, {left:zoneLeft,top:zoneTop,width:zoneW,height:zoneH});

  // Auto màu: nền tối -> trắng; nền sáng -> tối hóa màu chủ đạo đủ contrast
  let target, reason;
  const l=Math.max(lum(zoneColor), lum({r:contrast({r:255,g:255,b:255},zoneColor)>2.5?255:zoneColor.r,g:0,b:0}));
  if(lum(zoneColor)<0.45){ target={r:255,g:255,b:255}; reason=`nền tối (lum ${lum(zoneColor).toFixed(2)}) -> trắng`; }
  else {
    let c=darken(zoneColor,0.55); if(contrast(c,zoneColor)<3)c=darken(zoneColor,0.35);
    if(contrast(c,zoneColor)<3){ c={r:0,g:0,b:0}; reason=`nền sáng -> fallback đen`; } else reason=`nền sáng -> tối hóa ${hex(c)}`;
    target=c;
  }
  const estContrast=contrast({r:255,g:255,b:255},zoneColor);

  console.log(JSON.stringify({plan:{input,logo,output,width,height,left,top,widthPercent,leftPercent,topPercent,shadowStrength:strength,zoneColor:hex(zoneColor),targetColor:hex(target),reason,estimateContrast:estContrast.toFixed(2)},dryRun:Boolean(dry)},null,2));

  if(dry) return;
  const logoBuf = await buildLogo(logo,width,height);
  // nhuộm màu target
  const { data, info } = await sharp(logoBuf).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(let i=0;i<data.length;i+=4){ if(data[i+3]===0)continue; data[i]=target.r; data[i+1]=target.g; data[i+2]=target.b; }
  const colored = await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();
  const shadow = await buildShadow(colored, im.width, im.height, strength);
  const offset=Math.max(1,Math.round(height/40*strength));
  await sharp(input).composite([
    {input:shadow,left,top:Math.min(im.height-height, top+offset),blend:'over'},
    {input:colored,left,top,blend:'over'}
  ]).png().toFile(output);
  console.log(JSON.stringify({ok:true,output,width,height,left,top,targetColor:hex(target),reason},null,2));
})().catch(e=>{console.error(JSON.stringify({ok:false,message:e.message}));process.exit(1);});

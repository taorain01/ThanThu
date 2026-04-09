// Xoá nền trắng khỏi các icon, giữ transparency
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const DIR = path.join(__dirname, 'web', 'anh', 'icons');

async function removeWhiteBg(filePath) {
    const { data, info } = await sharp(filePath)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const pixels = Buffer.from(data);
    // Quét từng pixel, nếu gần trắng (R>240, G>240, B>240) → alpha = 0
    for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i], g = pixels[i+1], b = pixels[i+2];
        if (r > 235 && g > 235 && b > 235) {
            pixels[i+3] = 0; // Set alpha = 0 (trong suốt)
        }
    }

    await sharp(pixels, { raw: { width: info.width, height: info.height, channels: 4 } })
        .png()
        .toFile(filePath + '.tmp');

    fs.renameSync(filePath + '.tmp', filePath);
    const stat = fs.statSync(filePath);
    console.log(`✅ ${path.basename(filePath)} → ${(stat.size/1024).toFixed(1)}KB (đã xoá nền)`);
}

async function main() {
    const files = fs.readdirSync(DIR).filter(f => f.endsWith('.png'));
    for (const f of files) {
        await removeWhiteBg(path.join(DIR, f));
    }
    console.log('\n📁 Hoàn tất xoá nền tất cả icon!');
}

main().catch(console.error);

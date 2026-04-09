// Cắt spritesheet icon all.png thành 9 icon riêng lẻ
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SRC = path.join(__dirname, 'anh', 'icon all.png');
const OUT = path.join(__dirname, 'web', 'anh', 'icons');

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const NAMES = [
    ['sun_boss', 'tower_blue', 'tower_red'],
    ['tree_blue', 'tree_red', 'goose_blue'],
    ['goose_red', 'dot_red', 'dot_red2']
];

async function main() {
    const meta = await sharp(SRC).metadata();
    console.log(`Ảnh gốc: ${meta.width}x${meta.height}`);

    const cols = 3, rows = 3;
    const cellW = Math.floor(meta.width / cols);
    const cellH = Math.floor(meta.height / rows);
    console.log(`Mỗi ô: ${cellW}x${cellH}`);

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const name = NAMES[r][c];
            const outFile = path.join(OUT, `${name}.png`);
            // Cắt từng ô, resize nhỏ lại cho web (200x200)
            await sharp(SRC)
                .extract({
                    left: c * cellW,
                    top: r * cellH,
                    width: cellW,
                    height: cellH
                })
                .resize(200, 200, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .png()
                .toFile(outFile);

            const stat = fs.statSync(outFile);
            console.log(`✅ ${name}.png → ${(stat.size / 1024).toFixed(1)}KB`);
        }
    }
    console.log(`\n📁 Tất cả icon đã lưu tại: ${OUT}`);
}

main().catch(console.error);

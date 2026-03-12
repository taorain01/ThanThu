/**
 * Test Tier 2: Bang Chủ/PBC - Gradient Border + Crown Badge
 * Chạy: node test_tier2.js
 */

const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const GIFEncoder = require('gif-encoder-2');

const WIDTH = 600;
const HEIGHT = 120;
const FRAMES = 24;
const DELAY = 70;

async function createTier2Card() {
    console.log('👑 Bắt đầu tạo Tier 2 (Bang Chủ) GIF...');
    const startTime = Date.now();

    const encoder = new GIFEncoder(WIDTH, HEIGHT);
    encoder.setDelay(DELAY);
    encoder.setRepeat(0);

    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    encoder.start();

    for (let frame = 0; frame < FRAMES; frame++) {
        // === BACKGROUND ===
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        // === CARD BACKGROUND ===
        ctx.fillStyle = '#2d2d44';
        ctx.fillRect(10, 10, WIDTH - 20, HEIGHT - 20);

        // === ROTATING GRADIENT BORDER (Tier 2 effect) ===
        const angle = (frame / FRAMES) * Math.PI * 2;
        const x1 = WIDTH / 2 + Math.cos(angle) * WIDTH / 2;
        const y1 = HEIGHT / 2 + Math.sin(angle) * HEIGHT / 2;
        const x2 = WIDTH / 2 + Math.cos(angle + Math.PI) * WIDTH / 2;
        const y2 = HEIGHT / 2 + Math.sin(angle + Math.PI) * HEIGHT / 2;

        const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
        gradient.addColorStop(0, '#FFD700');   // Gold
        gradient.addColorStop(0.5, '#FFA500'); // Orange
        gradient.addColorStop(1, '#FFD700');   // Gold

        ctx.strokeStyle = gradient;
        ctx.lineWidth = 4;
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#FFD700';
        ctx.strokeRect(8, 8, WIDTH - 16, HEIGHT - 16);
        ctx.shadowBlur = 0;

        // === AVATAR với crown ===
        ctx.fillStyle = '#FFD700';
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#FFA500';
        ctx.beginPath();
        ctx.arc(60, 60, 35, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Crown trên avatar
        ctx.font = '18px Arial';
        ctx.fillText('👑', 48, 35);

        // === TEXT ===
        ctx.font = 'bold 22px Arial';
        ctx.fillStyle = '#FFD700';
        ctx.shadowBlur = 3;
        ctx.shadowColor = '#FFA500';
        ctx.fillText('👑 Bang Chủ / Phó Bang', 120, 40);
        ctx.shadowBlur = 0;

        ctx.font = '14px Arial';
        ctx.fillStyle = '#FFA500';
        ctx.fillText('Tier 2: Rotating Gradient + Crown', 120, 62);
        ctx.fillText('Leadership recognition', 120, 80);

        // === ICON ===
        ctx.font = '28px Arial';
        ctx.fillText('⚔️', WIDTH - 55, 65);

        encoder.addFrame(ctx);
        process.stdout.write(`\r⏳ Frame ${frame + 1}/${FRAMES}`);
    }

    encoder.finish();

    const outputPath = path.join(__dirname, 'test_tier2_card.gif');
    const buffer = encoder.out.getData();
    fs.writeFileSync(outputPath, buffer);

    const endTime = Date.now();
    console.log(`\n✅ Tier 2 GIF: ${(buffer.length / 1024).toFixed(1)} KB, ${((endTime - startTime) / 1000).toFixed(2)}s`);
}

createTier2Card().catch(console.error);

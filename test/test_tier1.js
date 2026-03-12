/**
 * Test Tier 1: Kỳ Cựu - Simple Glow Border
 * Chạy: node test_tier1.js
 */

const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const GIFEncoder = require('gif-encoder-2');

const WIDTH = 600;
const HEIGHT = 120;
const FRAMES = 20;
const DELAY = 80;

async function createTier1Card() {
    console.log('💜 Bắt đầu tạo Tier 1 (Kỳ Cựu) GIF...');
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

        // === PULSING GLOW BORDER (Tier 1 effect) ===
        const pulseIntensity = 0.4 + Math.sin(frame * 0.4) * 0.3; // 0.1 -> 0.7
        const glowBlur = 8 + Math.sin(frame * 0.4) * 4; // 4 -> 12

        ctx.strokeStyle = '#9B59B6'; // Tím Kỳ Cựu
        ctx.lineWidth = 3;
        ctx.shadowBlur = glowBlur;
        ctx.shadowColor = `rgba(155, 89, 182, ${pulseIntensity})`;
        ctx.strokeRect(10, 10, WIDTH - 20, HEIGHT - 20);
        ctx.shadowBlur = 0;

        // === AVATAR ===
        ctx.fillStyle = '#9B59B6';
        ctx.shadowBlur = 8;
        ctx.shadowColor = '#9B59B6';
        ctx.beginPath();
        ctx.arc(60, 60, 35, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // === TEXT ===
        ctx.font = 'bold 22px Arial';
        ctx.fillStyle = '#ffffff';
        ctx.fillText('💜 Thành Viên Kỳ Cựu', 120, 40);

        ctx.font = '14px Arial';
        ctx.fillStyle = '#9B59B6';
        ctx.fillText('Tier 1: Pulsing Glow Border', 120, 62);
        ctx.fillText('Simple but elegant effect', 120, 80);

        // === ICON ===
        ctx.font = '28px Arial';
        ctx.fillText('🏆', WIDTH - 55, 65);

        encoder.addFrame(ctx);
        process.stdout.write(`\r⏳ Frame ${frame + 1}/${FRAMES}`);
    }

    encoder.finish();

    const outputPath = path.join(__dirname, 'test_tier1_card.gif');
    const buffer = encoder.out.getData();
    fs.writeFileSync(outputPath, buffer);

    const endTime = Date.now();
    console.log(`\n✅ Tier 1 GIF: ${(buffer.length / 1024).toFixed(1)} KB, ${((endTime - startTime) / 1000).toFixed(2)}s`);
}

createTier1Card().catch(console.error);

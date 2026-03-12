/**
 * Test GIF Animation cho Member Card
 * Chạy: node test_gif.js
 */

const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

// Sẽ cần cài: npm install gif-encoder-2
let GIFEncoder;
try {
    GIFEncoder = require('gif-encoder-2');
} catch (e) {
    console.log('❌ Chưa cài gif-encoder-2!');
    console.log('📦 Chạy: npm install gif-encoder-2');
    process.exit(1);
}

const WIDTH = 600;
const HEIGHT = 100;
const FRAMES = 20; // Số frame
const DELAY = 50;  // ms giữa các frame

async function createAnimatedCard() {
    console.log('🎬 Bắt đầu tạo GIF...');
    const startTime = Date.now();

    // Tạo encoder
    const encoder = new GIFEncoder(WIDTH, HEIGHT);
    encoder.setDelay(DELAY);
    encoder.setRepeat(0); // 0 = loop forever

    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    // Bắt đầu encoding
    encoder.start();

    // Tạo từng frame
    for (let i = 0; i < FRAMES; i++) {
        // Clear canvas
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        // === ANIMATED BORDER GLOW ===
        const hue = (i * 18) % 360; // Rainbow effect
        const glowColor = `hsl(${hue}, 100%, 50%)`;

        ctx.strokeStyle = glowColor;
        ctx.lineWidth = 4;
        ctx.shadowBlur = 15 + Math.sin(i * 0.5) * 5; // Pulsing glow
        ctx.shadowColor = glowColor;

        // Vẽ border
        ctx.strokeRect(4, 4, WIDTH - 8, HEIGHT - 8);

        // === SPARKLES ===
        ctx.shadowBlur = 0;
        for (let s = 0; s < 10; s++) {
            const x = (Math.sin(i * 0.3 + s * 0.7) * 0.5 + 0.5) * WIDTH;
            const y = (Math.cos(i * 0.2 + s * 1.1) * 0.5 + 0.5) * HEIGHT;
            const size = 2 + Math.sin(i * 0.5 + s) * 1;
            const alpha = 0.3 + Math.sin(i * 0.3 + s * 0.5) * 0.3;

            ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
        }

        // === TEXT ===
        ctx.font = 'bold 24px Arial';
        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = 5;
        ctx.shadowColor = glowColor;
        ctx.fillText('✨ Legendary Card Demo', 120, 40);

        ctx.font = '16px Arial';
        ctx.fillStyle = '#aaaaaa';
        ctx.shadowBlur = 0;
        ctx.fillText(`Frame ${i + 1}/${FRAMES} - Rainbow Effect`, 120, 65);

        // === ICON giả ===
        ctx.fillStyle = glowColor;
        ctx.beginPath();
        ctx.arc(50, 50, 30, 0, Math.PI * 2);
        ctx.fill();

        // Thêm frame vào GIF
        encoder.addFrame(ctx);

        process.stdout.write(`\r⏳ Frame ${i + 1}/${FRAMES}`);
    }

    // Kết thúc
    encoder.finish();

    // Lưu file
    const outputPath = path.join(__dirname, 'test_animated_card.gif');
    const buffer = encoder.out.getData();
    fs.writeFileSync(outputPath, buffer);

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    const fileSize = (buffer.length / 1024).toFixed(1);

    console.log(`\n\n✅ Đã tạo GIF thành công!`);
    console.log(`📁 File: ${outputPath}`);
    console.log(`📊 Size: ${fileSize} KB`);
    console.log(`⏱️ Thời gian: ${duration}s`);
    console.log(`🎞️ Frames: ${FRAMES}`);
}

createAnimatedCard().catch(console.error);

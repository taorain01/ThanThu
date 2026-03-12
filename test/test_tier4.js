/**
 * Test Tier 4: Sự Kiện Tết - Hoa Đào Rơi
 * Chạy: node test_tier4.js
 */

const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const GIFEncoder = require('gif-encoder-2');

const WIDTH = 600;
const HEIGHT = 120;
const FRAMES = 30;
const DELAY = 80;

// Sakura petal class
class SakuraPetal {
    constructor() {
        this.reset();
    }

    reset() {
        this.x = Math.random() * WIDTH;
        this.y = -10 - Math.random() * 50;
        this.size = Math.random() * 6 + 4;
        this.speedY = Math.random() * 1.5 + 0.5;
        this.speedX = Math.random() * 0.8 - 0.4;
        this.rotation = Math.random() * Math.PI * 2;
        this.rotationSpeed = (Math.random() - 0.5) * 0.1;
        this.alpha = Math.random() * 0.5 + 0.5;
        this.color = Math.random() > 0.5 ? '#FFB7C5' : '#FF69B4';
    }

    update() {
        this.y += this.speedY;
        this.x += this.speedX + Math.sin(this.y * 0.02) * 0.3;
        this.rotation += this.rotationSpeed;
        if (this.y > HEIGHT + 10) this.reset();
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);
        ctx.globalAlpha = this.alpha;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, this.size, this.size * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FFE4E1';
        ctx.beginPath();
        ctx.arc(0, 0, this.size * 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

async function createTier4Card() {
    console.log('🌸 Bắt đầu tạo Tier 4 (Tết/Sakura) GIF...');
    const startTime = Date.now();

    const encoder = new GIFEncoder(WIDTH, HEIGHT);
    encoder.setDelay(DELAY);
    encoder.setRepeat(0);

    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    const petals = [];
    for (let i = 0; i < 25; i++) {
        const petal = new SakuraPetal();
        petal.y = Math.random() * HEIGHT;
        petals.push(petal);
    }

    encoder.start();

    for (let frame = 0; frame < FRAMES; frame++) {
        // Background gradient Tết
        const bgGradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
        bgGradient.addColorStop(0, '#2d1b4e');
        bgGradient.addColorStop(1, '#4a1942');
        ctx.fillStyle = bgGradient;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.fillRect(10, 10, WIDTH - 20, HEIGHT - 20);

        // Tết border (đỏ vàng)
        const borderGradient = ctx.createLinearGradient(0, 0, WIDTH, 0);
        borderGradient.addColorStop(0, '#FFD700');
        borderGradient.addColorStop(0.5, '#DC143C');
        borderGradient.addColorStop(1, '#FFD700');

        ctx.strokeStyle = borderGradient;
        ctx.lineWidth = 4;
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#FF6B6B';
        ctx.strokeRect(8, 8, WIDTH - 16, HEIGHT - 16);
        ctx.shadowBlur = 0;

        // Corner decorations
        ctx.font = '18px Arial';
        ctx.fillText('🏮', 15, 28);
        ctx.fillText('🏮', WIDTH - 32, 28);
        ctx.fillText('🧧', 15, HEIGHT - 12);
        ctx.fillText('🧧', WIDTH - 32, HEIGHT - 12);

        // Hoa đào
        for (const petal of petals) {
            petal.update();
            petal.draw(ctx);
        }

        // Avatar
        ctx.fillStyle = '#FF69B4';
        ctx.shadowBlur = 8;
        ctx.shadowColor = '#FFB7C5';
        ctx.beginPath();
        ctx.arc(60, 60, 35, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Text
        ctx.font = 'bold 22px Arial';
        ctx.fillStyle = '#FFD700';
        ctx.shadowBlur = 3;
        ctx.shadowColor = '#FF6B6B';
        ctx.fillText('🌸 Sự Kiện Tết 2026', 120, 40);
        ctx.shadowBlur = 0;

        ctx.font = '14px Arial';
        ctx.fillStyle = '#FFB7C5';
        ctx.fillText('Tier 4: Sakura Particles + Theme', 120, 62);
        ctx.fillText('Chúc Mừng Năm Mới! 🎊', 120, 80);

        ctx.font = '28px Arial';
        ctx.fillText('🐍', WIDTH - 55, 65);

        encoder.addFrame(ctx);
        process.stdout.write(`\r⏳ Frame ${frame + 1}/${FRAMES}`);
    }

    encoder.finish();

    const outputPath = path.join(__dirname, 'test_tier4_card.gif');
    const buffer = encoder.out.getData();
    fs.writeFileSync(outputPath, buffer);

    const endTime = Date.now();
    console.log(`\n✅ Tier 4 GIF: ${(buffer.length / 1024).toFixed(1)} KB, ${((endTime - startTime) / 1000).toFixed(2)}s`);
}

createTier4Card().catch(console.error);

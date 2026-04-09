/**
 * Test Fire Effect GIF cho Member Card
 * Chạy: node test_fire.js
 */

const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const GIFEncoder = require('gif-encoder-2');

const WIDTH = 600;
const HEIGHT = 120;
const FRAMES = 25;
const DELAY = 60;

// Fire particles system
class FireParticle {
    constructor(x, baseY) {
        this.reset(x, baseY);
    }

    reset(x, baseY) {
        this.x = x + (Math.random() - 0.5) * 20;
        this.y = baseY;
        this.baseY = baseY;
        this.size = Math.random() * 8 + 4;
        this.speedY = Math.random() * 2 + 1;
        this.speedX = (Math.random() - 0.5) * 1;
        this.life = 1;
        this.decay = Math.random() * 0.03 + 0.02;
    }

    update() {
        this.y -= this.speedY;
        this.x += this.speedX;
        this.life -= this.decay;
        this.size *= 0.98;

        if (this.life <= 0) {
            this.reset(this.x, this.baseY);
        }
    }

    draw(ctx) {
        if (this.life <= 0) return;

        // Màu lửa: vàng -> cam -> đỏ theo life
        const r = 255;
        const g = Math.floor(200 * this.life);
        const b = 0;
        const alpha = this.life * 0.8;

        // Glow
        ctx.shadowBlur = 10;
        ctx.shadowColor = `rgba(255, 100, 0, ${alpha})`;

        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size * this.life, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;
    }
}

async function createFireCard() {
    console.log('🔥 Bắt đầu tạo Fire Effect GIF...');
    const startTime = Date.now();

    const encoder = new GIFEncoder(WIDTH, HEIGHT);
    encoder.setDelay(DELAY);
    encoder.setRepeat(0);

    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    // Tạo particles cho viền dưới và 2 bên
    const particles = [];

    // Viền dưới
    for (let x = 0; x < WIDTH; x += 15) {
        particles.push(new FireParticle(x, HEIGHT - 5));
    }

    // Viền trái
    for (let y = 30; y < HEIGHT; y += 15) {
        particles.push(new FireParticle(5, y));
    }

    // Viền phải
    for (let y = 30; y < HEIGHT; y += 15) {
        particles.push(new FireParticle(WIDTH - 5, y));
    }

    encoder.start();

    for (let frame = 0; frame < FRAMES; frame++) {
        // Clear với màu tối
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        // Vẽ card background
        ctx.fillStyle = '#2d2d44';
        ctx.fillRect(10, 10, WIDTH - 20, HEIGHT - 20);

        // === FIRE GLOW trên border ===
        const glowIntensity = 0.5 + Math.sin(frame * 0.3) * 0.2;
        ctx.shadowBlur = 20;
        ctx.shadowColor = `rgba(255, 100, 0, ${glowIntensity})`;
        ctx.strokeStyle = '#FF4500';
        ctx.lineWidth = 3;
        ctx.strokeRect(10, 10, WIDTH - 20, HEIGHT - 20);
        ctx.shadowBlur = 0;

        // === UPDATE & VẼ PARTICLES ===
        for (const p of particles) {
            p.update();
            p.draw(ctx);
        }

        // === CONTENT ===
        // Avatar placeholder
        ctx.fillStyle = '#FF6347';
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#FF4500';
        ctx.beginPath();
        ctx.arc(60, 60, 35, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Text
        ctx.font = 'bold 22px Arial';
        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = 3;
        ctx.shadowColor = '#FF4500';
        ctx.fillText('🔥 Legendary Fire Card', 120, 45);

        ctx.font = '14px Arial';
        ctx.fillStyle = '#ffaa88';
        ctx.shadowBlur = 0;
        ctx.fillText('Fire effect demo - Border particles', 120, 70);

        // Icon
        ctx.font = '28px Arial';
        ctx.fillText('🏆', WIDTH - 50, 70);

        encoder.addFrame(ctx);
        process.stdout.write(`\r⏳ Frame ${frame + 1}/${FRAMES}`);
    }

    encoder.finish();

    const outputPath = path.join(__dirname, 'test_fire_card.gif');
    const buffer = encoder.out.getData();
    fs.writeFileSync(outputPath, buffer);

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    const fileSize = (buffer.length / 1024).toFixed(1);

    console.log(`\n\n✅ Đã tạo Fire GIF thành công!`);
    console.log(`📁 File: ${outputPath}`);
    console.log(`📊 Size: ${fileSize} KB`);
    console.log(`⏱️ Thời gian: ${duration}s`);
    console.log(`🎞️ Frames: ${FRAMES}`);
}

createFireCard().catch(console.error);

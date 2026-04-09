/**
 * Test Tier 3: VIP/Sponsor - Sparkles + Premium Frame
 * Chạy: node test_vip.js
 */

const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const GIFEncoder = require('gif-encoder-2');

const WIDTH = 600;
const HEIGHT = 120;
const FRAMES = 24;
const DELAY = 70;

// Sparkle particle
class Sparkle {
    constructor() {
        this.reset();
    }

    reset() {
        this.x = Math.random() * WIDTH;
        this.y = Math.random() * HEIGHT;
        this.size = Math.random() * 3 + 1;
        this.maxSize = this.size;
        this.alpha = 0;
        this.growing = true;
        this.speed = Math.random() * 0.1 + 0.05;
    }

    update() {
        if (this.growing) {
            this.alpha += this.speed;
            if (this.alpha >= 1) {
                this.growing = false;
            }
        } else {
            this.alpha -= this.speed;
            if (this.alpha <= 0) {
                this.reset();
            }
        }
    }

    draw(ctx) {
        if (this.alpha <= 0) return;

        ctx.save();
        ctx.globalAlpha = this.alpha;

        // Sparkle star shape
        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = 8;
        ctx.shadowColor = '#FFD700';

        // Vẽ hình sao 4 cánh
        ctx.beginPath();
        const spikes = 4;
        const outerRadius = this.size * 2;
        const innerRadius = this.size * 0.5;

        for (let i = 0; i < spikes * 2; i++) {
            const radius = i % 2 === 0 ? outerRadius : innerRadius;
            const angle = (i * Math.PI) / spikes - Math.PI / 2;
            const x = this.x + Math.cos(angle) * radius;
            const y = this.y + Math.sin(angle) * radius;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.closePath();
        ctx.fill();

        ctx.restore();
    }
}

async function createVIPCard() {
    console.log('✨ Bắt đầu tạo VIP Sparkles Effect GIF...');
    const startTime = Date.now();

    const encoder = new GIFEncoder(WIDTH, HEIGHT);
    encoder.setDelay(DELAY);
    encoder.setRepeat(0);

    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    // Tạo sparkles
    const sparkles = [];
    for (let i = 0; i < 30; i++) {
        const sparkle = new Sparkle();
        sparkle.alpha = Math.random(); // Phân bố ngẫu nhiên
        sparkle.growing = Math.random() > 0.5;
        sparkles.push(sparkle);
    }

    encoder.start();

    for (let frame = 0; frame < FRAMES; frame++) {
        // === BACKGROUND gradient premium ===
        const bgGradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
        bgGradient.addColorStop(0, '#1a1a2e');
        bgGradient.addColorStop(0.5, '#16213e');
        bgGradient.addColorStop(1, '#1a1a2e');
        ctx.fillStyle = bgGradient;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        // === PREMIUM GOLD FRAME ===
        // Outer glow
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#FFD700';

        // Double border effect
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 3;
        ctx.strokeRect(6, 6, WIDTH - 12, HEIGHT - 12);

        ctx.strokeStyle = '#FFA500';
        ctx.lineWidth = 1;
        ctx.strokeRect(12, 12, WIDTH - 24, HEIGHT - 24);

        ctx.shadowBlur = 0;

        // === CORNER DIAMONDS ===
        const diamondSize = 8;
        ctx.fillStyle = '#FFD700';

        // Vẽ 4 góc
        const corners = [
            [12, 12], [WIDTH - 12, 12],
            [12, HEIGHT - 12], [WIDTH - 12, HEIGHT - 12]
        ];

        for (const [cx, cy] of corners) {
            ctx.beginPath();
            ctx.moveTo(cx, cy - diamondSize);
            ctx.lineTo(cx + diamondSize, cy);
            ctx.lineTo(cx, cy + diamondSize);
            ctx.lineTo(cx - diamondSize, cy);
            ctx.closePath();
            ctx.fill();
        }

        // === UPDATE & VẼ SPARKLES ===
        for (const sparkle of sparkles) {
            sparkle.update();
            sparkle.draw(ctx);
        }

        // === AVATAR với viền vàng ===
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 3;
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#FFD700';
        ctx.beginPath();
        ctx.arc(60, 60, 38, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#4a4a6a';
        ctx.beginPath();
        ctx.arc(60, 60, 35, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // VIP Badge trên avatar
        ctx.fillStyle = '#FFD700';
        ctx.font = 'bold 12px Arial';
        ctx.fillText('VIP', 47, 65);

        // === TEXT ===
        ctx.font = 'bold 22px Arial';
        ctx.fillStyle = '#FFD700';
        ctx.shadowBlur = 5;
        ctx.shadowColor = '#FFD700';
        ctx.fillText('✨ Premium VIP Member', 120, 40);

        ctx.font = '14px Arial';
        ctx.fillStyle = '#aaaaaa';
        ctx.shadowBlur = 0;
        ctx.fillText('Tier 3: Sparkles + Gold Frame', 120, 62);
        ctx.fillText('Sponsor / Donator Special', 120, 80);

        // === CROWN ICON ===
        ctx.font = '32px Arial';
        ctx.fillText('👑', WIDTH - 55, 65);

        encoder.addFrame(ctx);
        process.stdout.write(`\r⏳ Frame ${frame + 1}/${FRAMES}`);
    }

    encoder.finish();

    const outputPath = path.join(__dirname, 'test_vip_card.gif');
    const buffer = encoder.out.getData();
    fs.writeFileSync(outputPath, buffer);

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    const fileSize = (buffer.length / 1024).toFixed(1);

    console.log(`\n\n✅ Đã tạo VIP GIF thành công!`);
    console.log(`📁 File: ${outputPath}`);
    console.log(`📊 Size: ${fileSize} KB`);
    console.log(`⏱️ Thời gian: ${duration}s`);
    console.log(`🎞️ Frames: ${FRAMES}`);
}

createVIPCard().catch(console.error);

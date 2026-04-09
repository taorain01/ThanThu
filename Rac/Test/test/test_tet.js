/**
 * Test Tier 4: Sự Kiện Tết - Hoa Đào Rơi
 * Chạy: node test_tet.js
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
        // Màu hoa đào: hồng nhạt -> hồng đậm
        this.color = Math.random() > 0.5 ? '#FFB7C5' : '#FF69B4';
    }

    update() {
        this.y += this.speedY;
        this.x += this.speedX + Math.sin(this.y * 0.02) * 0.3; // Lắc nhẹ
        this.rotation += this.rotationSpeed;

        if (this.y > HEIGHT + 10) {
            this.reset();
        }
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);
        ctx.globalAlpha = this.alpha;

        // Vẽ cánh hoa
        ctx.fillStyle = this.color;
        ctx.beginPath();
        // Hình oval đơn giản cho cánh hoa
        ctx.ellipse(0, 0, this.size, this.size * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();

        // Tâm hoa
        ctx.fillStyle = '#FFE4E1';
        ctx.beginPath();
        ctx.arc(0, 0, this.size * 0.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

async function createTetCard() {
    console.log('🌸 Bắt đầu tạo Tết/Sakura Effect GIF...');
    const startTime = Date.now();

    const encoder = new GIFEncoder(WIDTH, HEIGHT);
    encoder.setDelay(DELAY);
    encoder.setRepeat(0);

    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    // Tạo nhiều cánh hoa
    const petals = [];
    for (let i = 0; i < 25; i++) {
        const petal = new SakuraPetal();
        petal.y = Math.random() * HEIGHT; // Phân bố đều ban đầu
        petals.push(petal);
    }

    encoder.start();

    for (let frame = 0; frame < FRAMES; frame++) {
        // === BACKGROUND với gradient Tết ===
        const bgGradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
        bgGradient.addColorStop(0, '#2d1b4e');   // Tím đậm
        bgGradient.addColorStop(1, '#4a1942');   // Đỏ tím
        ctx.fillStyle = bgGradient;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        // === CARD BACKGROUND ===
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.fillRect(10, 10, WIDTH - 20, HEIGHT - 20);

        // === TẾT BORDER (đỏ vàng truyền thống) ===
        const borderGradient = ctx.createLinearGradient(0, 0, WIDTH, 0);
        borderGradient.addColorStop(0, '#FFD700');   // Vàng
        borderGradient.addColorStop(0.5, '#DC143C'); // Đỏ
        borderGradient.addColorStop(1, '#FFD700');   // Vàng

        ctx.strokeStyle = borderGradient;
        ctx.lineWidth = 4;
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#FF6B6B';
        ctx.strokeRect(8, 8, WIDTH - 16, HEIGHT - 16);
        ctx.shadowBlur = 0;

        // === CORNER DECORATIONS (hoa văn góc) ===
        ctx.font = '20px Arial';
        ctx.fillText('🏮', 15, 30);           // Góc trái trên
        ctx.fillText('🏮', WIDTH - 35, 30);   // Góc phải trên
        ctx.fillText('🧧', 15, HEIGHT - 15);  // Góc trái dưới
        ctx.fillText('🧧', WIDTH - 35, HEIGHT - 15); // Góc phải dưới

        // === UPDATE & VẼ HOA ĐÀO ===
        for (const petal of petals) {
            petal.update();
            petal.draw(ctx);
        }

        // === AVATAR ===
        ctx.fillStyle = '#FF69B4';
        ctx.shadowBlur = 8;
        ctx.shadowColor = '#FFB7C5';
        ctx.beginPath();
        ctx.arc(60, 60, 35, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // === TEXT ===
        ctx.font = 'bold 22px Arial';
        ctx.fillStyle = '#FFD700';
        ctx.shadowBlur = 3;
        ctx.shadowColor = '#FF6B6B';
        ctx.fillText('🌸 Sự Kiện Tết 2026', 120, 40);

        ctx.font = '14px Arial';
        ctx.fillStyle = '#FFB7C5';
        ctx.shadowBlur = 0;
        ctx.fillText('Chúc Mừng Năm Mới! 🎊', 120, 62);
        ctx.fillText('Tier 4: Event Special', 120, 80);

        // === ICON ===
        ctx.font = '28px Arial';
        ctx.fillText('🐍', WIDTH - 55, 65); // Năm Tỵ 2025

        encoder.addFrame(ctx);
        process.stdout.write(`\r⏳ Frame ${frame + 1}/${FRAMES}`);
    }

    encoder.finish();

    const outputPath = path.join(__dirname, 'test_tet_card.gif');
    const buffer = encoder.out.getData();
    fs.writeFileSync(outputPath, buffer);

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    const fileSize = (buffer.length / 1024).toFixed(1);

    console.log(`\n\n✅ Đã tạo Tết GIF thành công!`);
    console.log(`📁 File: ${outputPath}`);
    console.log(`📊 Size: ${fileSize} KB`);
    console.log(`⏱️ Thời gian: ${duration}s`);
    console.log(`🎞️ Frames: ${FRAMES}`);
}

createTetCard().catch(console.error);

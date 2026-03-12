/**
 * Welcome Image Generator
 * Tạo ảnh chào mừng thành viên mới với Canvas
 */

const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { AttachmentBuilder } = require('discord.js');
const path = require('path');
const fs = require('fs');

// Config
const CANVAS_WIDTH = 750;
const CANVAS_HEIGHT = 280;
const AVATAR_SIZE = 150;
const AVATAR_BORDER = 8;

// Path to background image (local - không bao giờ hết hạn)
const BG_IMAGE_PATH = path.join(__dirname, '../assets/welcome_bg.png');

/**
 * Tạo ảnh welcome với avatar user
 * @param {GuildMember} member - Discord member
 * @returns {Promise<AttachmentBuilder>} - Attachment để gửi
 */
async function createWelcomeImage(member) {
    const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const ctx = canvas.getContext('2d');

    // === VẼ BACKGROUND ===
    try {
        const bgImage = await loadImage(BG_IMAGE_PATH);
        // Vẽ ảnh nền, scale để fit canvas
        ctx.drawImage(bgImage, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    } catch (e) {
        // Fallback gradient nếu không load được ảnh
        const gradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        gradient.addColorStop(0, '#1a1a2e');
        gradient.addColorStop(0.5, '#16213e');
        gradient.addColorStop(1, '#0f3460');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    // Overlay mờ để text dễ đọc hơn
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // === VẼ AVATAR ===
    const avatarX = 50;
    const avatarY = (CANVAS_HEIGHT - AVATAR_SIZE) / 2;

    // Vòng tròn viền avatar (gradient vàng kim)
    const borderGradient = ctx.createLinearGradient(
        avatarX - AVATAR_BORDER, avatarY - AVATAR_BORDER,
        avatarX + AVATAR_SIZE + AVATAR_BORDER, avatarY + AVATAR_SIZE + AVATAR_BORDER
    );
    borderGradient.addColorStop(0, '#ffd700');
    borderGradient.addColorStop(0.5, '#ffec8b');
    borderGradient.addColorStop(1, '#daa520');

    ctx.beginPath();
    ctx.arc(
        avatarX + AVATAR_SIZE / 2,
        avatarY + AVATAR_SIZE / 2,
        AVATAR_SIZE / 2 + AVATAR_BORDER,
        0, Math.PI * 2
    );
    ctx.fillStyle = borderGradient;
    ctx.fill();

    // Load và vẽ avatar
    try {
        const avatarURL = member.user.displayAvatarURL({ extension: 'png', size: 256 });
        const avatar = await loadImage(avatarURL);

        // Clip thành hình tròn
        ctx.save();
        ctx.beginPath();
        ctx.arc(
            avatarX + AVATAR_SIZE / 2,
            avatarY + AVATAR_SIZE / 2,
            AVATAR_SIZE / 2,
            0, Math.PI * 2
        );
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatar, avatarX, avatarY, AVATAR_SIZE, AVATAR_SIZE);
        ctx.restore();
    } catch (e) {
        // Fallback: vẽ vòng tròn xám nếu không load được avatar
        ctx.beginPath();
        ctx.arc(avatarX + AVATAR_SIZE / 2, avatarY + AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2);
        ctx.fillStyle = '#333';
        ctx.fill();
    }

    // === VẼ TEXT ===
    const textX = avatarX + AVATAR_SIZE + 35;
    const textY = CANVAS_HEIGHT / 2;

    // Shadow cho text
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    // "CHÀO HIỆP KHÁCH" text
    ctx.font = 'bold 32px Arial';
    ctx.fillStyle = '#ffd700';
    ctx.fillText('CHÀO HIỆP KHÁCH', textX, textY - 45);

    // Username
    const username = member.user.username;
    ctx.font = 'bold 36px Arial';
    ctx.fillStyle = '#ffffff';

    // Giới hạn độ dài username
    const maxWidth = CANVAS_WIDTH - textX - 30;
    let displayName = username;
    while (ctx.measureText(displayName).width > maxWidth && displayName.length > 0) {
        displayName = displayName.slice(0, -1);
    }
    if (displayName !== username) displayName += '...';

    ctx.fillText(displayName, textX, textY + 5);

    // Server name
    ctx.font = '20px Arial';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillText('Chào mừng đến GG(LangGia)', textX, textY + 50);

    // Member count
    ctx.font = '18px Arial';
    ctx.fillStyle = 'rgba(255, 215, 0, 0.9)';
    ctx.fillText(`⚔️ Hiệp Khách thứ #${member.guild.memberCount}`, textX, textY + 80);

    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // === XUẤT ẢNH ===
    const buffer = canvas.toBuffer('image/png');
    const attachment = new AttachmentBuilder(buffer, { name: 'welcome.png' });

    return attachment;
}

module.exports = {
    createWelcomeImage
};

/**
 * Lệnh ?rank - Xem EXP, level, ranking cá nhân
 * Tạo rank card đẹp bằng Canvas
 */

const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { AttachmentBuilder } = require('discord.js');
const { getExpInfo, getExpForLevel, getExpUserCount } = require('../../database/economy');
const path = require('path');

// Đăng ký font (nếu có)
try {
    GlobalFonts.registerFromPath(path.join(__dirname, '../../assets/fonts/NotoSans-Bold.ttf'), 'NotoSans-Bold');
    GlobalFonts.registerFromPath(path.join(__dirname, '../../assets/fonts/NotoSans-Regular.ttf'), 'NotoSans-Regular');
} catch (e) {
    // Dùng font mặc định nếu không có font custom
}

module.exports = {
    name: 'rank',
    aliases: ['level', 'xp', 'exp'],
    description: 'Xem level và EXP hiện tại',
    category: 'exp',

    async execute(message, args) {
        // Cho phép xem rank người khác
        let targetUser = message.author;
        let targetMember = message.member;

        if (args.length > 0) {
            const mention = message.mentions.members.first();
            if (mention) {
                targetUser = mention.user;
                targetMember = mention;
            } else {
                // Tìm theo tên
                const searchName = args.join(' ').toLowerCase();
                const found = message.guild.members.cache.find(m =>
                    m.displayName.toLowerCase().includes(searchName) ||
                    m.user.username.toLowerCase().includes(searchName)
                );
                if (found) {
                    targetUser = found.user;
                    targetMember = found;
                }
            }
        }

        // Bỏ qua bot
        if (targetUser.bot) {
            return message.reply('🤖 Bot không có EXP!');
        }

        const info = getExpInfo(targetUser.id);
        const totalUsers = getExpUserCount();

        // Tạo rank card bằng canvas
        const card = await createRankCard(targetUser, targetMember, info, totalUsers);

        const attachment = new AttachmentBuilder(card, { name: 'rank-card.png' });
        await message.reply({ files: [attachment] });
    }
};

/**
 * Tạo rank card đẹp bằng Canvas (scale x1.5 cho text rõ hơn)
 */
async function createRankCard(user, member, info, totalUsers) {
    const width = 1400;
    const height = 420;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // ═══ NỀN GRADIENT ═══
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#0f0c29');
    gradient.addColorStop(0.5, '#302b63');
    gradient.addColorStop(1, '#24243e');
    ctx.fillStyle = gradient;
    roundRect(ctx, 0, 0, width, height, 28);
    ctx.fill();

    // Viền phát sáng
    const borderGlow = ctx.createLinearGradient(0, 0, width, 0);
    borderGlow.addColorStop(0, '#667eea');
    borderGlow.addColorStop(0.5, '#764ba2');
    borderGlow.addColorStop(1, '#f093fb');
    ctx.strokeStyle = borderGlow;
    ctx.lineWidth = 4;
    roundRect(ctx, 2, 2, width - 4, height - 4, 28);
    ctx.stroke();

    // ═══ HIỆU ỨNG NỀN ═══
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(width - 150, 75, 180, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(150, height - 45, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // ═══ AVATAR (giữ nguyên kích thước 120px) ═══
    const avatarSize = 120;
    const avatarX = 65;
    const avatarY = (height - avatarSize) / 2;

    // Vòng sáng xung quanh avatar
    const avatarGlow = ctx.createRadialGradient(
        avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 - 5,
        avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 15
    );
    avatarGlow.addColorStop(0, 'rgba(102, 126, 234, 0.6)');
    avatarGlow.addColorStop(1, 'rgba(102, 126, 234, 0)');
    ctx.fillStyle = avatarGlow;
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 15, 0, Math.PI * 2);
    ctx.fill();

    // Viền avatar gradient
    const avatarBorder = ctx.createLinearGradient(avatarX, avatarY, avatarX + avatarSize, avatarY + avatarSize);
    avatarBorder.addColorStop(0, '#667eea');
    avatarBorder.addColorStop(1, '#f093fb');
    ctx.strokeStyle = avatarBorder;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 2, 0, Math.PI * 2);
    ctx.stroke();

    // Vẽ avatar (clip tròn)
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    try {
        const { loadImage } = require('@napi-rs/canvas');
        const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 256 });
        const avatarImage = await loadImage(avatarUrl);
        ctx.drawImage(avatarImage, avatarX, avatarY, avatarSize, avatarSize);
    } catch (e) {
        // Fallback: gradient circle
        const fallbackGrad = ctx.createLinearGradient(avatarX, avatarY, avatarX + avatarSize, avatarY + avatarSize);
        fallbackGrad.addColorStop(0, '#667eea');
        fallbackGrad.addColorStop(1, '#764ba2');
        ctx.fillStyle = fallbackGrad;
        ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);

        // Chữ cái đầu
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 48px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(user.username[0].toUpperCase(), avatarX + avatarSize / 2, avatarY + avatarSize / 2);
    }
    ctx.restore();

    // ═══ THÔNG TIN TEXT (tăng gấp đôi kích thước font) ═══
    const textX = avatarX + avatarSize + 50;
    const textMaxWidth = width - textX - 45;

    // Tên hiển thị - font lớn
    const displayName = member?.displayName || user.username;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 52px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    const nameText = displayName.length > 18 ? displayName.substring(0, 18) + '...' : displayName;
    ctx.fillText(nameText, textX, 40);

    // Username nhỏ hơn tên chút
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '28px sans-serif';
    ctx.fillText(`@${user.username}`, textX, 100);

    // ═══ BADGES - RANK & LEVEL ═══
    const badgeY = 40;
    const badgeX = width - 45;

    // Level badge
    const levelText = `LV ${info.level}`;
    ctx.font = 'bold 32px sans-serif';
    const levelBadgeWidth = ctx.measureText(levelText).width + 44;

    const levelBadgeX = badgeX - levelBadgeWidth;
    const levelGrad = ctx.createLinearGradient(levelBadgeX, badgeY, levelBadgeX + levelBadgeWidth, badgeY + 50);
    levelGrad.addColorStop(0, '#667eea');
    levelGrad.addColorStop(1, '#764ba2');
    ctx.fillStyle = levelGrad;
    roundRect(ctx, levelBadgeX, badgeY, levelBadgeWidth, 50, 25);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(levelText, levelBadgeX + levelBadgeWidth / 2, badgeY + 10);

    // Rank badge cạnh level
    const rankBadge = `#${info.rank}`;
    ctx.font = 'bold 28px sans-serif';
    const rankW = ctx.measureText(rankBadge).width + 32;
    const rankBadgeX = levelBadgeX - rankW - 12;

    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    roundRect(ctx, rankBadgeX, badgeY, rankW, 50, 25);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, rankBadgeX, badgeY, rankW, 50, 25);
    ctx.stroke();

    ctx.fillStyle = '#c4b5fd';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(rankBadge, rankBadgeX + rankW / 2, badgeY + 12);

    // Tổng users
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`/ ${totalUsers}`, rankBadgeX + rankW / 2, badgeY + 58);

    // ═══ THỐNG KÊ ═══
    const statsY = 145;
    ctx.textAlign = 'left';

    const stats = [
        { label: 'Text', value: formatNumber(info.textExp), sub: `${formatNumber(info.totalMessages)} tin nhắn`, color: '#667eea' },
        { label: 'Voice', value: formatNumber(info.voiceExp), sub: formatVoiceTime(info.totalVoiceMinutes), color: '#f093fb' },
        { label: 'Tổng', value: formatNumber(info.totalExp), sub: '', color: '#c4b5fd' },
    ];

    const statWidth = (textMaxWidth - 30) / 3;

    stats.forEach((stat, i) => {
        const sx = textX + i * (statWidth + 15);

        // Nền stat
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        roundRect(ctx, sx, statsY, statWidth - 8, 82, 12);
        ctx.fill();

        // Icon dot
        ctx.fillStyle = stat.color;
        ctx.beginPath();
        ctx.arc(sx + 20, statsY + 22, 6, 0, Math.PI * 2);
        ctx.fill();

        // Label
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '22px sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText(stat.label, sx + 32, statsY + 13);

        // Giá trị - font lớn
        ctx.fillStyle = '#e0e7ff';
        ctx.font = 'bold 34px sans-serif';
        ctx.fillText(stat.value, sx + 15, statsY + 40);

        // Sub text
        if (stat.sub) {
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.font = '18px sans-serif';
            ctx.fillText(stat.sub, sx + 15, statsY + 72);
        }
    });

    // ═══ PROGRESS BAR ═══
    const barY = 290;
    const barHeight = 38;
    const barWidth = textMaxWidth;

    // Label EXP
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('EXP Progress', textX, barY - 14);

    // EXP numbers
    ctx.fillStyle = '#e0e7ff';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${formatNumber(info.currentLevelExp)} / ${formatNumber(info.expForNext)}`, textX + barWidth, barY - 14);

    // Nền bar
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    roundRect(ctx, textX, barY, barWidth, barHeight, barHeight / 2);
    ctx.fill();

    // Progress gradient
    const progress = Math.min(info.currentLevelExp / info.expForNext, 1);
    const progressWidth = Math.max(barHeight, barWidth * progress);

    if (progress > 0) {
        const progressGrad = ctx.createLinearGradient(textX, barY, textX + progressWidth, barY);
        progressGrad.addColorStop(0, '#667eea');
        progressGrad.addColorStop(0.5, '#764ba2');
        progressGrad.addColorStop(1, '#f093fb');
        ctx.fillStyle = progressGrad;
        roundRect(ctx, textX, barY, progressWidth, barHeight, barHeight / 2);
        ctx.fill();

        // Hiệu ứng sáng
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#ffffff';
        roundRect(ctx, textX, barY, progressWidth, barHeight / 2, { tl: barHeight / 2, tr: barHeight / 2, bl: 0, br: 0 });
        ctx.fill();
        ctx.globalAlpha = 1;
    }

    // Phần trăm trên bar
    const percentText = `${Math.floor(progress * 100)}%`;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(percentText, textX + barWidth / 2, barY + barHeight / 2);

    // ═══ LEVEL TIER ═══
    const tierY = height - 52;
    const tierText = getLevelTier(info.level);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(tierText, textX, tierY);

    // Exp cần cho level tiếp
    const nextLevelExp = info.expForNext - info.currentLevelExp;
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.textAlign = 'right';
    ctx.fillText(`Còn ${formatNumber(nextLevelExp)} EXP → Level ${info.level + 1}`, textX + textMaxWidth, tierY);

    return canvas.toBuffer('image/png');
}

/**
 * Vẽ rounded rectangle
 */
function roundRect(ctx, x, y, w, h, r) {
    if (typeof r === 'number') {
        r = { tl: r, tr: r, bl: r, br: r };
    }
    ctx.beginPath();
    ctx.moveTo(x + r.tl, y);
    ctx.lineTo(x + w - r.tr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r.tr);
    ctx.lineTo(x + w, y + h - r.br);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
    ctx.lineTo(x + r.bl, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r.bl);
    ctx.lineTo(x, y + r.tl);
    ctx.quadraticCurveTo(x, y, x + r.tl, y);
    ctx.closePath();
}

/**
 * Format số
 */
function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

/**
 * Format thời gian voice
 */
function formatVoiceTime(minutes) {
    if (!minutes || minutes === 0) return '0 phút';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins} phút`;
}

/**
 * Lấy tier title theo level
 */
function getLevelTier(level) {
    if (level >= 50) return '~ Vo Song';
    if (level >= 30) return '~ Dai Hiep';
    if (level >= 20) return '~ Kiem Khach';
    if (level >= 10) return '~ Lu Khach';
    if (level >= 5) return '~ Tan Thu';
    return '~ Luyen Tap Sinh';
}

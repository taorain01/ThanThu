/**
 * Lệnh ?top - Bảng xếp hạng EXP
 * Tạo leaderboard card đẹp bằng Canvas
 */

const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { AttachmentBuilder } = require('discord.js');
const { getExpLeaderboard, getExpUserCount, getExpInfo } = require('../../database/economy');

module.exports = {
    name: 'top',
    aliases: ['leaderboard', 'lb', 'bxh'],
    description: 'Xem bảng xếp hạng EXP',
    category: 'exp',

    async execute(message, args) {
        // Xác định loại bảng xếp hạng
        let type = 'total';
        let typeLabel = 'TONG EXP';
        let themeColors = { primary: '#667eea', secondary: '#764ba2', accent: '#f093fb' };

        if (args[0]) {
            const arg = args[0].toLowerCase();
            if (['voice', 'vc', 'v'].includes(arg)) {
                type = 'voice';
                typeLabel = 'VOICE EXP';
                themeColors = { primary: '#43b581', secondary: '#2d8b6a', accent: '#7CFFC4' };
            } else if (['text', 'chat', 't', 'msg'].includes(arg)) {
                type = 'text';
                typeLabel = 'TEXT EXP';
                themeColors = { primary: '#faa61a', secondary: '#f47b20', accent: '#FFD700' };
            }
        }

        const leaderboard = getExpLeaderboard(type, 10);
        const totalUsers = getExpUserCount();
        const myInfo = getExpInfo(message.author.id);

        if (leaderboard.length === 0) {
            return message.reply('Chua co ai co EXP! Hay bat dau tro chuyen de kiem EXP nhe.');
        }

        // Resolve tên và avatar cho tất cả entries
        const entries = [];
        for (let i = 0; i < leaderboard.length; i++) {
            const entry = leaderboard[i];
            let displayName = '???';
            let avatarUrl = null;

            try {
                const member = message.guild.members.cache.get(entry.discord_id);
                if (member) {
                    displayName = member.displayName;
                    avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 64 });
                } else {
                    const user = await message.client.users.fetch(entry.discord_id).catch(() => null);
                    if (user) {
                        displayName = user.username;
                        avatarUrl = user.displayAvatarURL({ extension: 'png', size: 64 });
                    }
                }
            } catch (e) {
                displayName = '???';
            }

            // Truncate tên dài
            if (displayName.length > 18) {
                displayName = displayName.substring(0, 18) + '...';
            }

            // EXP value theo loại
            let expValue;
            if (type === 'text') expValue = entry.text_exp;
            else if (type === 'voice') expValue = entry.voice_exp;
            else expValue = entry.total_exp;

            entries.push({
                rank: i + 1,
                displayName,
                avatarUrl,
                expValue,
                level: entry.level,
                isMe: entry.discord_id === message.author.id,
            });
        }

        // Tìm max EXP để tính tỉ lệ bar
        const maxExp = entries[0]?.expValue || 1;

        // Tạo canvas leaderboard
        const card = await createLeaderboardCard(entries, maxExp, typeLabel, themeColors, myInfo, totalUsers, message.author);

        const attachment = new AttachmentBuilder(card, { name: 'leaderboard.png' });
        
        // Hướng dẫn sử dụng
        let hint = '';
        if (type === 'total') {
            hint = '?top voice | ?top text';
        } else {
            hint = '?top';
        }

        await message.reply({ 
            files: [attachment],
            content: hint ? `\`${hint}\`` : undefined
        });
    }
};

/**
 * Tạo leaderboard card đẹp bằng Canvas
 */
async function createLeaderboardCard(entries, maxExp, typeLabel, theme, myInfo, totalUsers, author) {
    const width = 700;
    const rowHeight = 52;
    const headerHeight = 70;
    const footerHeight = 50;
    const topPadding = 20;
    const bottomPadding = 15;
    const height = headerHeight + topPadding + entries.length * rowHeight + bottomPadding + footerHeight;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // ═══ NỀN GRADIENT ═══
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, '#0f0c29');
    bgGrad.addColorStop(0.4, '#1a1545');
    bgGrad.addColorStop(1, '#0d0b1e');
    ctx.fillStyle = bgGrad;
    roundRect(ctx, 0, 0, width, height, 16);
    ctx.fill();

    // Viền phát sáng
    const borderGlow = ctx.createLinearGradient(0, 0, width, 0);
    borderGlow.addColorStop(0, theme.primary);
    borderGlow.addColorStop(0.5, theme.secondary);
    borderGlow.addColorStop(1, theme.accent);
    ctx.strokeStyle = borderGlow;
    ctx.lineWidth = 2;
    roundRect(ctx, 1, 1, width - 2, height - 2, 16);
    ctx.stroke();

    // ═══ HIỆU ỨNG NỀN ═══
    ctx.globalAlpha = 0.03;
    ctx.fillStyle = theme.primary;
    ctx.beginPath();
    ctx.arc(width - 80, 60, 100, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(60, height - 40, 70, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // ═══ HEADER ═══
    const headerGrad = ctx.createLinearGradient(0, 0, width, headerHeight);
    headerGrad.addColorStop(0, 'rgba(255,255,255,0.03)');
    headerGrad.addColorStop(1, 'rgba(255,255,255,0.01)');
    ctx.fillStyle = headerGrad;
    roundRect(ctx, 0, 0, width, headerHeight, { tl: 16, tr: 16, bl: 0, br: 0 });
    ctx.fill();

    // Đường kẻ dưới header
    const lineGrad = ctx.createLinearGradient(30, headerHeight, width - 30, headerHeight);
    lineGrad.addColorStop(0, 'rgba(255,255,255,0)');
    lineGrad.addColorStop(0.2, theme.primary + '60');
    lineGrad.addColorStop(0.5, theme.accent + '80');
    lineGrad.addColorStop(0.8, theme.primary + '60');
    lineGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(30, headerHeight);
    ctx.lineTo(width - 30, headerHeight);
    ctx.stroke();

    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('BANG XEP HANG', 30, headerHeight / 2 - 5);

    // Type badge
    ctx.font = 'bold 13px sans-serif';
    const badgeText = typeLabel;
    const badgeWidth = ctx.measureText(badgeText).width + 20;
    const badgeX = 30;
    const badgeY = headerHeight / 2 + 14;

    const badgeGrad = ctx.createLinearGradient(badgeX, badgeY - 10, badgeX + badgeWidth, badgeY + 10);
    badgeGrad.addColorStop(0, theme.primary);
    badgeGrad.addColorStop(1, theme.secondary);
    ctx.fillStyle = badgeGrad;
    roundRect(ctx, badgeX, badgeY - 10, badgeWidth, 20, 10);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(badgeText, badgeX + badgeWidth / 2, badgeY);

    // Tổng người chơi (góc phải header)
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${totalUsers} nguoi choi`, width - 30, headerHeight / 2);

    // ═══ DANH SÁCH TOP ═══
    const startY = headerHeight + topPadding;

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const y = startY + i * rowHeight;
        const rowPadX = 20;
        const rowWidth = width - rowPadX * 2;

        // Nền row cho top 3 hoặc highlight bản thân
        if (entry.rank <= 3) {
            const rowAlpha = entry.rank === 1 ? 0.08 : entry.rank === 2 ? 0.05 : 0.03;
            ctx.fillStyle = `rgba(255,255,255,${rowAlpha})`;
            roundRect(ctx, rowPadX, y, rowWidth, rowHeight - 4, 8);
            ctx.fill();
        }

        if (entry.isMe) {
            ctx.strokeStyle = theme.primary + '50';
            ctx.lineWidth = 1;
            roundRect(ctx, rowPadX, y, rowWidth, rowHeight - 4, 8);
            ctx.stroke();
        }

        // ── Rank number ──
        const rankX = rowPadX + 20;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const centerY = y + (rowHeight - 4) / 2;

        if (entry.rank <= 3) {
            // Vẽ huy chương cho top 3
            const medalColors = [
                { bg: '#FFD700', border: '#B8860B', text: '#000' }, // Vàng
                { bg: '#C0C0C0', border: '#808080', text: '#000' }, // Bạc
                { bg: '#CD7F32', border: '#8B5A2B', text: '#fff' }, // Đồng
            ];
            const medal = medalColors[entry.rank - 1];

            // Hình tròn huy chương
            ctx.fillStyle = medal.bg;
            ctx.beginPath();
            ctx.arc(rankX, centerY, 14, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = medal.border;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(rankX, centerY, 14, 0, Math.PI * 2);
            ctx.stroke();

            ctx.fillStyle = medal.text;
            ctx.font = 'bold 14px sans-serif';
            ctx.fillText(entry.rank.toString(), rankX, centerY);
        } else {
            // Số thứ tự thường
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.font = 'bold 14px sans-serif';
            ctx.fillText(`${entry.rank}`, rankX, centerY);
        }

        // ── Avatar ──
        const avSize = 34;
        const avX = rankX + 30;
        const avY = centerY - avSize / 2;

        // Clip tròn để vẽ avatar
        ctx.save();
        ctx.beginPath();
        ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();

        try {
            if (entry.avatarUrl) {
                const avatar = await loadImage(entry.avatarUrl);
                ctx.drawImage(avatar, avX, avY, avSize, avSize);
            } else {
                throw new Error('no avatar');
            }
        } catch (e) {
            // Fallback gradient
            const fallbackGrad = ctx.createLinearGradient(avX, avY, avX + avSize, avY + avSize);
            fallbackGrad.addColorStop(0, theme.primary);
            fallbackGrad.addColorStop(1, theme.secondary);
            ctx.fillStyle = fallbackGrad;
            ctx.fillRect(avX, avY, avSize, avSize);

            ctx.fillStyle = '#fff';
            ctx.font = 'bold 16px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(entry.displayName[0].toUpperCase(), avX + avSize / 2, avY + avSize / 2);
        }
        ctx.restore();

        // Viền avatar top 3
        if (entry.rank <= 3) {
            const medalBorderColors = ['#FFD700', '#C0C0C0', '#CD7F32'];
            ctx.strokeStyle = medalBorderColors[entry.rank - 1];
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2 + 1, 0, Math.PI * 2);
            ctx.stroke();
        }

        // ── Tên + Level ──
        const nameX = avX + avSize + 12;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        // Tên
        ctx.fillStyle = entry.isMe ? theme.accent : '#ffffff';
        ctx.font = 'bold 15px sans-serif';
        ctx.fillText(entry.displayName, nameX, centerY - 8);

        // Level badge nhỏ
        const lvText = `Lv ${entry.level}`;
        ctx.font = '11px sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillText(lvText, nameX, centerY + 10);

        // ── EXP bar + số ──
        const barMaxWidth = 180;
        const barHeight = 10;
        const barX = width - 30 - barMaxWidth;
        const barY = centerY - barHeight / 2;

        // Nền bar
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        roundRect(ctx, barX, barY, barMaxWidth, barHeight, barHeight / 2);
        ctx.fill();

        // Progress fill
        const ratio = Math.min(entry.expValue / maxExp, 1);
        const fillWidth = Math.max(barHeight, barMaxWidth * ratio);

        const barGrad = ctx.createLinearGradient(barX, barY, barX + fillWidth, barY);
        barGrad.addColorStop(0, theme.primary);
        barGrad.addColorStop(1, theme.accent);
        ctx.fillStyle = barGrad;
        roundRect(ctx, barX, barY, fillWidth, barHeight, barHeight / 2);
        ctx.fill();

        // Hiệu ứng sáng trên bar
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#ffffff';
        roundRect(ctx, barX, barY, fillWidth, barHeight / 2, { tl: barHeight / 2, tr: barHeight / 2, bl: 0, br: 0 });
        ctx.fill();
        ctx.globalAlpha = 1;

        // Số EXP bên phải bar
        ctx.fillStyle = theme.accent;
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(formatNumber(entry.expValue), barX - 8, centerY);
    }

    // ═══ FOOTER - Thông tin bản thân ═══
    const footerY = height - footerHeight;

    // Đường kẻ trên footer
    const footerLine = ctx.createLinearGradient(30, footerY, width - 30, footerY);
    footerLine.addColorStop(0, 'rgba(255,255,255,0)');
    footerLine.addColorStop(0.3, 'rgba(255,255,255,0.1)');
    footerLine.addColorStop(0.7, 'rgba(255,255,255,0.1)');
    footerLine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = footerLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(30, footerY);
    ctx.lineTo(width - 30, footerY);
    ctx.stroke();

    // Thông tin cá nhân
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const footerCenterY = footerY + footerHeight / 2;
    ctx.fillText(`Hang cua ban: #${myInfo.rank}/${totalUsers}`, 30, footerCenterY);

    ctx.textAlign = 'right';
    ctx.fillText(`Level ${myInfo.level}  |  ${formatNumber(myInfo.totalExp)} EXP`, width - 30, footerCenterY);

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
 * Format số đẹp
 */
function formatNumber(num) {
    if (!num) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toLocaleString();
}

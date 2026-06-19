/**
 * Lệnh ?top - Bảng xếp hạng EXP
 * Hỗ trợ: ?top (tổng) | ?top ngay/tuan/thang/nam (theo chu kỳ)
 * Tạo leaderboard card đẹp bằng Canvas, chỉ hiển thị 5 người top
 * Xóa tin nhắn gốc + tag lại người dùng
 */

const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { AttachmentBuilder } = require('discord.js');
const { getAllExpLevels, getExpInfo, getPeriodicLeaderboard, getPeriodicExpInfo, getCurrentPeriodKeys } = require('../../database/exp');

// Cấu hình các loại chu kỳ
const PERIOD_CONFIG = {
    day: {
        aliases: ['ngay', 'day', 'd', 'homnay', 'today'],
        label: 'HOM NAY',
        emoji: '☀️',
        theme: { primary: '#FF6B35', secondary: '#D4380D', accent: '#FFA940' }
    },
    week: {
        aliases: ['tuan', 'week', 'w', 'tuannay'],
        label: 'TUAN NAY',
        emoji: '📅',
        theme: { primary: '#1890FF', secondary: '#0050B3', accent: '#69C0FF' }
    },
    month: {
        aliases: ['thang', 'month', 'm', 'thangnay'],
        label: 'THANG NAY',
        emoji: '🗓️',
        theme: { primary: '#722ED1', secondary: '#531DAB', accent: '#B37FEB' }
    },
    year: {
        aliases: ['nam', 'year', 'y', 'namnay'],
        label: 'NAM NAY',
        emoji: '🏆',
        theme: { primary: '#EB2F96', secondary: '#C41D7F', accent: '#FF85C0' }
    }
};

module.exports = {
    name: 'top',
    aliases: ['leaderboard', 'lb', 'bxh'],
    description: 'Xem bảng xếp hạng EXP',
    category: 'exp',

    async execute(message, args) {
        // Xác định loại bảng xếp hạng
        let periodType = null; // null = tổng EXP
        let expSubType = 'total'; // total, voice, text (chỉ cho tổng)
        let typeLabel = 'TONG EXP';
        let themeColors = { primary: '#667eea', secondary: '#764ba2', accent: '#f093fb' };

        if (args[0]) {
            const arg = args[0].toLowerCase();

            // Kiểm tra có phải chu kỳ không
            for (const [type, config] of Object.entries(PERIOD_CONFIG)) {
                if (config.aliases.includes(arg)) {
                    periodType = type;
                    typeLabel = config.label;
                    themeColors = config.theme;
                    break;
                }
            }

            // Nếu không phải chu kỳ, kiểm tra loại EXP (voice/text)
            if (!periodType) {
                if (['voice', 'vc', 'v'].includes(arg)) {
                    expSubType = 'voice';
                    typeLabel = 'VOICE EXP';
                    themeColors = { primary: '#43b581', secondary: '#2d8b6a', accent: '#7CFFC4' };
                } else if (['text', 'chat', 't', 'msg'].includes(arg)) {
                    expSubType = 'text';
                    typeLabel = 'TEXT EXP';
                    themeColors = { primary: '#faa61a', secondary: '#f47b20', accent: '#FFD700' };
                }
            }
        }

        let leaderboard, totalUsers, myExpValue;

        if (periodType) {
            // === Bảng xếp hạng theo chu kỳ (lọc theo server) ===
            const rawLeaderboard = getPeriodicLeaderboard(periodType, 100);
            await message.guild.members.fetch().catch(() => {});
            const guildMembersPeriodic = message.guild.members.cache;
            const filteredPeriodic = rawLeaderboard.filter(r => guildMembersPeriodic.has(r.discord_id));
            leaderboard = filteredPeriodic.slice(0, 5);
            totalUsers = filteredPeriodic.length;
            const myPeriodic = getPeriodicExpInfo(message.author.id, periodType);
            myExpValue = myPeriodic?.total_exp || 0;
        } else {
            // === Bảng xếp hạng tổng EXP ===
            const allRecords = getAllExpLevels();
            await message.guild.members.fetch().catch(() => {});
            const guildMembers = message.guild.members.cache;

            const sortKey = expSubType === 'total' ? 'total_exp' : expSubType === 'text' ? 'text_exp' : 'voice_exp';
            const filteredRecords = allRecords.filter(r => guildMembers.has(r.discord_id) && r[sortKey] > 0);
            filteredRecords.sort((a, b) => b[sortKey] - a[sortKey]);

            totalUsers = filteredRecords.length;
            leaderboard = filteredRecords.slice(0, 5);
            const myIndex = filteredRecords.findIndex(r => r.discord_id === message.author.id);
            const myRecord = filteredRecords.find(r => r.discord_id === message.author.id);
            myExpValue = myRecord ? myRecord[sortKey] : 0;
        }

        if (leaderboard.length === 0) {
            // Xóa tin nhắn gốc + tag lại
            try { await message.delete(); } catch (e) {}
            return message.channel.send({ content: `<@${message.author.id}> Chưa có ai có EXP trong khoảng thời gian này!` });
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
                    avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 128 });
                } else {
                    const user = await message.client.users.fetch(entry.discord_id).catch(() => null);
                    if (user) {
                        displayName = user.username;
                        avatarUrl = user.displayAvatarURL({ extension: 'png', size: 128 });
                    }
                }
            } catch (e) {
                displayName = '???';
            }

            // Truncate tên dài
            if (displayName.length > 16) {
                displayName = displayName.substring(0, 16) + '..';
            }

            // EXP value
            let expValue;
            if (periodType) {
                expValue = entry.total_exp;
            } else {
                if (expSubType === 'text') expValue = entry.text_exp;
                else if (expSubType === 'voice') expValue = entry.voice_exp;
                else expValue = entry.total_exp;
            }

            entries.push({
                rank: i + 1,
                displayName,
                avatarUrl,
                expValue,
                level: entry.level || 0,
                isMe: entry.discord_id === message.author.id,
            });
        }

        // Tìm max EXP để tính tỉ lệ bar
        const maxExp = entries[0]?.expValue || 1;

        // Tạo canvas leaderboard
        const periodKeys = getCurrentPeriodKeys();
        const card = await createLeaderboardCard(entries, maxExp, typeLabel, themeColors, myExpValue, totalUsers, periodType, periodKeys);

        const attachment = new AttachmentBuilder(card, { name: 'leaderboard.png' });

        // Tạo hint
        let hint = '';
        if (periodType) {
            const otherPeriods = Object.entries(PERIOD_CONFIG)
                .filter(([k]) => k !== periodType)
                .map(([k, v]) => `?top ${v.aliases[0]}`)
                .join(' | ');
            hint = `\`?top\` · ${otherPeriods}`;
        } else {
            hint = '`?top ngay` · `?top tuan` · `?top thang` · `?top nam`';
        }

        // Xóa tin nhắn gốc + tag lại người dùng
        try { await message.delete(); } catch (e) {}

        await message.channel.send({
            content: `<@${message.author.id}>\n${hint}`,
            files: [attachment]
        });
    }
};

/**
 * Tạo leaderboard card gọn (5 người top)
 */
async function createLeaderboardCard(entries, maxExp, typeLabel, theme, myExpValue, totalUsers, periodType, periodKeys) {
    const width = 750;
    const rowHeight = 62;
    const headerHeight = 72;
    const footerHeight = 44;
    const topPadding = 18;
    const bottomPadding = 14;
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

    // ═══ HEADER ═══
    const headerGrad = ctx.createLinearGradient(0, 0, width, headerHeight);
    headerGrad.addColorStop(0, 'rgba(255,255,255,0.03)');
    headerGrad.addColorStop(1, 'rgba(255,255,255,0.01)');
    ctx.fillStyle = headerGrad;
    roundRect(ctx, 0, 0, width, headerHeight, { tl: 16, tr: 16, bl: 0, br: 0 });
    ctx.fill();

    // Đường kẻ dưới header
    const lineGrad = ctx.createLinearGradient(24, headerHeight, width - 24, headerHeight);
    lineGrad.addColorStop(0, 'rgba(255,255,255,0)');
    lineGrad.addColorStop(0.2, theme.primary + '60');
    lineGrad.addColorStop(0.5, theme.accent + '80');
    lineGrad.addColorStop(0.8, theme.primary + '60');
    lineGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(24, headerHeight);
    ctx.lineTo(width - 24, headerHeight);
    ctx.stroke();

    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('BANG XEP HANG', 28, headerHeight / 2 - 6);

    // Type badge
    ctx.font = 'bold 13px sans-serif';
    const badgeText = typeLabel;
    const badgeWidth = ctx.measureText(badgeText).width + 22;
    const badgeX = 28;
    const badgeY = headerHeight / 2 + 16;

    const badgeGrad = ctx.createLinearGradient(badgeX, badgeY - 10, badgeX + badgeWidth, badgeY + 10);
    badgeGrad.addColorStop(0, theme.primary);
    badgeGrad.addColorStop(1, theme.secondary);
    ctx.fillStyle = badgeGrad;
    roundRect(ctx, badgeX, badgeY - 10, badgeWidth, 20, 10);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(badgeText, badgeX + badgeWidth / 2, badgeY);

    // Thông tin chu kỳ (góc phải header)
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    if (periodType && periodKeys) {
        const periodLabel = periodKeys[periodType] || '';
        ctx.fillText(`${totalUsers} nguoi · ${periodLabel}`, width - 28, headerHeight / 2 - 6);
    } else {
        ctx.fillText(`${totalUsers} nguoi choi`, width - 28, headerHeight / 2 - 6);
    }

    // Gợi ý tab chu kỳ (phía dưới phải header)
    if (!periodType) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font = '11px sans-serif';
        ctx.fillText('ngay · tuan · thang · nam', width - 28, headerHeight / 2 + 14);
    }

    // ═══ DANH SÁCH TOP 5 ═══
    const startY = headerHeight + topPadding;

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const y = startY + i * rowHeight;
        const rowPadX = 18;
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
        const rankX = rowPadX + 24;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const centerY = y + (rowHeight - 4) / 2;

        if (entry.rank <= 3) {
            const medalColors = [
                { bg: '#FFD700', border: '#B8860B', text: '#000' },
                { bg: '#C0C0C0', border: '#808080', text: '#000' },
                { bg: '#CD7F32', border: '#8B5A2B', text: '#fff' },
            ];
            const medal = medalColors[entry.rank - 1];

            ctx.fillStyle = medal.bg;
            ctx.beginPath();
            ctx.arc(rankX, centerY, 16, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = medal.border;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(rankX, centerY, 16, 0, Math.PI * 2);
            ctx.stroke();

            ctx.fillStyle = medal.text;
            ctx.font = 'bold 16px sans-serif';
            ctx.fillText(entry.rank.toString(), rankX, centerY);
        } else {
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.font = 'bold 16px sans-serif';
            ctx.fillText(`${entry.rank}`, rankX, centerY);
        }

        // ── Avatar ──
        const avSize = 40;
        const avX = rankX + 32;
        const avY = centerY - avSize / 2;

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
            const fallbackGrad = ctx.createLinearGradient(avX, avY, avX + avSize, avY + avSize);
            fallbackGrad.addColorStop(0, theme.primary);
            fallbackGrad.addColorStop(1, theme.secondary);
            ctx.fillStyle = fallbackGrad;
            ctx.fillRect(avX, avY, avSize, avSize);

            ctx.fillStyle = '#fff';
            ctx.font = 'bold 18px sans-serif';
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

        // ── Tên ──
        const nameX = avX + avSize + 14;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        ctx.fillStyle = entry.isMe ? theme.accent : '#ffffff';
        ctx.font = 'bold 18px sans-serif';
        ctx.fillText(entry.displayName, nameX, centerY);

        // ── EXP bar + số ──
        const barMaxWidth = 200;
        const barHeight = 12;
        const barX = width - 28 - barMaxWidth;
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

        // Số EXP bên trái bar
        ctx.fillStyle = theme.accent;
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(formatNumber(entry.expValue), barX - 8, centerY);
    }

    // ═══ FOOTER ═══
    const footerY = height - footerHeight;

    const footerLine = ctx.createLinearGradient(24, footerY, width - 24, footerY);
    footerLine.addColorStop(0, 'rgba(255,255,255,0)');
    footerLine.addColorStop(0.3, 'rgba(255,255,255,0.1)');
    footerLine.addColorStop(0.7, 'rgba(255,255,255,0.1)');
    footerLine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = footerLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(24, footerY);
    ctx.lineTo(width - 24, footerY);
    ctx.stroke();

    // Thông tin cá nhân
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const footerCenterY = footerY + footerHeight / 2;
    ctx.fillText(`EXP cua ban: ${formatNumber(myExpValue)}`, 28, footerCenterY);

    ctx.textAlign = 'right';
    ctx.fillText('Lang Gia Cac', width - 28, footerCenterY);

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

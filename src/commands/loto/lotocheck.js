/**
 * ?lotocheck / ?ltc - Check các số đã bốc hay chưa
 * 
 * Cách dùng:
 *   ?ltc 5 12 23 45  - Check danh sách số
 */

const { EmbedBuilder } = require('discord.js');
const lotoState = require('./lotoState');

async function execute(message, args) {
    const guildId = message.guild?.id;
    if (!guildId) return;

    if (!lotoState.hasSession(guildId)) {
        return message.reply('❌ Chưa có ván lô tô nào! Dùng `?lt` để bắt đầu.');
    }

    if (args.length === 0) {
        // Không có args → hiển thị tổng quan
        const session = lotoState.getSession(guildId);
        const drawnSorted = [...session.drawnNumbers].sort((a, b) => a - b);
        const drawnText = drawnSorted.map(n => `\`${String(n).padStart(2, '0')}\``).join(' ') || '_Chưa bốc số nào_';

        const total = session.availableNumbers.size + session.drawnSet.size;

        const embed = new EmbedBuilder()
            .setColor('#F59E0B')
            .setTitle('📋 Lô Tô - Tổng Quan')
            .addFields(
                { name: `✅ Đã bốc (${session.drawnNumbers.length})`, value: drawnText, inline: false },
                { name: '📊 Thống kê', value: `Đã bốc: **${session.drawnNumbers.length}**/${total} • Còn lại: **${session.availableNumbers.size}**`, inline: false }
            )
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    // Parse các số cần check
    const numbers = args.map(a => parseInt(a)).filter(n => !isNaN(n));

    if (numbers.length === 0) {
        return message.reply('❌ Vui lòng nhập số! VD: `?ltc 5 12 23`');
    }

    const session = lotoState.getSession(guildId);

    const results = numbers.map(num => {
        const drawn = lotoState.isDrawn(guildId, num);
        return { num, drawn };
    });

    const checkText = results.map(r => {
        const icon = r.drawn ? '✅' : '❌';
        const status = r.drawn ? 'Đã đọc' : 'Chưa đọc';
        return `${icon} **${String(r.num).padStart(2, '0')}** - ${status}`;
    }).join('\n');

    const drawnCount = results.filter(r => r.drawn).length;

    const embed = new EmbedBuilder()
        .setColor(drawnCount === results.length ? '#22C55E' : '#EF4444')
        .setTitle('🔍 Kiểm Tra Số Lô Tô')
        .setDescription(checkText)
        .setFooter({ text: `${drawnCount}/${results.length} số đã đọc • Tổng đã bốc: ${session.drawnNumbers.length}` })
        .setTimestamp();

    return message.reply({ embeds: [embed] });
}

module.exports = { execute };

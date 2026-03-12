/**
 * ?lotobo / ?ltb - Bỏ số khỏi sàn lô tô
 * 
 * Cách dùng:
 *   ?ltb 50 51 52  - Bỏ các số khỏi sàn
 */

const { EmbedBuilder } = require('discord.js');
const lotoState = require('./lotoState');

async function execute(message, args) {
    const guildId = message.guild?.id;
    if (!guildId) return;

    if (args.length === 0) {
        return message.reply('❌ Vui lòng nhập số cần bỏ! VD: `?ltb 50 51 52`');
    }

    if (!lotoState.hasSession(guildId)) {
        return message.reply('❌ Chưa có ván lô tô nào! Dùng `?lt` để bắt đầu.');
    }

    const numbers = args.map(a => parseInt(a)).filter(n => !isNaN(n));

    if (numbers.length === 0) {
        return message.reply('❌ Số không hợp lệ! VD: `?ltb 50 51 52`');
    }

    const { removed, notFound } = lotoState.removeNumbers(guildId, numbers);
    const session = lotoState.getSession(guildId);
    const total = session.availableNumbers.size + session.drawnSet.size;

    const parts = [];
    if (removed.length > 0) {
        parts.push(`✅ Đã bỏ: ${removed.map(n => `**${n}**`).join(', ')}`);
    }
    if (notFound.length > 0) {
        parts.push(`⚠️ Không tìm thấy trên sàn: ${notFound.map(n => `**${n}**`).join(', ')}`);
    }

    const embed = new EmbedBuilder()
        .setColor(removed.length > 0 ? '#EF4444' : '#F59E0B')
        .setTitle('➖ Bỏ Số Lô Tô')
        .setDescription(parts.join('\n'))
        .setFooter({ text: `Tổng sàn: ${total} số • Còn lại: ${session.availableNumbers.size}` })
        .setTimestamp();

    return message.reply({ embeds: [embed] });
}

module.exports = { execute };

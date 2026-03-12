/**
 * ?lotothem / ?ltt - Thêm số vào sàn lô tô
 * 
 * Cách dùng:
 *   ?ltt 91 92 93  - Thêm các số vào sàn
 */

const { EmbedBuilder } = require('discord.js');
const lotoState = require('./lotoState');

async function execute(message, args) {
    const guildId = message.guild?.id;
    if (!guildId) return;

    if (args.length === 0) {
        return message.reply('❌ Vui lòng nhập số cần thêm! VD: `?ltt 91 92 93`');
    }

    const numbers = args.map(a => parseInt(a)).filter(n => !isNaN(n) && n > 0);

    if (numbers.length === 0) {
        return message.reply('❌ Số không hợp lệ! VD: `?ltt 91 92 93`');
    }

    const { added, skipped } = lotoState.addNumbers(guildId, numbers);
    const session = lotoState.getSession(guildId);
    const total = session.availableNumbers.size + session.drawnSet.size;

    const parts = [];
    if (added.length > 0) {
        parts.push(`✅ Đã thêm: ${added.map(n => `**${n}**`).join(', ')}`);
    }
    if (skipped.length > 0) {
        parts.push(`⚠️ Bỏ qua (đã có/đã bốc): ${skipped.map(n => `**${n}**`).join(', ')}`);
    }

    const embed = new EmbedBuilder()
        .setColor(added.length > 0 ? '#22C55E' : '#F59E0B')
        .setTitle('➕ Thêm Số Lô Tô')
        .setDescription(parts.join('\n'))
        .setFooter({ text: `Tổng sàn: ${total} số • Còn lại: ${session.availableNumbers.size}` })
        .setTimestamp();

    return message.reply({ embeds: [embed] });
}

module.exports = { execute };

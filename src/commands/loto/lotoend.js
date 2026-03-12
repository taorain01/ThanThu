/**
 * ?lotoend / ?lte - Kết thúc ván lô tô, reset sàn và nhà cái
 * Lưu backup để có thể rollback
 */

const { EmbedBuilder } = require('discord.js');
const lotoState = require('./lotoState');

async function execute(message, args) {
    const guildId = message.guild?.id;
    if (!guildId) return;

    if (!lotoState.hasSession(guildId)) {
        return message.reply('❌ Chưa có ván lô tô nào để kết thúc!');
    }

    // Kiểm tra nhà cái
    const session = lotoState.getSession(guildId);
    if (session.dealerId && session.dealerId !== message.author.id) {
        return message.reply(`❌ Chỉ nhà cái <@${session.dealerId}> mới được kết thúc ván!`);
    }

    const boardMsgId = session.boardMessageId;

    const oldSession = lotoState.endSession(guildId);
    if (!oldSession) {
        return message.reply('❌ Không thể kết thúc ván!');
    }

    // Xóa embed sàn cũ
    if (boardMsgId) {
        try {
            const boardMsg = await message.channel.messages.fetch(boardMsgId);
            if (boardMsg) await boardMsg.delete();
        } catch (e) { }
    }

    const total = oldSession.drawnNumbers.length + oldSession.availableNumbers.size;
    const drawnSorted = [...oldSession.drawnNumbers].sort((a, b) => a - b);
    const drawnText = drawnSorted.map(n => `\`${String(n).padStart(2, '0')}\``).join(' ') || '_Không có_';

    const orderText = oldSession.drawnNumbers.map(n => `\`${String(n).padStart(2, '0')}\``).join(' → ');

    const embed = new EmbedBuilder()
        .setColor('#EF4444')
        .setTitle('🏁 Kết Thúc Ván Lô Tô')
        .addFields(
            { name: `📊 Đã bốc ${oldSession.drawnNumbers.length}/${total} số`, value: drawnText, inline: false },
            { name: '📜 Thứ tự bốc', value: orderText || '_Không có_', inline: false }
        )
        .setFooter({ text: `Nhà cái: ${oldSession.dealerName || '???'} • Dùng ?lt để chơi ván mới (nhà cái mới)` })
        .setTimestamp();

    return message.reply({ embeds: [embed] });
}

module.exports = { execute };

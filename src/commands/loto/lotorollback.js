/**
 * ?lotorollback / ?ltrb - Khôi phục ván đã end, chơi tiếp
 */

const { EmbedBuilder } = require('discord.js');
const lotoState = require('./lotoState');

async function execute(message, args) {
    const guildId = message.guild?.id;
    if (!guildId) return;

    if (!lotoState.hasBackup(guildId)) {
        return message.reply('❌ Không có ván nào để rollback! Chỉ rollback được sau khi dùng `?lte`.');
    }

    const success = lotoState.rollback(guildId);
    if (!success) {
        return message.reply('❌ Rollback thất bại!');
    }

    const session = lotoState.getSession(guildId);
    const total = session.availableNumbers.size + session.drawnSet.size;

    const embed = new EmbedBuilder()
        .setColor('#22C55E')
        .setTitle('⏪ Rollback Thành Công!')
        .setDescription([
            `Đã khôi phục ván lô tô trước đó.`,
            '',
            `📊 Đã bốc: **${session.drawnNumbers.length}**/${total}`,
            `🎯 Còn lại: **${session.availableNumbers.size}** số`,
            '',
            `Dùng \`?lt\` để tiếp tục bốc số!`
        ].join('\n'))
        .setTimestamp();

    return message.reply({ embeds: [embed] });
}

module.exports = { execute };

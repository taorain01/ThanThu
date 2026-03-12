/**
 * ?delboostroom / ?dbr
 * Xoá voice channel riêng của Booster
 */

const { EmbedBuilder } = require('discord.js');
const db = require('../../database/db');

async function execute(message) {
    const userId = message.author.id;

    const room = db.getBoosterRoom(userId);
    if (!room) {
        return message.reply({
            embeds: [new EmbedBuilder()
                .setColor('#EF4444')
                .setDescription('❌ Bạn chưa có Boost Room nào!')
            ]
        });
    }

    try {
        // Xoá voice channel
        const channel = message.guild.channels.cache.get(room.channel_id);
        if (channel) {
            await channel.delete('Booster xoá room');
        }

        // Xoá dữ liệu DB
        db.deleteBoosterRoom(userId);

        return message.reply({
            embeds: [new EmbedBuilder()
                .setColor('#22C55E')
                .setTitle('🗑️ Đã xoá Boost Room')
                .setDescription('Room và tất cả dữ liệu đã được xoá.\nDùng `?boostroom` để tạo room mới.')
            ]
        });
    } catch (error) {
        console.error('[delboostroom] Error:', error);
        return message.reply('❌ Không thể xoá room! Kiểm tra quyền của bot.');
    }
}

module.exports = { execute };

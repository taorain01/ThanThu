const { createScheduleOnlyEmbed } = require('./bossguild');
const { bossChannels, lastScheduleEmbed } = require('../../utils/bossState');
const db = require('../../database/db');

module.exports = {
    name: 'lichboss',
    aliases: ['lichguild', 'bosschedule'],
    description: 'Gửi embed lịch Boss Guild',

    async execute(message, args, client) {
        const guildId = message.guild.id;
        const channelId = message.channel.id;

        // Xóa embed lịch cũ nếu có
        const dbLastEmbedId = db.getConfig(`boss_schedule_msg_${channelId}`);
        if (dbLastEmbedId && !lastScheduleEmbed.has(channelId)) {
            lastScheduleEmbed.set(channelId, dbLastEmbedId);
        }

        const oldEmbedId = lastScheduleEmbed.get(channelId);
        if (oldEmbedId) {
            try {
                const oldMessage = await message.channel.messages.fetch(oldEmbedId);
                if (oldMessage) await oldMessage.delete();
            } catch (e) { /* Embed cũ có thể đã bị xóa */ }
        }

        // Gửi embed lịch mới
        const scheduleEmbed = createScheduleOnlyEmbed();
        const newMessage = await message.channel.send({ embeds: [scheduleEmbed] });

        // Lưu message ID mới
        lastScheduleEmbed.set(channelId, newMessage.id);
        db.setConfig(`boss_schedule_msg_${channelId}`, newMessage.id);

        // Đăng ký kênh để theo dõi (nếu chưa có)
        if (!bossChannels.has(guildId)) {
            bossChannels.set(guildId, message.channel.id);
        }
        db.setBossChannelId(guildId, message.channel.id);

        // Xóa tin nhắn lệnh
        try { await message.delete(); } catch (e) { }

        console.log(`[lichguild] Gửi lịch boss tại ${message.guild.name}`);
    }
};

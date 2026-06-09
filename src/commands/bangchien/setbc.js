const { EmbedBuilder } = require('discord.js');
const db = require('../../database/db');

module.exports = {
    name: 'setbc',
    aliases: ['setbangchien', 'bcchannel'],
    description: 'Set kênh hiện tại làm kênh Bang Chiến mặc định. Bot sẽ gửi thông báo BC vào kênh này khi web tạo session.',

    async execute(message, args, client) {
        // Kiểm tra quyền: Chỉ Kỳ Cựu, Quản Lý hoặc Owner
        const OWNER_ID = '395151484179841024';
        const kyCuuRole = message.guild.roles.cache.find(r => r.name === 'Kỳ Cựu');
        const quanLyRole = message.guild.roles.cache.find(r => r.name === 'Quản Lý');

        const isKyCuu = kyCuuRole && message.member.roles.cache.has(kyCuuRole.id);
        const isQuanLy = quanLyRole && message.member.roles.cache.has(quanLyRole.id);
        const isOwner = message.author.id === OWNER_ID;

        if (!isKyCuu && !isQuanLy && !isOwner) {
            return message.reply({
                content: '❌ Chỉ **Kỳ Cựu** hoặc **Quản Lý** mới được set kênh BC!',
                allowedMentions: { repliedUser: false }
            });
        }

        const channelId = message.channel.id;
        const channelName = message.channel.name;

        // Lưu vào DB
        db.setConfig(`bc_channel_${message.guild.id}`, channelId);
        try {
            const { bangchienChannels, bangchienOverviews } = require('../../utils/bangchienState');
            bangchienChannels.set(message.guild.id, channelId);

            const oldOverview = bangchienOverviews.get(message.guild.id);
            if (oldOverview?.channelId && oldOverview.channelId !== channelId) {
                if (oldOverview.message) {
                    await oldOverview.message.delete().catch(() => { });
                } else if (client?.channels && oldOverview.messageId) {
                    const oldChannel = await client.channels.fetch(oldOverview.channelId).catch(() => null);
                    const oldMessage = oldChannel
                        ? await oldChannel.messages.fetch(oldOverview.messageId).catch(() => null)
                        : null;
                    if (oldMessage) await oldMessage.delete().catch(() => { });
                }
                bangchienOverviews.delete(message.guild.id);
            }
        } catch (e) { }

        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('✅ Đã set kênh Bang Chiến')
            .setDescription(`Kênh **#${channelName}** sẽ là kênh mặc định cho Bang Chiến.\n\n` +
                `📌 Khi tạo BC từ **web**, bot sẽ tự động:\n` +
                `• Tạo session BC trong SQLite\n` +
                `• Gửi thông báo + embed overview ở kênh này\n` +
                `• Cập nhật lịch tuần\n\n` +
                `💡 Gõ \`?setbc\` ở kênh khác để đổi kênh.`)
            .setFooter({ text: `Channel ID: ${channelId}` })
            .setTimestamp();

        await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
        console.log(`[setbc] ${message.author.username} đã set kênh BC: #${channelName} (${channelId})`);
    }
};

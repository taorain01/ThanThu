/**
 * guildMemberAdd Event
 * Xử lý khi có thành viên mới join server
 * - Gửi DM trực tiếp cho member với ảnh welcome trong embed
 */

const { Events, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { createWelcomeImage } = require('../../utils/welcomeImage');
const path = require('path');

// Path to GIF file (local - không bao giờ hết hạn)
const GG_GIF_PATH = path.join(__dirname, '../../assets/images/GG.gif');

module.exports = {
    name: Events.GuildMemberAdd,
    once: false,

    async execute(member, client) {
        try {
            console.log(`[Welcome] New member: ${member.user.username} joined ${member.guild.name}`);

            // Tạo ảnh welcome
            const attachment = await createWelcomeImage(member);

            // Tạo attachment cho GIF
            const gifAttachment = new AttachmentBuilder(GG_GIF_PATH, { name: 'GG.gif' });

            // Tạo embed với ảnh bên trong
            const embed = new EmbedBuilder()
                .setColor(0xffd700)
                .setTitle(`⚔️ Chào Hiệp Khách!`)
                .setThumbnail('attachment://GG.gif')
                .setDescription([
                    `Xin chào **${member.user.username}**!`,
                    '',
                    `Chào mừng bạn đến với **GG(LangGia)**`,
                    '',
                    '📢 Xem thông báo mới → [#thông-báo](https://discord.com/channels/450633680000385036/1119589755781382224)',
                    '📜 Đọc nội quy server → [#luật-server](https://discord.com/channels/450633680000385036/1125757316126494780)',
                    '🎯 Theo dõi sự kiện → [#sự-kiện-guild](https://discord.com/channels/450633680000385036/1458732827104252039)',
                    '',
                    '⚔️ Chúc Hiệp Khách có những trải nghiệm tuyệt vời!'
                ].join('\n'))
                .setImage('attachment://welcome.png')
                .setTimestamp()
                .setFooter({ text: `Hiệp Khách thứ #${member.guild.memberCount}` });

            // Gửi DM trực tiếp cho member
            await member.send({
                embeds: [embed],
                files: [attachment, gifAttachment]
            });

            console.log(`[Welcome] Sent DM to ${member.user.username}`);

        } catch (error) {
            // Có thể member đã tắt DM
            console.error('[Welcome] Error (có thể user tắt DM):', error.message);
        }
    }
};


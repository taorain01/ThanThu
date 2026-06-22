/**
 * Lệnh ?setchannelanh - Set channel làm Phòng Ảnh
 * Chỉ dành cho Quản Lý.
 */

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/db');

function canManageAlbum(message) {
    return message.member?.permissions?.has(PermissionFlagsBits.Administrator)
        || message.member?.roles?.cache?.some((role) => ['Quản Lý', 'Bang Chủ', 'Phó Bang Chủ'].includes(role.name));
}

function getPermissionWarnings(channel, guild) {
    const botMember = guild.members.me;
    if (!botMember) return ['Không tìm thấy bot member trong guild.'];

    const permissions = channel.permissionsFor(botMember);
    if (!permissions) return ['Không đọc được quyền của bot trong channel này.'];

    const required = [
        [PermissionFlagsBits.ViewChannel, 'View Channel'],
        [PermissionFlagsBits.SendMessages, 'Send Messages'],
        [PermissionFlagsBits.ReadMessageHistory, 'Read Message History'],
        [PermissionFlagsBits.AddReactions, 'Add Reactions'],
    ];

    return required
        .filter(([flag]) => !permissions.has(flag))
        .map(([, label]) => label);
}

async function execute(message, args) {
    if (!message.guild) {
        return message.reply('❌ Lệnh này chỉ dùng trong server!');
    }

    if (!canManageAlbum(message)) {
        return message.reply('❌ Chỉ **Quản Lý** mới được sử dụng lệnh này!');
    }

    const targetChannel = message.mentions.channels.first() || message.channel;
    const previousChannelId = db.getAlbumChannelId(message.guild.id);
    const result = db.setAlbumChannelId(targetChannel.id, message.guild.id);

    if (!result.success) {
        return message.reply('❌ Có lỗi khi lưu cài đặt. Vui lòng thử lại!');
    }

    const warnings = getPermissionWarnings(targetChannel, message.guild);
    const embed = new EmbedBuilder()
        .setColor(warnings.length > 0 ? 0xF59E0B : 0x00FF00)
        .setTitle('📸 Đã thiết lập Phòng Ảnh')
        .setDescription(`Channel <#${targetChannel.id}> đã được set làm **Phòng Ảnh** cho server này.`)
        .addFields(
            {
                name: 'Data',
                value: [
                    `Guild: \`${message.guild.id}\``,
                    `Key: \`album_channel_${message.guild.id}\``,
                    previousChannelId && previousChannelId !== targetChannel.id ? `Trước đó: <#${previousChannelId}>` : null,
                ].filter(Boolean).join('\n'),
                inline: false,
            },
            {
                name: 'Cách hoạt động',
                value: '• Ảnh gửi vào channel này sẽ tự động lưu vào album của người gửi\n• Mỗi người tối đa **100 ảnh**\n• Bot phản hồi bằng reaction **📸** khi lưu thành công\n• Dùng `?album` để xem album của bạn',
                inline: false,
            }
        )
        .setFooter({ text: 'Lang Gia Các' })
        .setTimestamp();

    if (warnings.length > 0) {
        embed.addFields({
            name: 'Cảnh báo quyền bot',
            value: `Bot đang thiếu: ${warnings.map((warning) => `\`${warning}\``).join(', ')}.\nNếu thiếu \`Add Reactions\`, ảnh vẫn có thể lưu nhưng bạn sẽ không thấy reaction phản hồi.`,
            inline: false,
        });
    }

    return message.reply({ embeds: [embed] });
}

module.exports = {
    execute,
    aliases: ['setchannelphonganh', 'phonganh'],
};

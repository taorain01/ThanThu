/**
 * Lệnh ?setchannelanh - Set channel làm Phòng Ảnh
 * Chỉ dành cho Quản Lý
 */

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/db');

async function execute(message, args) {
    // Check permission - chỉ Quản Lý
    const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator) ||
        message.member.roles.cache.some(r => ['Quản Lý', 'Bang Chủ', 'Phó Bang Chủ'].includes(r.name));

    if (!isAdmin) {
        return message.reply('❌ Chỉ **Quản Lý** mới được sử dụng lệnh này!');
    }

    // Get channel - từ mention hoặc channel hiện tại
    let targetChannel = message.mentions.channels.first() || message.channel;

    // Lưu vào database
    const result = db.setAlbumChannelId(targetChannel.id);

    if (result.success) {
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('📸 Đã thiết lập Phòng Ảnh')
            .setDescription(`Channel <#${targetChannel.id}> đã được set làm **Phòng Ảnh**.`)
            .addFields({
                name: '💡 Cách hoạt động',
                value: '• Ảnh gửi vào channel này sẽ tự động lưu vào album của người gửi\n• Mỗi người tối đa **100 ảnh**\n• Dùng `?album` để xem album của bạn',
                inline: false
            })
            .setFooter({ text: 'Lang Gia Các' })
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    } else {
        return message.reply('❌ Có lỗi khi lưu cài đặt. Vui lòng thử lại!');
    }
}

module.exports = {
    execute,
    aliases: ['setchannelphonganh', 'phonganh']
};

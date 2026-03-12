/**
 * Lệnh ?helpphonganh - Hướng dẫn sử dụng Phòng Ảnh
 */

const { EmbedBuilder } = require('discord.js');

async function execute(message, args) {
    const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('📸 Hướng Dẫn Sử Dụng Phòng Ảnh')
        .setDescription('Nơi lưu giữ kỷ niệm của bạn trong giang hồ!')
        .addFields(
            {
                name: '📷 Bước 1: Upload ảnh & Quản lý Album',
                value: '• Gửi ảnh vào **#phòng-ảnh** để bot tự động lưu vào album cá nhân của bạn.\n' +
                    '• `?album` - Xem album ảnh của bạn (có thể dùng nút để set avatar).\n' +
                    '• `?delalbum <Số>` - Xóa ảnh trong album.\n\n' +
                    '💡 **Tip:** Dùng `?randomavt` (`?rda`) để bot tự đổi avatar ngẫu nhiên từ album mỗi khi soi `?mem`!',
                inline: false
            },
            {
                name: '🖼️ Bước 2: Set Avatar',
                value: 'Trong `?album`, nhấn nút **Set Avatar**\n→ Ảnh sẽ hiển thị trong `?mem`',
                inline: false
            }
        )
        .addFields({
            name: '✨ Kết quả',
            value: 'Dùng `?mem` để xem Hồ Sơ Giang Hồ đẹp với ảnh của bạn!',
            inline: false
        })
        .setFooter({ text: '💡 Mỗi người tối đa 100 ảnh • Ảnh mới = #1' })
        .setTimestamp();

    // Check if called from message (reply) or direct channel object (send)
    // If called from messageCreate event, message argument might hold { channel, guildId, client }
    if (message.reply) {
        return await message.reply({ embeds: [embed] });
    } else if (message.channel && message.channel.send) {
        return await message.channel.send({ embeds: [embed] });
    } else if (message.send) { // If message is just a channel object
        return await message.send({ embeds: [embed] });
    }
}
module.exports = {
    execute,
    aliases: ['helppa', 'hdphonganh', 'albumhelp']
};

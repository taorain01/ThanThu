/**
 * ?helprole - Help for role system (Thành viên)
 */

const { EmbedBuilder } = require('discord.js');

async function execute(message, args) {
    const prefix = process.env.PREFIX || '?';

    const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('🎨 HƯỚNG DẪN ĐỔI ROLE')
        .setDescription('Đổi role hiển thị cạnh tên của bạn trong guild!')
        .addFields(
            {
                name: '📋 Xem danh sách role',
                value: `\`${prefix}dsrole\` - Xem tất cả role có sẵn`,
                inline: false
            },
            {
                name: '🎯 Đổi role hiển thị',
                value:
                    `\`${prefix}role\` - Mở menu chọn role\n` +
                    `\`${prefix}role <mã>\` - Đổi role nhanh theo mã`,
                inline: false
            },
            {
                name: '👤 Xem profile',
                value: `\`${prefix}mem\` - Xem profile của bạn`,
                inline: false
            },
            {
                name: '💡 Ví dụ',
                value:
                    `\`${prefix}role\` → Mở menu chọn role\n` +
                    `\`${prefix}role pve\` → Đổi sang role PvE`,
                inline: false
            }
        )
        .setFooter({ text: 'Dùng ?role để đổi role nhanh!' })
        .setTimestamp();

    await message.channel.send({ embeds: [embed] });
}

module.exports = { execute };

/**
 * Lệnh ?setlevelup - Set kênh nhận thông báo Level Up
 * Chỉ dành cho Quản Lý / Bang Chủ / Phó Bang Chủ
 */

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/db');

async function execute(message, args) {
    // Kiểm tra quyền - chỉ Quản Lý
    const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator) ||
        message.member.roles.cache.some(r => ['Quản Lý', 'Bang Chủ', 'Phó Bang Chủ'].includes(r.name));

    if (!isAdmin) {
        return message.reply('❌ Chỉ **Quản Lý** mới được sử dụng lệnh này!');
    }

    // Lấy channel - từ mention hoặc channel hiện tại
    let targetChannel = message.mentions.channels.first() || message.channel;

    // Lưu vào database
    const result = db.setLevelUpChannelId(targetChannel.id);

    if (result.success) {
        const embed = new EmbedBuilder()
            .setColor(0x00E5FF)
            .setTitle('📊 Đã thiết lập kênh Level Up')
            .setDescription(`Kênh <#${targetChannel.id}> sẽ nhận **tất cả thông báo lên cấp**.`)
            .addFields({
                name: '💡 Cách hoạt động',
                value: '• Khi thành viên lên level (chat hoặc voice), thông báo sẽ gửi vào kênh này\n• Thông báo dạng embed đẹp, không tag người khác\n• Chỉ có **1 kênh** nhận thông báo level up',
                inline: false
            })
            .setFooter({ text: 'Lang Gia Các • Hệ thống EXP' })
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    } else {
        return message.reply('❌ Có lỗi khi lưu cài đặt. Vui lòng thử lại!');
    }
}

module.exports = {
    execute,
    aliases: ['setlvup', 'setlvl']
};

/**
 * Lệnh ?delavt - Xóa custom avatar
 * Usage: ?delavt
 */

const { EmbedBuilder } = require('discord.js');
const db = require('../../database/db');

async function execute(message, args) {
    const userId = message.author.id;

    // Check user có trong database không
    const userData = db.getUserByDiscordId(userId);
    if (!userData) {
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Không thể xóa avatar')
            .setDescription('Bạn chưa có trong database.')
            .setTimestamp();
        return message.reply({ embeds: [embed] });
    }

    // Check có avatar không
    const currentAvatar = db.getUserAvatar(userId);
    if (!currentAvatar) {
        const embed = new EmbedBuilder()
            .setColor(0xFFA500)
            .setTitle('ℹ️ Thông báo')
            .setDescription('Bạn chưa set avatar.\nDùng `?setavt` để set avatar mới.')
            .setTimestamp();
        return message.reply({ embeds: [embed] });
    }

    // Xoá ảnh trên Cloudinary (nếu là Cloudinary URL)
    const cloudinaryService = require('../../utils/cloudinaryService');
    if (currentAvatar.primary && currentAvatar.primary.includes('cloudinary.com')) {
        await cloudinaryService.deleteByUrl(currentAvatar.primary);
    }

    // Xóa avatar trong database
    const result = db.clearUserAvatar(userId);

    if (result.success) {
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('✅ Đã xóa avatar')
            .setDescription('Avatar của bạn đã được xóa khỏi database và server.\nLệnh `?mem` sẽ hiển thị embed thông thường.')
            .setTimestamp();
        return message.reply({ embeds: [embed] });
    } else {
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Lỗi')
            .setDescription('Không thể xóa avatar. Vui lòng thử lại sau.')
            .setTimestamp();
        return message.reply({ embeds: [embed] });
    }
}

module.exports = {
    execute,
    aliases: ['delavatar', 'removeavt', 'removeavatar', 'clearavt']
};

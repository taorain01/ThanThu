/**
 * Command: ?clearallalbum
 * Xoá tất cả ảnh trong album của TẤT CẢ người dùng
 * Chỉ owner mới được dùng
 */

const { EmbedBuilder } = require('discord.js');
const db = require('../../database/db');

async function execute(message, args) {
    // Check owner
    const ownerId = process.env.OWNER_ID || '395151484179841024';
    if (message.author.id !== ownerId) {
        return message.reply('❌ Chỉ owner mới được dùng lệnh này!');
    }

    try {
        // Đếm số ảnh hiện có trong album
        const countResult = db.db.prepare('SELECT COUNT(*) as count FROM album').get();
        const imageCount = countResult?.count || 0;

        if (imageCount === 0) {
            return message.reply('📭 Album trống, không có ảnh nào để xoá!');
        }

        // Xác nhận
        const confirmEmbed = new EmbedBuilder()
            .setColor(0xFFCC00)
            .setTitle('⚠️ Xác nhận xoá TẤT CẢ ảnh trong Album')
            .setDescription(`Bạn có chắc muốn xoá **${imageCount}** ảnh trong album?\n\n⚠️ **CẢNH BÁO**: Hành động này sẽ xoá ảnh của TẤT CẢ người dùng!\n\nGõ \`confirm\` trong 30 giây để xác nhận.`)
            .setTimestamp();

        await message.reply({ embeds: [confirmEmbed] });

        // Chờ xác nhận
        const filter = m => m.author.id === message.author.id && m.content.toLowerCase() === 'confirm';
        const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] })
            .catch(() => null);

        if (!collected || collected.size === 0) {
            return message.channel.send('❌ Đã hết thời gian xác nhận. Huỷ lệnh.');
        }

        // Lấy danh sách URL để xoá trên Cloudinary
        const images = db.db.prepare('SELECT image_url FROM album').all();

        // Xoá ảnh trên Cloudinary
        const cloudinaryService = require('../../utils/cloudinaryService');
        let cloudinaryDeleted = 0;

        for (const img of images) {
            if (img.image_url && img.image_url.includes('cloudinary.com')) {
                const result = await cloudinaryService.deleteByUrl(img.image_url);
                if (result.success) cloudinaryDeleted++;
            }
        }

        // Xoá tất cả ảnh trong database
        const result = db.db.prepare('DELETE FROM album').run();

        const successEmbed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('✅ Đã xoá tất cả ảnh trong Album!')
            .setDescription(`Đã xoá **${result.changes}** ảnh trong database.\nĐã xoá **${cloudinaryDeleted}** ảnh trên Cloudinary.`)
            .setTimestamp();

        return message.channel.send({ embeds: [successEmbed] });
    } catch (error) {
        console.error('[clearallalbum] Error:', error);
        return message.reply(`❌ Lỗi: ${error.message}`);
    }
}

module.exports = {
    execute,
    aliases: ['xoahetalbum', 'delallalbum', 'clearalbum']
};

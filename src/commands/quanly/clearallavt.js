/**
 * Command: ?clearallavt
 * Xoá tất cả custom avatar của mọi người dùng
 * Chỉ owner mới được dùng
 */

const { EmbedBuilder } = require('discord.js');
const db = require('../../database/db');

async function execute(message, args, client) {
    // Check owner
    const ownerId = process.env.OWNER_ID || '395151484179841024';
    if (message.author.id !== ownerId) {
        return message.reply('❌ Chỉ owner mới được dùng lệnh này!');
    }

    try {
        // Đếm số avatar hiện có
        const countResult = db.db.prepare('SELECT COUNT(*) as count FROM users WHERE custom_avatar IS NOT NULL').get();
        const avatarCount = countResult?.count || 0;

        if (avatarCount === 0) {
            return message.reply('📭 Không có avatar nào để xoá!');
        }

        // Xác nhận
        const confirmEmbed = new EmbedBuilder()
            .setColor(0xFFCC00)
            .setTitle('⚠️ Xác nhận xoá tất cả avatar')
            .setDescription(`Bạn có chắc muốn xoá **${avatarCount}** avatar?\n\nGõ \`confirm\` trong 30 giây để xác nhận.`)
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
        const avatars = db.db.prepare('SELECT custom_avatar, backup_avatar FROM users WHERE custom_avatar IS NOT NULL').all();

        // Xoá ảnh trên Cloudinary
        const cloudinaryService = require('../../utils/cloudinaryService');
        let cloudinaryDeleted = 0;

        for (const avatar of avatars) {
            if (avatar.custom_avatar && avatar.custom_avatar.includes('cloudinary.com')) {
                const result = await cloudinaryService.deleteByUrl(avatar.custom_avatar);
                if (result.success) cloudinaryDeleted++;
            }
            // Backup thường là ImgBB, không xoá được qua API
        }

        // Xoá tất cả avatar trong database
        const result = db.db.prepare('UPDATE users SET custom_avatar = NULL, backup_avatar = NULL, updated_at = CURRENT_TIMESTAMP WHERE custom_avatar IS NOT NULL').run();

        // Xoá cache member card
        try {
            const cardCache = require('../../utils/memberCardCache');
            cardCache.clearAll();
        } catch (e) {
            // Cache không có clearAll, bỏ qua
        }

        const successEmbed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('✅ Đã xoá tất cả avatar!')
            .setDescription(`Đã xoá **${result.changes}** avatar trong database.\nĐã xoá **${cloudinaryDeleted}** ảnh trên Cloudinary.`)
            .setTimestamp();

        return message.channel.send({ embeds: [successEmbed] });
    } catch (error) {
        console.error('[clearallavt] Error:', error);
        return message.reply(`❌ Lỗi: ${error.message}`);
    }
}

module.exports = {
    execute,
    aliases: ['xoahetatv', 'delavtall']
};


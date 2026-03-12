/**
 * Lệnh ?setavt - Set custom avatar cho profile card
 * Usage: ?setavt (kèm ảnh hoặc reply ảnh)
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
            .setTitle('❌ Không thể set avatar')
            .setDescription('Bạn cần vào guild trước khi sử dụng lệnh này!\n\nNhờ Quản Lý dùng `?addmem` để thêm bạn vào database.')
            .setTimestamp();
        return message.reply({ embeds: [embed] });
    }

    // Check user có bị ban avatar không
    if (db.isAvatarBanned(userId)) {
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('🚫 Bạn đã bị cấm đặt avatar')
            .setDescription('Bạn không được phép sử dụng tính năng này.\nLiên hệ Quản Lý để biết thêm chi tiết.')
            .setTimestamp();
        return message.reply({ embeds: [embed] });
    }

    // Tìm ảnh từ attachment hoặc reply
    let imageUrl = null;

    // Check attachment trong message hiện tại
    if (message.attachments.size > 0) {
        const attachment = message.attachments.first();
        if (attachment.contentType && attachment.contentType.startsWith('image/')) {
            imageUrl = attachment.url;
        }
    }

    // Nếu không có attachment, check message được reply
    if (!imageUrl && message.reference) {
        try {
            const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
            if (repliedMessage.attachments.size > 0) {
                const attachment = repliedMessage.attachments.first();
                if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                    imageUrl = attachment.url;
                }
            }
        } catch (e) {
            // Không fetch được message reply
        }
    }

    // Không tìm thấy ảnh
    if (!imageUrl) {
        const embed = new EmbedBuilder()
            .setColor(0xFFA500)
            .setTitle('📸 Cách set avatar')
            .setDescription('Có 2 cách để set avatar:\n\n**Cách 1:** Upload ảnh + gõ `?setavt`\n**Cách 2:** Reply ảnh + gõ `?setavt`')
            .addFields({
                name: '💡 Lưu ý',
                value: '• Chỉ hỗ trợ ảnh (PNG, JPG, GIF, WEBP)\n• Ảnh sẽ hiển thị trong lệnh `?mem`\n• Dùng `?delavt` để xóa avatar',
                inline: false
            })
            .setTimestamp();
        return message.reply({ embeds: [embed] });
    }

    // Upload song song lên CẢ HAI service (Cloudinary + ImgBB)
    const imageService = require('../../utils/imageService');
    let primaryUrl = imageUrl;  // Discord URL as default
    let backupUrl = null;

    if (imageService.isConfigured()) {
        try {
            const uploadResults = await imageService.uploadToAll(imageUrl);
            // Ưu tiên Cloudinary làm primary, ImgBB làm backup
            if (uploadResults.cloudinary) {
                primaryUrl = uploadResults.cloudinary;
                backupUrl = uploadResults.imgbb || null;
                console.log(`[setavt] Primary: Cloudinary, Backup: ${backupUrl ? 'ImgBB' : 'None'}`);
            } else if (uploadResults.imgbb) {
                primaryUrl = uploadResults.imgbb;
                console.log(`[setavt] Primary: ImgBB (Cloudinary failed)`);
            } else {
                console.warn(`[setavt] Both uploads failed, using Discord URL`);
            }
        } catch (e) {
            console.error('[setavt] Upload error:', e.message);
        }
    }

    // Lưu cả 2 URL vào database
    const result = db.setUserAvatar(userId, primaryUrl, backupUrl);

    if (result.success) {
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('✅ Đã set avatar thành công!')
            .setDescription('Avatar của bạn đã được cập nhật.\nDùng `?mem` hoặc `?me` để xem profile card.')
            .setThumbnail(imageUrl)
            .setFooter({ text: 'Dùng ?delavt để xóa avatar' })
            .setTimestamp();
        return message.reply({ embeds: [embed] });
    } else {
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Lỗi')
            .setDescription('Không thể lưu avatar. Vui lòng thử lại sau.')
            .setTimestamp();
        return message.reply({ embeds: [embed] });
    }
}

module.exports = {
    execute,
    aliases: ['setavatar', 'avatar', 'avt']
};

/**
 * Lệnh ?album - Xem album ảnh của bạn
 * Hiển thị 1 ảnh/trang như gallery
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../database/db');

async function execute(message, args) {
    const userId = message.author.id;
    const page = parseInt(args[0]) || 1;

    const totalImages = db.getAlbumImageCount(userId);

    if (totalImages === 0) {
        const embed = new EmbedBuilder()
            .setColor(0xFFA500)
            .setTitle('📸 Album của bạn')
            .setDescription('📭 Album trống!\n\nGửi ảnh vào kênh **Phòng Ảnh** để lưu vào album.')
            .setFooter({ text: 'Tối đa 100 ảnh/người' })
            .setTimestamp();
        return message.reply({ embeds: [embed] });
    }

    // 1 ảnh/trang
    const currentPage = Math.min(Math.max(1, page), totalImages);
    const images = db.getAlbumImages(userId, currentPage, 1); // limit = 1
    const image = images[0];

    if (!image) {
        return message.reply('❌ Không tìm thấy ảnh!');
    }

    // Detect image source
    const isCloudinary = image.image_url?.includes('cloudinary');
    const isImgBB = image.image_url?.includes('ibb.co');
    const sourceLabel = isCloudinary ? '☁️ Cloudinary' : isImgBB ? '📦 ImgBB' : '🔗 Discord';

    // Build embed
    const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle(`📸 Album của ${message.author.displayName}`)
        .setDescription(`Ảnh **#${image.image_number}** / ${totalImages}\n<t:${Math.floor(new Date(image.created_at).getTime() / 1000)}:R>\n\n**${sourceLabel}**\n\`${image.image_url}\``)
        .setImage(image.image_url)
        .setFooter({ text: `Dùng ?album <số> để xem ảnh cụ thể` })
        .setTimestamp();

    // Navigation buttons
    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`album_prev_${userId}_${currentPage}`)
            .setEmoji('◀️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage <= 1),
        new ButtonBuilder()
            .setCustomId(`album_page_${userId}`)
            .setLabel(`${currentPage} / ${totalImages}`)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId(`album_next_${userId}_${currentPage}`)
            .setEmoji('▶️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage >= totalImages)
    );

    // Action buttons for current image
    const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`album_setavt_${userId}_${image.image_number}`)
            .setLabel('📸 Set Avatar')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`album_delete_${userId}_${image.image_number}`)
            .setLabel('🗑️ Xóa ảnh này')
            .setStyle(ButtonStyle.Danger)
    );

    return message.reply({ embeds: [embed], components: [navRow, actionRow] });
}

module.exports = {
    execute,
    aliases: ['xemanh', 'myalbum', 'anh']
};

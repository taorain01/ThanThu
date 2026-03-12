/**
 * Album Button Handlers
 * Xử lý các nút trong lệnh ?album (1 ảnh/trang)
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database/db');

/**
 * Handle album button interactions
 */
async function handleAlbumButton(interaction) {
    const customId = interaction.customId;
    if (!customId.startsWith('album_')) return false;

    const parts = customId.split('_');
    const action = parts[1]; // prev, next, page, setavt, delete
    const targetUserId = parts[2];

    // Chỉ user đó mới được tương tác
    if (interaction.user.id !== targetUserId) {
        await interaction.reply({ content: '❌ Đây không phải album của bạn!', ephemeral: true });
        return true;
    }

    // Handle pagination
    if (action === 'prev' || action === 'next') {
        const currentPage = parseInt(parts[3]) || 1;
        const newPage = action === 'prev' ? currentPage - 1 : currentPage + 1;
        await showAlbumPage(interaction, targetUserId, newPage);
        return true;
    }

    // Ignore page button (disabled)
    if (action === 'page') {
        return true;
    }

    // Handle set avatar
    if (action === 'setavt') {
        // Kiểm tra user có bị ban avatar không
        if (db.isAvatarBanned(targetUserId)) {
            await interaction.reply({ content: '🚫 Bạn đã bị cấm đặt avatar!', ephemeral: true });
            return true;
        }

        const imageNumber = parseInt(parts[3]);
        const image = db.getAlbumImageByNumber(targetUserId, imageNumber);
        if (!image) {
            await interaction.reply({ content: '❌ Không tìm thấy ảnh!', ephemeral: true });
            return true;
        }

        const result = db.setUserAvatar(targetUserId, image.image_url);
        if (result.success) {
            // Xoá cache member card để hiển thị ảnh mới
            try {
                const cardCache = require('./memberCardCache');
                cardCache.invalidateUser(targetUserId);
            } catch (e) { }

            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Đã set avatar!')
                .setDescription(`Đã set ảnh #${imageNumber} làm avatar.\nDùng \`?me\` hoặc \`?mem\` để xem profile.`)
                .setThumbnail(image.image_url)
                .setTimestamp();
            await interaction.reply({ embeds: [embed], ephemeral: true });
        } else {
            await interaction.reply({ content: '❌ Không thể set avatar. Bạn cần vào guild trước!', ephemeral: true });
        }
        return true;
    }

    // Handle delete
    if (action === 'delete') {
        const imageNumber = parseInt(parts[3]);

        // Lấy URL ảnh trước khi xoá
        const image = db.getAlbumImageByNumber(targetUserId, imageNumber);

        // Xoá ảnh trên Cloudinary (nếu là Cloudinary URL)
        if (image && image.image_url && image.image_url.includes('cloudinary.com')) {
            const cloudinaryService = require('./cloudinaryService');
            await cloudinaryService.deleteByUrl(image.image_url);
        }

        const result = db.deleteAlbumImage(targetUserId, imageNumber);
        if (result.success) {
            // Chuyển về trang trước nếu xóa ảnh cuối
            const totalImages = db.getAlbumImageCount(targetUserId);
            const newPage = Math.min(imageNumber, totalImages) || 1;

            if (totalImages === 0) {
                // Album trống
                const embed = new EmbedBuilder()
                    .setColor(0xFFA500)
                    .setTitle('📸 Album')
                    .setDescription('📭 Album trống!')
                    .setTimestamp();
                await interaction.update({ embeds: [embed], components: [] });
            } else {
                await interaction.reply({ content: `🗑️ Đã xóa ảnh #${imageNumber}!`, ephemeral: true });
                await showAlbumPage(interaction, targetUserId, newPage, true);
            }
        } else {
            await interaction.reply({ content: '❌ Không tìm thấy ảnh!', ephemeral: true });
        }
        return true;
    }

    return false;
}

/**
 * Show album page (1 ảnh/trang)
 */
async function showAlbumPage(interaction, userId, page, isFollowUp = false) {
    const totalImages = db.getAlbumImageCount(userId);

    if (totalImages === 0) {
        const embed = new EmbedBuilder()
            .setColor(0xFFA500)
            .setTitle('📸 Album')
            .setDescription('📭 Album trống!')
            .setTimestamp();
        await interaction.update({ embeds: [embed], components: [] });
        return;
    }

    const currentPage = Math.min(Math.max(1, page), totalImages);
    const images = db.getAlbumImages(userId, currentPage, 1);
    const image = images[0];

    if (!image) {
        await interaction.reply({ content: '❌ Không tìm thấy ảnh!', ephemeral: true });
        return;
    }

    // Detect image source
    const isCloudinary = image.image_url?.includes('cloudinary');
    const isImgBB = image.image_url?.includes('ibb.co');
    const sourceLabel = isCloudinary ? '☁️ Cloudinary' : isImgBB ? '📦 ImgBB' : '🔗 Discord';

    const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle(`📸 Album`)
        .setDescription(`Ảnh **#${image.image_number}** / ${totalImages}\n<t:${Math.floor(new Date(image.created_at).getTime() / 1000)}:R>\n\n**${sourceLabel}**\n\`${image.image_url}\``)
        .setImage(image.image_url)
        .setTimestamp();

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

    const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`album_setavt_${userId}_${image.image_number}`)
            .setLabel('📸 Set Avatar')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`album_delete_${userId}_${image.image_number}`)
            .setLabel('🗑️ Xóa')
            .setStyle(ButtonStyle.Danger)
    );

    if (isFollowUp) {
        // Edit original message after delete
        try {
            await interaction.message.edit({ embeds: [embed], components: [navRow, actionRow] });
        } catch (e) { }
    } else {
        await interaction.update({ embeds: [embed], components: [navRow, actionRow] });
    }
}

module.exports = { handleAlbumButton };

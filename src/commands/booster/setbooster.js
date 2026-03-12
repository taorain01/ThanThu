/**
 * ?setbooster <Category ID>
 * Thiết lập kênh Booster Panel + category cho VIP Room
 * Chỉ user ID 395151484179841024 được dùng
 * 
 * Gửi embed hướng dẫn với 2 nút persistent:
 * - booster_create: Tạo VIP Room
 * - booster_delete: Xoá VIP Room
 * 
 * Lưu message ID vào DB → bot restart vẫn giữ panel cũ
 * Gõ lại lệnh → xoá panel cũ, gửi panel mới
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const db = require('../../database/db');

const ALLOWED_USER_ID = '395151484179841024';

/**
 * Tạo embed hướng dẫn + buttons cho Booster Panel
 */
function createBoosterPanelEmbed() {
    // Custom emoji IDs cho decor (animated)
    const EMOJI = {
        tenlua: '<a:oz_rocket:1251414424422580314>',
        booster: '<a:oz_boost:1251399419467792495>',
        kimcuong: '<a:oz_diamond:1251414256990031965>',
        tiendo: '<a:oz_money:1251399400803008542>'
    };

    const embed = new EmbedBuilder()
        .setColor('#FF73FA')
        .setTitle(`${EMOJI.booster} VIP Room — Server Booster`)
        .setDescription(
            `${EMOJI.tenlua} **Đặc quyền dành cho Server Booster!**\n\n` +
            `${EMOJI.kimcuong} Mỗi Booster được tạo **1 Voice Channel riêng** với đầy đủ quyền quản lý:\n\n` +
            `> 👻 **Ẩn** — Chỉ bạn và người được mời thấy\n` +
            `> 🌐 **Công khai** — Ai cũng vào được\n` +
            `> 🔒 **Khoá** — Ai cũng thấy, chỉ người được mời vào\n\n` +
            `${EMOJI.tiendo} **Tính năng VIP:**\n` +
            `> 🎛️ Bảng điều khiển riêng khi vào room\n` +
            `> 🌏 Tự chọn server khu vực (Singapore, HK, JP...)\n` +
            `> 🔇 Quản lý mic thành viên\n` +
            `> ✏️ Đổi tên room tuỳ ý\n\n` +
            `📌 **Cách sử dụng:**\n` +
            `1️⃣ Nhấn **Tạo VIP Room** để tạo phòng\n` +
            `2️⃣ Vào room để mở **Bảng Điều Khiển** quản lý\n` +
            `3️⃣ Nhấn **Xoá VIP Room** khi không cần nữa\n\n` +
            `💖 **Cảm ơn bạn đã Boost server!** Sự ủng hộ của bạn giúp cộng đồng ngày càng phát triển. Đây là món quà nhỏ dành riêng cho bạn!\n\n` +
            `⚠️ *Mất role Booster → Room tự động bị xoá.*`
        )
        .setFooter({ text: `${'\u2B50'} Server Booster GameGroup • Nhấn nút bên dưới` })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('booster_create')
            .setLabel('Tạo VIP Room')
            .setEmoji('1251399419467792495')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('booster_delete')
            .setLabel('Xoá VIP Room')
            .setEmoji('🗑️')
            .setStyle(ButtonStyle.Danger)
    );

    return { embeds: [embed], components: [row] };
}

async function execute(message, args) {
    // Chỉ cho phép user cụ thể
    if (message.author.id !== ALLOWED_USER_ID) {
        return message.reply('❌ Bạn không có quyền sử dụng lệnh này!');
    }

    // Tự lấy category từ channel hiện tại, hoặc nhập thủ công
    let categoryId;
    if (args.length > 0) {
        categoryId = args[0];
    } else {
        // Tự detect category cha của channel hiện tại
        categoryId = message.channel.parentId;
    }

    if (!categoryId) {
        return message.reply('❌ Channel này không nằm trong category nào!\nDùng `?setbooster <Category ID>` để chỉ định thủ công.');
    }

    const category = message.guild.channels.cache.get(categoryId);

    if (!category || category.type !== ChannelType.GuildCategory) {
        return message.reply('❌ Không tìm thấy category hợp lệ!');
    }

    const guildId = message.guild.id;

    // Lưu category vào DB
    db.setBoostCategoryId(guildId, categoryId);

    // Lưu channel hiện tại là booster panel channel
    db.setConfig(`booster_panel_channel_${guildId}`, message.channel.id);

    // Xoá panel cũ nếu có
    const oldMsgId = db.getConfig(`booster_panel_msg_${guildId}`);
    if (oldMsgId) {
        try {
            const oldMsg = await message.channel.messages.fetch(oldMsgId).catch(() => null);
            if (oldMsg) await oldMsg.delete();
        } catch (e) { /* ignore */ }
    }

    // Xoá tin nhắn lệnh
    try { await message.delete(); } catch (e) { }

    // Gửi embed hướng dẫn với buttons persistent
    const panel = createBoosterPanelEmbed();
    const sent = await message.channel.send(panel);

    // Lưu message ID vào DB → bot restart vẫn nhận biết
    db.setConfig(`booster_panel_msg_${guildId}`, sent.id);

    console.log(`[Booster] Panel created in #${message.channel.name}, msg: ${sent.id}, category: ${category.name} (${categoryId})`);
}

module.exports = { execute, createBoosterPanelEmbed };

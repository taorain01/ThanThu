/**
 * ?dsrole / ?listrole - List all sub-roles
 */

const { EmbedBuilder } = require('discord.js');
const { getRoleMappings } = require('./addrole');
const db = require('../../../database/db');

async function execute(message, args) {
    const mappings = getRoleMappings();
    const codes = Object.keys(mappings);

    if (codes.length === 0) {
        return message.channel.send('❌ Chưa có role phụ nào!\nDùng `?addrole <mã> <tên>` + icon để thêm.');
    }

    const lines = codes.map(code => {
        const entry = mappings[code];
        const name = typeof entry === 'string' ? entry : entry.name;
        const emojiId = typeof entry === 'object' ? entry.emojiId : null;

        // Show actual emoji if available, otherwise show indicator
        let iconDisplay;
        if (emojiId) {
            iconDisplay = `<:sr_${code}:${emojiId}>`;
        } else if (typeof entry === 'object' && entry.icon) {
            iconDisplay = '🖼️';
        } else {
            iconDisplay = '⬜';
        }

        return `${iconDisplay} \`${code}\` → **${name}**`;
    });

    // Kênh cấp role (nơi user gửi tin nhắn/ảnh để xin role)
    let caproleChannelId = null;
    try {
        caproleChannelId = db.getConfig('caprole_channel_id');
    } catch (e) { }
    const channelMention = caproleChannelId ? `<#${caproleChannelId}>` : 'kênh cấp role';

    const tips =
        `\n\n━━━━━━━━━━━━━━━\n` +
        `💡 **Cách nhận role:**\n` +
        `Gửi **tên** hoặc **mã** role (hoặc kèm **ảnh** chứng minh) vào ${channelMention}.\n` +
        `Bot sẽ nhận diện và gửi yêu cầu cho Bang Chủ duyệt ✅`;

    const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('📋 DANH SÁCH ROLE PHỤ')
        .setDescription(lines.join('\n') + tips)
        .setFooter({ text: `${codes.length} role • 📌 Bật phần ghim tin nhắn để xem hướng dẫn lấy role` })
        .setTimestamp();

    await message.channel.send({ embeds: [embed] });
}

module.exports = { execute };


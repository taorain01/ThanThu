/**
 * ?setroomcaprole - Thiết lập kênh cấp role thông minh
 * Cú pháp: ?setroomcaprole (chạy trong kênh muốn set)
 * Chỉ owner mới dùng được.
 */

const { EmbedBuilder } = require('discord.js');
const db = require('../../../database/db');
const { getRoleMappings } = require('./addrole');

const OWNER_ID = '395151484179841024';

async function execute(message, args) {
    // Chỉ owner
    if (message.author.id !== OWNER_ID) {
        return message.reply('❌ Chỉ **owner** mới được sử dụng lệnh này!');
    }

    const channelId = message.channel.id;

    // Lấy danh sách roles từ addrole system
    const mappings = getRoleMappings();
    const codes = Object.keys(mappings);

    if (codes.length === 0) {
        return message.reply('❌ Chưa có role phụ nào! Dùng `?addrole <mã> <tên>` để tạo role trước.');
    }

    // Lưu channel vào config
    db.setConfig('caprole_channel_id', channelId);

    // Tạo danh sách role để hiển thị
    const roleLines = codes.map(code => {
        const entry = mappings[code];
        const name = typeof entry === 'string' ? entry : entry.name;
        const emojiId = typeof entry === 'object' ? entry.emojiId : null;
        const icon = emojiId ? `<:sr_${code}:${emojiId}>` : '📌';
        return `${icon} \`${code}\` → **${name}**`;
    });

    const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('✅ Đã thiết lập Kênh Cấp Role')
        .setDescription(
            `Kênh <#${channelId}> đã được set làm kênh cấp role.\n\n` +
            `**Cách hoạt động:**\n` +
            `1. Thành viên gửi tin nhắn + ảnh (chứng minh)\n` +
            `2. Bot phân tích → reply kết quả\n` +
            `3. Owner reaction để duyệt\n\n` +
            `**Danh sách ${codes.length} role có thể cấp:**\n` +
            roleLines.join('\n')
        )
        .setFooter({ text: 'So khớp text tự động' })
        .setTimestamp();

    await message.channel.send({ embeds: [embed] });
}

module.exports = { execute };

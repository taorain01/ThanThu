/**
 * ?tongrole - Xem tổng số role đang có trong server
 * Chỉ OWNER_ID mới được dùng
 */

const { EmbedBuilder } = require('discord.js');

const OWNER_ID = '395151484179841024';

async function execute(message, args) {
    // Chỉ cho phép owner
    if (message.author.id !== OWNER_ID) return;

    const guild = message.guild;
    if (!guild) return;

    // Fetch tất cả role (đảm bảo cache đầy đủ)
    const roles = await guild.roles.fetch();

    // Bỏ @everyone ra khỏi danh sách
    const roleCount = roles.size - 1;

    // Phân loại role
    const managedRoles = roles.filter(r => r.managed && r.id !== guild.id); // Role bot/integration
    const normalRoles = roles.filter(r => !r.managed && r.id !== guild.id); // Role thường

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('📊 TỔNG SỐ ROLE TRONG SERVER')
        .setDescription(
            `🏠 **${guild.name}**\n\n` +
            `📋 **Tổng cộng:** \`${roleCount}\` role\n` +
            `👤 Role thường: \`${normalRoles.size}\`\n` +
            `🤖 Role bot/integration: \`${managedRoles.size}\`\n\n` +
            `⚠️ Giới hạn Discord: **250** role/server\n` +
            `📈 Đã dùng: **${((roleCount / 250) * 100).toFixed(1)}%**`
        )
        .setFooter({ text: `Còn ${250 - roleCount} slot role trống` })
        .setTimestamp();

    await message.channel.send({ embeds: [embed] });
}

module.exports = { execute };

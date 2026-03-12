/**
 * ?xoabc command - Delete current Bang Chủ
 * Usage: ?xoabc
 * Requires: "Quản Lý" role
 */

const { EmbedBuilder } = require('discord.js');
const db = require('../../database/db');

/**
 * Check if user has required role
 */
function hasRole(member, roleName) {
    return member.roles.cache.some(role => role.name === roleName);
}

/**
 * Execute xoabc command
 */
async function execute(message, args) {
    // Check permission - requires "Quản Lý" role
    if (!hasRole(message.member, 'Quản Lý')) {
        return message.channel.send('❌ Bạn không có quyền thực hiện lệnh này! Yêu cầu role: **Quản Lý**');
    }

    // Get current BC
    const currentBC = db.getUniquePositionHolder('bc');

    if (!currentBC) {
        return message.channel.send('❌ Hiện tại chưa có Bang Chủ nào!');
    }

    // Delete the BC (remove from database or just change position to mem)
    db.deleteUser(currentBC.discord_id);

    const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('👑 Đã xóa Bang Chủ!')
        .setDescription(`Đã xóa Bang Chủ: **${currentBC.discord_name}** (<@${currentBC.discord_id}>)`)
        .addFields(
            { name: '🎮 Tên Game', value: currentBC.game_username || 'Không có', inline: true },
            { name: '🆔 UID', value: currentBC.game_uid || 'Không có', inline: true }
        )
        .setFooter({ text: `Xóa bởi ${message.author.username}` })
        .setTimestamp();

    await message.channel.send({ embeds: [embed] });
}

module.exports = { execute };



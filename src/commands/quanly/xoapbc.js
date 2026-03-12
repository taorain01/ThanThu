/**
 * ?xoapbc command - Delete current Phó Bang Chủ
 * Usage: ?xoapbc
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
 * Execute xoapbc command
 */
async function execute(message, args) {
    // Check permission - requires "Quản Lý" role
    if (!hasRole(message.member, 'Quản Lý')) {
        return message.channel.send('❌ Bạn không có quyền thực hiện lệnh này! Yêu cầu role: **Quản Lý**');
    }

    // Get current PBC
    const currentPBC = db.getUniquePositionHolder('pbc');

    if (!currentPBC) {
        return message.channel.send('❌ Hiện tại chưa có Phó Bang Chủ nào!');
    }

    // Delete the PBC
    db.deleteUser(currentPBC.discord_id);

    const embed = new EmbedBuilder()
        .setColor(0xFF8800)
        .setTitle('⚔️ Đã xóa Phó Bang Chủ!')
        .setDescription(`Đã xóa Phó Bang Chủ: **${currentPBC.discord_name}** (<@${currentPBC.discord_id}>)`)
        .addFields(
            { name: '🎮 Tên Game', value: currentPBC.game_username || 'Không có', inline: true },
            { name: '🆔 UID', value: currentPBC.game_uid || 'Không có', inline: true }
        )
        .setFooter({ text: `Xóa bởi ${message.author.username}` })
        .setTimestamp();

    await message.channel.send({ embeds: [embed] });
}

module.exports = { execute };



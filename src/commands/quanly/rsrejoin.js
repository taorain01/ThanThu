/**
 * ?rsrejoin (?rsrj) command - Reset rejoin count for a member
 * Usage: ?rsrejoin @user
 * Requires: "Quản Lý" role
 */

const { EmbedBuilder } = require('discord.js');
const db = require('../../database/db');

/**
 * Check if user has Quản Lý role
 */
function hasQuanLyRole(member) {
    return member.roles.cache.some(role => role.name === 'Quản Lý');
}

/**
 * Execute rsrejoin command
 */
async function execute(message, args) {
    // Check permission - requires "Quản Lý" role only
    if (!hasQuanLyRole(message.member)) {
        return message.channel.send('❌ Bạn không có quyền thực hiện lệnh này! Yêu cầu role: **Quản Lý**');
    }

    // Parse mentioned user
    const mentionedUser = message.mentions.users.first();
    if (!mentionedUser) {
        return message.channel.send('❌ Vui lòng tag người dùng! Ví dụ: `?rsrejoin @rain`');
    }

    // Get user from database
    const userData = db.getUserByDiscordId(mentionedUser.id);

    if (!userData) {
        return message.channel.send('❌ Người dùng này chưa có trong danh sách thành viên!');
    }

    const oldRejoinCount = userData.rejoin_count || 0;

    if (oldRejoinCount === 0) {
        return message.channel.send('ℹ️ Người dùng này chưa có lượt rejoin nào để reset.');
    }

    // Reset rejoin count
    const stmt = db.db.prepare('UPDATE users SET rejoin_count = 0, updated_at = CURRENT_TIMESTAMP WHERE discord_id = ?');
    const result = stmt.run(mentionedUser.id);

    if (result.changes > 0) {
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('🔄 Đã reset Rejoin!')
            .setDescription(`Đã reset lượt rejoin của **${userData.discord_name}** (<@${mentionedUser.id}>)`)
            .addFields(
                { name: '📊 Rejoin cũ', value: `${oldRejoinCount}`, inline: true },
                { name: '📊 Rejoin mới', value: '0', inline: true }
            )
            .setFooter({ text: `Reset bởi ${message.author.username}` })
            .setTimestamp();

        await message.channel.send({ embeds: [embed] });
    } else {
        await message.channel.send('❌ Có lỗi xảy ra khi reset rejoin!');
    }
}

module.exports = { execute };



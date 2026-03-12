const { MessageFlags } = require('discord.js');
const { hasNotificationPermission, getRequiredRole } = require('./permissions');

/**
 * Kiểm tra quyền và reply nếu không có quyền
 * @param {Interaction} interaction - Discord interaction
 * @returns {boolean} - true nếu có quyền, false nếu không
 */
async function checkPermissionAndReply(interaction) {
    const member = interaction.member;

    if (!hasNotificationPermission(member)) {
        const requiredRoleId = getRequiredRole(interaction.guild.id);
        const requiredRole = interaction.guild.roles.cache.get(requiredRoleId);

        const roleName = requiredRole ? requiredRole.name : 'role yêu cầu';

        await interaction.reply({
            content: `❌ Bạn không có quyền sử dụng lệnh này! Cần role: **${roleName}**`,
            flags: MessageFlags.Ephemeral
        });

        return false;
    }

    return true;
}

module.exports = {
    checkPermissionAndReply
};



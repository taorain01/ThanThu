const { Events } = require('discord.js');
const { getRoleForReaction, isReactionRoleMessage } = require('../../utils/reactionRoleState');

module.exports = {
    name: Events.MessageReactionAdd,
    execute: async (reaction, user) => {
        // Tránh bot
        if (user.bot) return;

        // Khi khởi động lại bot, reaction có thể là partial
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.error('Something went wrong when fetching the message:', error);
                return;
            }
        }

        const messageId = reaction.message.id;
        const emojiKey = reaction.emoji.id ? reaction.emoji.id.toString() : reaction.emoji.name;

        // ============== CẤP ROLE THÔNG MINH (Gemini AI) ==============
        const { handleCaproleReaction } = require('../../utils/caproleHandler');
        const caproleHandled = await handleCaproleReaction(reaction, user, null);
        if (caproleHandled) return;

        const roleData = getRoleForReaction(messageId, emojiKey);

        // Nếu emoji không nằm trong danh sách nhưng message thuộc hệ thống reaction role → xóa reaction lạ
        if (!roleData) {
            if (isReactionRoleMessage(messageId)) {
                try {
                    await reaction.users.remove(user.id);
                } catch (e) {
                    console.error('[ReactionRole] Không thể xóa reaction lạ:', e);
                }
            }
            return;
        }

        try {
            const guild = reaction.message.guild;
            if (!guild) return;

            const member = await guild.members.fetch(user.id);
            if (!member) return;

            // Cấp role
            await member.roles.add(roleData);
            console.log(`[ReactionRole] ${user.tag} received role ${roleData}`);
        } catch (e) {
            console.error('Không thể cấp role:', e);
        }
    }
};

const { Events } = require('discord.js');
const { getRoleForReaction } = require('../../utils/reactionRoleState');

module.exports = {
    name: Events.MessageReactionRemove,
    execute: async (reaction, user) => {
        // Tránh bot
        if (user.bot) return;

        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.error('Something went wrong when fetching the message:', error);
                return;
            }
        }

        const roleData = getRoleForReaction(reaction.message.id, reaction.emoji.id ? reaction.emoji.id.toString() : reaction.emoji.name);
        if (!roleData) return;

        try {
            const guild = reaction.message.guild;
            if (!guild) return;

            const member = await guild.members.fetch(user.id);
            if (!member) return;

            // Xóa role
            await member.roles.remove(roleData);
            console.log(`[ReactionRole] \${user.tag} removed role \${roleData}`);
        } catch (e) {
            console.error('Không thể xóa role:', e);
        }
    }
};

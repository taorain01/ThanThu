/**
 * ═══════════════════════════════════════════════════════════════════════════
 * voteHandlers.js - Handlers cho các nút Vote
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Route buttons theo prefix customId:
 *   - voteevent_*    → voteevent.js
 *   - voteyentiec_*  → voteyentiec.js
 *   - voteboss_*     → votebosssolo.js
 *   - votepvp_*      → votepvpsolo.js
 *   - votegio_*      → votegioevent.js
 *   - votengay_*     → votengayevent.js
 *   - votecustom_*   → vote.js
 * 
 * Được import vào: src/events/client/interactionCreate.js
 * ═══════════════════════════════════════════════════════════════════════════
 */

const { MessageFlags } = require('discord.js');

// Lazy load commands để tránh circular dependency
const getVoteeventCommand = () => require('../commands/apps/voteevent');
const getVoteyentiecCommand = () => require('../commands/apps/voteyentiec');
const getVotebossCommand = () => require('../commands/apps/votebosssolo');
const getVotepvpCommand = () => require('../commands/apps/votepvpsolo');
const getVotegioeventCommand = () => require('../commands/apps/votegioevent');
const getVotengayeventCommand = () => require('../commands/apps/votengayevent');
const getVoteCustomCommand = () => require('../commands/apps/vote');

/**
 * Xử lý tất cả button interactions liên quan đến vote
 * @param {ButtonInteraction} interaction 
 * @param {Client} client 
 * @returns {boolean} true nếu đã xử lý, false nếu không phải handler này
 */
async function handleButton(interaction, client) {
    const customId = interaction.customId;

    try {
        // Route theo prefix - thứ tự từ cụ thể đến chung
        if (customId.startsWith('voteevent_')) {
            await getVoteeventCommand().handleButton(interaction);
            return true;
        }

        if (customId.startsWith('voteyentiec_')) {
            await getVoteyentiecCommand().handleButton(interaction);
            return true;
        }

        if (customId.startsWith('voteboss_')) {
            await getVotebossCommand().handleButton(interaction);
            return true;
        }

        if (customId.startsWith('votepvp_')) {
            await getVotepvpCommand().handleButton(interaction);
            return true;
        }

        if (customId.startsWith('votegio_')) {
            await getVotegioeventCommand().handleButton(interaction);
            return true;
        }

        if (customId.startsWith('votengay_')) {
            await getVotengayeventCommand().handleButton(interaction);
            return true;
        }

        if (customId.startsWith('votecustom_')) {
            await getVoteCustomCommand().handleButton(interaction);
            return true;
        }

        // Không phải handler của file này
        return false;

    } catch (error) {
        console.error('[voteHandlers] Error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: '❌ Có lỗi xảy ra khi xử lý vote!',
                flags: MessageFlags.Ephemeral
            });
        }
        return true;
    }
}

module.exports = {
    handleButton
};

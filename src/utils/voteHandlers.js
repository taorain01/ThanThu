/**
 * ═══════════════════════════════════════════════════════════════════════════
 * voteHandlers.js - Handlers cho các nút Vote
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Handlers:
 *   - voteevent_*     : Vote sự kiện (result, end, apply, pvpdays_btn)
 *   - voteyentiec_*   : Vote Yến Tiệc (result, end)
 *   - voteboss_*      : Vote Boss Solo (result, end)
 *   - votepvp_*       : Vote PvP Solo (result, end)
 *   - votegio_*       : Vote giờ (result, end) - legacy
 *   - votengay_*      : Vote ngày (result, end) - legacy
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

/**
 * Xử lý tất cả button interactions liên quan đến vote
 * @param {ButtonInteraction} interaction 
 * @param {Client} client 
 * @returns {boolean} true nếu đã xử lý, false nếu không phải handler này
 */
async function handleButton(interaction, client) {
    const customId = interaction.customId;

    try {
        // ═══════════════════════════════════════════════════════════════
        // Xử lý voteevent buttons (result, end, apply, pvpdays)
        // ═══════════════════════════════════════════════════════════════
        if (customId === 'voteevent_result' || customId === 'voteevent_end' ||
            customId === 'voteevent_apply' || customId === 'voteevent_pvpdays_btn') {
            await getVoteeventCommand().handleButton(interaction);
            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // Xử lý voteyentiec buttons
        // ═══════════════════════════════════════════════════════════════
        if (customId === 'voteyentiec_result' || customId === 'voteyentiec_end' || customId === 'voteyentiec_voters') {
            await getVoteyentiecCommand().handleButton(interaction);
            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // Xử lý votebosssolo buttons
        // ═══════════════════════════════════════════════════════════════
        if (customId === 'voteboss_result' || customId === 'voteboss_end') {
            await getVotebossCommand().handleButton(interaction);
            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // Xử lý votepvpsolo buttons
        // ═══════════════════════════════════════════════════════════════
        if (customId === 'votepvp_result' || customId === 'votepvp_end') {
            await getVotepvpCommand().handleButton(interaction);
            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // Xử lý votegio buttons (result, end) - legacy
        // ═══════════════════════════════════════════════════════════════
        if (customId === 'votegio_result' || customId === 'votegio_end') {
            await getVotegioeventCommand().handleButton(interaction);
            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // Xử lý votengay buttons (result, end) - legacy
        // ═══════════════════════════════════════════════════════════════
        if (customId === 'votengay_result' || customId === 'votengay_end') {
            await getVotengayeventCommand().handleButton(interaction);
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
        return true; // Đã xử lý lỗi
    }
}

module.exports = {
    handleButton
};

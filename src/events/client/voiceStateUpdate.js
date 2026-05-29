/**
 * Voice State Update Event
 * Xử lý khi user vào/ra voice channel
 */

// Booster Voice Room handlers
const boosterVoiceHandlers = require('../../utils/boosterVoiceHandlers');

module.exports = {
    name: 'voiceStateUpdate',
    async execute(oldState, newState) {
        const joinedChannel = newState.channelId;
        const leftChannel = oldState.channelId;
        const userId = newState.id;

        // ═══════════════════════════════════════════════════
        // BOOSTER VOICE ROOM — Join/Leave
        // ═══════════════════════════════════════════════════

        // User vào voice channel
        if (joinedChannel && joinedChannel !== leftChannel) {
            try {
                const channel = newState.channel;
                if (channel) {
                    await boosterVoiceHandlers.handleVoiceJoin(channel, userId);
                }
            } catch (e) {
                console.error('[voiceStateUpdate] Booster join error:', e.message);
            }
        }

        // User rời voice channel
        if (leftChannel && leftChannel !== joinedChannel) {
            try {
                const channel = oldState.channel;
                if (channel) {
                    await boosterVoiceHandlers.handleVoiceLeave(channel, userId);
                }
            } catch (e) {
                console.error('[voiceStateUpdate] Booster leave error:', e.message);
            }
        }

    }
};

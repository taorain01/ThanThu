/**
 * Voice State Update Event
 * Xử lý khi user vào/ra voice channel
 */

const MOON_VOICE_CHANNEL_ID = '1463941874531303526';
const MOON_USER_ID = '1380596282246037504';

// Track last hint message to delete old one
let lastHintMessageId = null;

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

        // ═══════════════════════════════════════════════════
        // MOON VOICE CHANNEL — Hint message
        // ═══════════════════════════════════════════════════
        if (userId === MOON_USER_ID && joinedChannel === MOON_VOICE_CHANNEL_ID && leftChannel !== MOON_VOICE_CHANNEL_ID) {
            try {
                const channel = newState.channel;
                if (!channel) return;

                // Xóa hint cũ nếu có
                if (lastHintMessageId) {
                    try {
                        const oldMsg = await channel.messages.fetch(lastHintMessageId).catch(() => null);
                        if (oldMsg) await oldMsg.delete();
                    } catch (e) { /* Ignore */ }
                }

                const hintMessage = `🌙 **Chào <@${MOON_USER_ID}>!** Đây là các lệnh bạn có thể dùng:

📌 **Lệnh Moon:**
\`?moon @user\` hoặc \`?moon tên\` - Cho phép user **thấy và kết nối** vào voice này
\`?xmoon @user\` hoặc \`?xmoon tên\` - **Xóa quyền** thấy và kết nối của user

💡 **Ví dụ:**
• \`?moon rain\` - Cấp quyền cho user có tên "rain"
• \`?xmoon rain\` - Xóa quyền của user có tên "rain"
• \`?moon 123456789\` - Cấp quyền bằng ID`;

                const sent = await channel.send(hintMessage);
                lastHintMessageId = sent.id;
            } catch (error) {
                console.error('[voiceStateUpdate] Lỗi gửi hint Moon:', error.message);
            }
        }
    }
};

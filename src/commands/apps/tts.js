/**
 * TTS Commands - ?join, ?leave, ?stop
 * Control bot voice channel for TTS
 */

const ttsService = require('../../utils/ttsService');

// Các câu joke khi bot không join được voice
const JOIN_FAIL_JOKES = [
    '🤧 Đại Ngỗng bị ho, có vẻ không mở mồm được..',
    '😵‍💫 Đại Ngỗng say quá, lết vào phòng không nổi...',
    '💀 Đại Ngỗng đang nằm viện, hẹn lúc khác nhé...',
    '🦆 Đại Ngỗng bị mất giọng rồi, cạp cạp không ra tiếng...',
    '😴 Đại Ngỗng ngủ quên, gọi hoài không dậy...',
    '🏃 Đại Ngỗng chạy lạc đường vào phòng rồi...',
    '🫠 Đại Ngỗng đang tan chảy, thử lại sau nhé...',
    '🤐 Đại Ngỗng bị dán băng keo miệng, không nói được...',
];

function getRandomJoke() {
    return JOIN_FAIL_JOKES[Math.floor(Math.random() * JOIN_FAIL_JOKES.length)];
}

async function execute(message, args) {
    const command = message.content.slice(1).split(/\s+/)[0].toLowerCase();

    switch (command) {
        case 'join':
            return handleJoin(message);
        case 'leave':
            return handleLeave(message);
        case 'stop':
            return handleStop(message);
        default:
            return;
    }
}

/**
 * Kiểm tra một channel có phải "phòng kín" không
 * (everyone không có quyền ViewChannel)
 */
function isPrivateChannel(channel) {
    if (!channel) return false;
    return !channel.permissionsFor(channel.guild.roles.everyone).has('ViewChannel');
}

/**
 * Handle ?join command
 */
async function handleJoin(message) {
    const voiceChannel = message.member?.voice?.channel;

    if (!voiceChannel) {
        return message.reply('❌ Bạn cần vào voice channel trước!');
    }

    // Kiểm tra bot đang ở voice channel khác
    const currentConnection = ttsService.getConnection(message.guild.id);
    if (currentConnection) {
        // Kiểm tra connection có thực sự hoạt động không
        const { VoiceConnectionStatus } = require('@discordjs/voice');
        const isAlive = currentConnection.state.status === VoiceConnectionStatus.Ready
                     || currentConnection.state.status === VoiceConnectionStatus.Signalling
                     || currentConnection.state.status === VoiceConnectionStatus.Connecting;

        if (!isAlive) {
            // Connection "chết" (Disconnected/Destroyed) → dọn dẹp và cho join lại
            console.log(`[TTS] Connection cũ status: ${currentConnection.state.status} → destroy và join lại`);
            try { currentConnection.destroy(); } catch (e) { }
            // Tiếp tục xuống phần join bình thường
        } else {
            const currentChannelId = currentConnection.joinConfig.channelId;

            // Đã ở cùng phòng → thông báo
            if (currentChannelId === voiceChannel.id) {
                return message.reply(`🎤 Đại Ngỗng đã ở **${voiceChannel.name}** rồi! Gõ \`.nội dung\` để bot đọc.`);
            }

            // Đang ở phòng khác → kiểm tra phòng đó có người thật không
            const currentChannel = message.guild.channels.cache.get(currentChannelId);
            const membersInCurrent = currentChannel?.members;

            // Phòng được coi là "chỉ có bot" nếu không có member nào là người (user.bot = false)
            const hasHuman = membersInCurrent
                ? membersInCurrent.some(m => !m.user.bot)
                : false;

            if (hasHuman) {
                // Phòng đang có người thật → không tự chuyển
                // Nếu phòng kín → ẩn tên phòng
                if (isPrivateChannel(currentChannel)) {
                    return message.reply(`🦆 Đại Ngỗng đang bận ở một phòng riêng tư rồi! Gõ \`?leave\` ở phòng đó trước nhé~`);
                } else {
                    const channelName = currentChannel?.name || 'một phòng khác';
                    return message.reply(`🦆 Đại Ngỗng đang ở **${channelName}** rồi! Gõ \`?leave\` ở phòng đó trước hoặc chờ Đại Ngỗng rời đi nhé~`);
                }
            }

            // Phòng chỉ có bot (hoặc trống) → tự động leave và join phòng người dùng
            console.log(`[TTS] Phòng ${currentChannelId} chỉ có bots → tự leave và join ${voiceChannel.id}`);
            try { ttsService.leaveChannel(message.guild.id); } catch (e) { }
            // Tiếp tục xuống phần join bình thường
        }
    }

    // Chỉ chặn bot TTS, KHÔNG bao gồm bot nhạc (Bakabot, v.v.)
    const TTS_BOTS = [
        '1484078950312316968', // Tiểu Ngỗng
        '513423712582762502'   // TTS Bot
    ];

    const botsInChannel = voiceChannel.members.filter(m => TTS_BOTS.includes(m.id));
    if (botsInChannel.size > 0) {
        const botNames = botsInChannel.map(m => m.displayName).join(', ');
        return message.reply(`🚫 Phòng đã có **${botNames}** rồi! Mỗi bot 1 phòng thôi nha~`);
    }

    // Check bot permissions
    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (!permissions.has('Connect') || !permissions.has('Speak')) {
        return message.reply('❌ Bot không có quyền vào voice channel này!');
    }

    try {
        await ttsService.joinChannel(voiceChannel);
        await message.reply(`🎤 Đã vào **${voiceChannel.name}**! Gõ \`.nội dung\` để bot đọc.`);
    } catch (error) {
        console.error('[TTS] Join error:', error.message);
        await message.reply(getRandomJoke());
    }
}

/**
 * Handle ?leave command
 */
async function handleLeave(message) {
    if (!ttsService.isConnected(message.guild.id)) {
        return; // Im lặng nếu bot không ở trong voice
    }

    ttsService.leaveChannel(message.guild.id);
    await message.reply('👋 Đã rời voice channel!');
}

/**
 * Handle ?stop command
 */
async function handleStop(message) {
    if (!ttsService.isConnected(message.guild.id)) {
        return message.reply('❌ Bot không ở trong voice channel nào!');
    }

    ttsService.stop(message.guild.id);
    await message.reply('⏹️ Đã dừng đọc!');
}

module.exports = {
    name: 'join',
    aliases: ['leave', 'stop'],
    execute
};

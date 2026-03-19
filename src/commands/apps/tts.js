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
 * Handle ?join command
 */
async function handleJoin(message) {
    const voiceChannel = message.member?.voice?.channel;

    if (!voiceChannel) {
        return message.reply('❌ Bạn cần vào voice channel trước!');
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
        return message.reply('❌ Bot không ở trong voice channel nào!');
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

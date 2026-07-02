/**
 * TTS Commands - ?join, ?leave, ?stop
 * Control bot voice channel for TTS
 */

const { executeTtsCommand } = require('../../utils/ttsCommandHelper');

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

async function execute(message, args) {
    return executeTtsCommand(message, args, {
        prefix: process.env.PREFIX || '?',
        botName: 'Đại Ngỗng',
        joinFailMessages: JOIN_FAIL_JOKES,
        silentLeaveWhenDisconnected: true
    });
}

module.exports = {
    name: 'join',
    aliases: ['leave', 'stop'],
    execute
};

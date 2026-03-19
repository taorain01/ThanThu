/**
 * TTS Commands - ?join, ?leave, ?stop
 * Control bot voice channel for TTS
 */

const ttsService = require('../../utils/ttsService');

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
        // Chỉ log message, không log full stack trace để tránh spam
        const isTimeout = error.code === 'ABORT_ERR' || error.message?.includes('aborted');
        if (isTimeout) {
            console.log('[TTS] Join error: Voice connection timeout (hosting có thể không hỗ trợ voice)');
            await message.reply('❌ Không thể kết nối voice! Bot timeout khi cố join channel.\n> *Nguyên nhân có thể: hosting không hỗ trợ kết nối voice (UDP bị chặn).*');
        } else {
            console.error('[TTS] Join error:', error.message);
            await message.reply('❌ Không thể vào voice channel!');
        }
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

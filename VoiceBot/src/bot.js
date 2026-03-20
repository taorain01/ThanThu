require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

const token = process.env.TOKEN;
const prefix = process.env.PREFIX || '!';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

const ttsService = require('./utils/ttsService');

// Các câu joke khi bot không join được voice
const JOIN_FAIL_JOKES = [
    '🤧 Tiểu Ngỗng bị ho, có vẻ không mở mồm được..',
    '😵‍💫 Tiểu Ngỗng say quá, lết vào phòng không nổi...',
    '💀 Tiểu Ngỗng đang nằm viện, hẹn lúc khác nhé...',
    '🦆 Tiểu Ngỗng bị mất giọng rồi, cạp cạp không ra tiếng...',
    '😴 Tiểu Ngỗng ngủ quên, gọi hoài không dậy...',
    '🏃 Tiểu Ngỗng chạy lạc đường vào phòng rồi...',
    '🫠 Tiểu Ngỗng đang tan chảy, thử lại sau nhé...',
    '🤐 Tiểu Ngỗng bị dán băng keo miệng, không nói được...',
];

function getRandomJoke() {
    return JOIN_FAIL_JOKES[Math.floor(Math.random() * JOIN_FAIL_JOKES.length)];
}

client.once('ready', () => {
    console.log(`✅ Voice Bot đã online: ${client.user.tag}`);
    client.user.setActivity('Mình đi đâu thế bố ơi', { type: 4 });
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const guildId = message.guild?.id;
    if (!guildId) return;

    // ============== TTS AUTO-READ (tin nhắn bắt đầu bằng .) ==============
    if (message.content.startsWith('.') && message.content.length > 1) {
        if (ttsService.isConnected(guildId)) {
            // Kiểm tra user có trong cùng voice channel với bot không
            const botConnection = ttsService.getConnection(guildId);
            const userVoiceChannel = message.member?.voice?.channel;

            if (botConnection && userVoiceChannel && botConnection.joinConfig.channelId === userVoiceChannel.id) {
                const textToSpeak = message.content.slice(1).trim();
                if (textToSpeak) {
                    ttsService.speak(guildId, textToSpeak);
                }
            }
            return;
        }
    }

    // ============== COMMANDS ==============
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/\s+/);
    const command = args.shift().toLowerCase();

    // !join - Vào voice channel (cần bot ưu tiên có trước)
    // !jointieungong / !join tieungong - Bắt buộc vào, bỏ qua kiểm tra
    const isJoinCmd = command === 'join' || command === 'jointieungong';
    const forceJoin = command === 'jointieungong' || (command === 'join' && args[0]?.toLowerCase() === 'tieungong');
    
    if (isJoinCmd || forceJoin) {
        const voiceChannel = message.member?.voice?.channel;

        if (!voiceChannel) {
            return message.reply('❌ Bạn cần vào voice channel trước!');
        }

        // Kiểm tra bot đang ở voice channel khác → im lặng
        const currentConnection = ttsService.getConnection(guildId);
        if (currentConnection) {
            const currentChannelId = currentConnection.joinConfig.channelId;
            if (currentChannelId !== voiceChannel.id) {
                return; // Im lặng, không phản hồi
            }
            // Đã ở cùng phòng
            return message.reply(`🎤 Tiểu Ngỗng đã ở **${voiceChannel.name}** rồi! Gõ \`.nội dung\` để bot đọc.`);
        }

        // Chỉ chặn bot TTS, KHÔNG bao gồm bot nhạc (Bakabot, v.v.)
        if (!forceJoin) {
            const TTS_BOTS = [
                '1249314016371675258', // Đại Ngỗng
                '513423712582762502'   // TTS Bot
            ];
            const botsInChannel = voiceChannel.members.filter(m => TTS_BOTS.includes(m.id));
            
            if (botsInChannel.size > 0) {
                const botNames = botsInChannel.map(m => m.displayName).join(', ');
                return message.reply(`🚫 Phòng đã có **${botNames}** rồi! Mỗi bot 1 phòng thôi nha~`);
            }
        }

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

    // !leave / !leavetieungong - Rời voice channel
    if (command === 'leave' || command === 'leavetieungong') {
        if (!ttsService.isConnected(guildId)) {
            return; // Im lặng nếu bot không ở trong voice
        }

        ttsService.leaveChannel(guildId);
        await message.reply('👋 Tiểu Ngỗng rời phòng!');
    }

    // !stop / !stoptieungong - Dừng đọc
    if (command === 'stop' || command === 'stoptieungong') {
        if (!ttsService.isConnected(guildId)) {
            return message.reply('❌ Bot không ở trong voice channel nào!');
        }

        ttsService.stop(guildId);
        await message.reply('⏹️ Tiểu Ngỗng ngậm mồm!');
    }
});

client.login(token);

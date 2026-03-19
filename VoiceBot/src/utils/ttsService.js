/**
 * TTS Service - Vietnamese Text-to-Speech
 * Uses Google TTS API for Vietnamese voice
 */

const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState,
    getVoiceConnection
} = require('@discordjs/voice');
const googleTTS = require('google-tts-api');
const { Readable } = require('stream');

// === KIỂM TRA THƯ VIỆN ENCRYPTION KHI KHỞI ĐỘNG ===
console.log('[TTS-DEBUG] Kiểm tra thư viện encryption...');
try {
    require('@snazzah/davey');
    console.log('[TTS-DEBUG] ✅ @snazzah/davey - OK');
} catch (e) {
    console.log('[TTS-DEBUG] ❌ @snazzah/davey - KHÔNG TÌM THẤY:', e.message);
}
try {
    require('sodium-native');
    console.log('[TTS-DEBUG] ✅ sodium-native - OK');
} catch (e) {
    console.log('[TTS-DEBUG] ❌ sodium-native - KHÔNG TÌM THẤY:', e.message);
}

// Store audio players per guild
const players = new Map();

/**
 * Get or create audio player for a guild
 */
function getPlayer(guildId) {
    if (!players.has(guildId)) {
        const player = createAudioPlayer();
        players.set(guildId, player);
    }
    return players.get(guildId);
}

/**
 * Check if bot is connected to voice in a guild
 */
function isConnected(guildId) {
    const connection = getVoiceConnection(guildId);
    return connection && connection.state.status === VoiceConnectionStatus.Ready;
}

/**
 * Join a voice channel - có debug log chi tiết
 */
async function joinChannel(voiceChannel) {
    console.log(`[TTS-DEBUG] === BẮT ĐẦU JOIN VOICE ===`);
    console.log(`[TTS-DEBUG] Channel: ${voiceChannel.name} (${voiceChannel.id})`);
    console.log(`[TTS-DEBUG] Guild: ${voiceChannel.guild.name} (${voiceChannel.guild.id})`);

    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false
    });

    // Log mọi thay đổi trạng thái connection
    // Nếu bị disconnect (kick), hủy connection luôn để không tự rejoin
    connection.on('stateChange', (oldState, newState) => {
        console.log(`[TTS-DEBUG] Connection state: ${oldState.status} → ${newState.status}`);
        if (newState.status === VoiceConnectionStatus.Disconnected) {
            console.log(`[TTS-DEBUG] ⚠️ Bị disconnect! Reason:`, newState.reason || 'không rõ');
            // Hủy connection, ngăn thư viện tự động reconnect
            connection.destroy();
            players.delete(voiceChannel.guild.id);
            console.log(`[TTS-DEBUG] 🛑 Đã hủy connection, không tự rejoin.`);
        }
    });

    connection.on('error', (error) => {
        console.error(`[TTS-DEBUG] ❌ Connection error:`, error.message);
        console.error(`[TTS-DEBUG] Error stack:`, error.stack);
    });

    try {
        console.log(`[TTS-DEBUG] Đang chờ Ready state (timeout 30s)...`);
        await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
        console.log(`[TTS-DEBUG] ✅ Joined thành công: ${voiceChannel.name}`);

        // Subscribe player to connection
        const player = getPlayer(voiceChannel.guild.id);
        connection.subscribe(player);

        return connection;
    } catch (error) {
        console.error(`[TTS-DEBUG] ❌ Join THẤT BẠI sau 30s!`);
        console.error(`[TTS-DEBUG] Error name: ${error.name}`);
        console.error(`[TTS-DEBUG] Error message: ${error.message}`);
        console.error(`[TTS-DEBUG] Connection state cuối: ${connection.state.status}`);
        console.error(`[TTS-DEBUG] Full error:`, error);
        connection.destroy();
        throw error;
    }
}

/**
 * Leave voice channel
 */
function leaveChannel(guildId) {
    const connection = getVoiceConnection(guildId);
    if (connection) {
        connection.destroy();
        players.delete(guildId);
        console.log(`[TTS] Left voice channel in guild: ${guildId}`);
    }
}

/**
 * Stop current playback
 */
function stop(guildId) {
    const player = players.get(guildId);
    if (player) {
        player.stop();
    }
}

/**
 * Speak text in Vietnamese
 */
async function speak(guildId, text) {
    if (!isConnected(guildId)) {
        return false;
    }

    if (!text || text.trim().length === 0) {
        return false;
    }

    // Limit text length (Google TTS limit)
    const maxLength = 200;
    const textToSpeak = text.length > maxLength ? text.substring(0, maxLength) : text;

    try {
        // Get audio URL from Google TTS
        const audioUrl = googleTTS.getAudioUrl(textToSpeak, {
            lang: 'vi',
            slow: false,
            host: 'https://translate.google.com'
        });

        // Fetch audio stream
        const response = await fetch(audioUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch audio: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const stream = Readable.from(buffer);

        // Create and play audio resource
        const resource = createAudioResource(stream, {
            inputType: 'arbitrary'
        });

        const player = getPlayer(guildId);
        player.play(resource);

        console.log(`[TTS] Speaking: "${textToSpeak.substring(0, 50)}..."`);
        return true;
    } catch (error) {
        console.error('[TTS] Error speaking:', error.message);
        return false;
    }
}

/**
 * Get voice connection for a guild
 */
function getConnection(guildId) {
    return getVoiceConnection(guildId);
}

module.exports = {
    joinChannel,
    leaveChannel,
    speak,
    stop,
    isConnected,
    getConnection
};

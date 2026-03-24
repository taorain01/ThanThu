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
const storage = require('./storage');

// Store audio players per guild
const players = new Map();

/**
 * Get or create audio player for a guild
 * @param {string} guildId 
 * @returns {AudioPlayer}
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
 * @param {string} guildId 
 * @returns {boolean}
 */
function isConnected(guildId) {
    const connection = getVoiceConnection(guildId);
    return connection && connection.state.status === VoiceConnectionStatus.Ready;
}

/**
 * Join a voice channel
 * @param {VoiceChannel} voiceChannel 
 * @returns {VoiceConnection}
 */
async function joinChannel(voiceChannel) {
    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false
    });
    // Nếu bị disconnect (kick), hủy connection luôn để không tự rejoin
    connection.on('stateChange', (oldState, newState) => {
        console.log(`[TTS] Connection state: ${oldState.status} → ${newState.status}`);
        if (newState.status === VoiceConnectionStatus.Disconnected) {
            console.log(`[TTS] ⚠️ Bị disconnect! Hủy connection, không tự rejoin.`);
            storage.removeVoiceState(voiceChannel.guild.id);
            connection.destroy();
            players.delete(voiceChannel.guild.id);
        }
    });

    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
        console.log(`[TTS] Joined voice channel: ${voiceChannel.name}`);

        // Lưu voice state để restore khi restart
        storage.saveVoiceState(voiceChannel.guild.id, voiceChannel.id);

        // Subscribe player to connection
        const player = getPlayer(voiceChannel.guild.id);
        connection.subscribe(player);

        return connection;
    } catch (error) {
        connection.destroy();
        throw error;
    }
}

/**
 * Leave voice channel
 * @param {string} guildId 
 */
function leaveChannel(guildId) {
    const connection = getVoiceConnection(guildId);
    if (connection) {
        // Xóa voice state khi rời channel
        storage.removeVoiceState(guildId);
        connection.destroy();
        players.delete(guildId);
        console.log(`[TTS] Left voice channel in guild: ${guildId}`);
    }
}

/**
 * Stop current playback
 * @param {string} guildId 
 */
function stop(guildId) {
    const player = players.get(guildId);
    if (player) {
        player.stop();
    }
}
// Hàng đợi TTS per guild - đọc xong câu này mới tới câu tiếp
const queues = new Map();

/**
 * Xử lý hàng đợi - đọc từng câu một
 */
async function processQueue(guildId) {
    const queue = queues.get(guildId);
    if (!queue || queue.processing || queue.items.length === 0) return;

    queue.processing = true;

    while (queue.items.length > 0) {
        if (!isConnected(guildId)) {
            queue.items = [];
            break;
        }

        const text = queue.items.shift();
        try {
            await playText(guildId, text);
        } catch (error) {
            console.error('[TTS] Queue error:', error.message);
        }
    }

    queue.processing = false;
}

/**
 * Phát 1 câu và chờ đọc xong
 */
function playText(guildId, text) {
    return new Promise(async (resolve) => {
        try {
            const player = getPlayer(guildId);
            console.log(`[TTS] Player state trước khi play: ${player.state.status}`);

            const audioUrl = googleTTS.getAudioUrl(text, {
                lang: 'vi',
                slow: false,
                host: 'https://translate.google.com'
            });

            console.log(`[TTS] Fetching audio cho: "${text.substring(0, 30)}"`);
            const response = await fetch(audioUrl);
            if (!response.ok) throw new Error(`Failed to fetch audio: ${response.status}`);

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            console.log(`[TTS] Audio buffer size: ${buffer.length} bytes`);
            const stream = Readable.from(buffer);

            const resource = createAudioResource(stream, { inputType: 'arbitrary' });

            // Kiểm tra connection còn subscribe player không
            const connection = getVoiceConnection(guildId);
            if (connection) {
                console.log(`[TTS] Connection state: ${connection.state.status}, subscription: ${connection.state.subscription ? 'có' : 'KHÔNG CÓ'}`);
                // Re-subscribe nếu mất subscription
                if (!connection.state.subscription) {
                    console.log(`[TTS] ⚠️ Mất subscription! Re-subscribe...`);
                    connection.subscribe(player);
                }
            } else {
                console.log(`[TTS] ❌ Không có connection!`);
            }

            // Lắng nghe khi đọc xong → resolve
            const onIdle = () => {
                player.removeListener(AudioPlayerStatus.Idle, onIdle);
                player.removeListener('error', onError);
                resolve();
            };
            const onError = (err) => {
                console.error('[TTS] Player error:', err.message);
                player.removeListener(AudioPlayerStatus.Idle, onIdle);
                player.removeListener('error', onError);
                resolve();
            };

            player.on(AudioPlayerStatus.Idle, onIdle);
            player.on('error', onError);
            player.play(resource);

            console.log(`[TTS] Speaking: "${text.substring(0, 50)}..."`);
        } catch (error) {
            console.error('[TTS] PlayText error:', error.message);
            resolve();
        }
    });
}

/**
 * Speak text in Vietnamese (có hàng đợi)
 * @param {string} guildId 
 * @param {string} text - Text to speak
 */
async function speak(guildId, text) {
    console.log(`[TTS] speak() được gọi, guildId: ${guildId}, connected: ${isConnected(guildId)}`);
    if (!isConnected(guildId)) {
        console.log(`[TTS] ❌ Không connected → bỏ qua`);
        return false;
    }

    if (!text || text.trim().length === 0) {
        console.log(`[TTS] ❌ Text rỗng → bỏ qua`);
        return false;
    }

    const maxLength = 200;
    const textToSpeak = text.length > maxLength ? text.substring(0, maxLength) : text;

    // Thêm vào hàng đợi
    if (!queues.has(guildId)) {
        queues.set(guildId, { items: [], processing: false });
    }
    const queue = queues.get(guildId);
    queue.items.push(textToSpeak);
    console.log(`[TTS] Đã thêm vào queue, queue size: ${queue.items.length}, processing: ${queue.processing}`);

    // Bắt đầu xử lý nếu chưa đang xử lý
    processQueue(guildId);
    return true;
}

/**
 * Get voice connection for a guild
 * @param {string} guildId 
 * @returns {VoiceConnection|undefined}
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

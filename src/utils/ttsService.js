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
 * Join a voice channel (có retry logic)
 * @param {VoiceChannel} voiceChannel 
 * @param {object} options - { maxRetries: số lần thử, isRestore: có phải restore không }
 * @returns {VoiceConnection}
 */
async function joinChannel(voiceChannel, options = {}) {
    const maxRetries = options.maxRetries || 3;
    const isRestore = options.isRestore || false;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Hủy connection cũ nếu có (tránh trùng lặp)
            const existingConnection = getVoiceConnection(voiceChannel.guild.id);
            if (existingConnection) {
                try { existingConnection.destroy(); } catch (_) {}
            }

            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: false
            });

            // Timeout 15s thay vì 30s, vì 30s quá lâu mà thường nếu ok sẽ join trong vài giây
            await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
            console.log(`[TTS] Joined voice channel: ${voiceChannel.name}${attempt > 1 ? ` (lần thử ${attempt})` : ''}`);

            // Lưu voice state để restore khi restart
            storage.saveVoiceState(voiceChannel.guild.id, voiceChannel.id);

            // Subscribe player to connection
            const player = getPlayer(voiceChannel.guild.id);
            connection.subscribe(player);

            // Xử lý khi connection bị ngắt bất ngờ
            connection.on(VoiceConnectionStatus.Disconnected, async () => {
                try {
                    // Chờ xem có tự reconnect không (5s)
                    await Promise.race([
                        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                        entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
                    ]);
                    // Đang tự reconnect, chờ tiếp
                    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
                    console.log(`[TTS] Reconnected to voice channel: ${voiceChannel.name}`);
                } catch (_) {
                    // Không thể reconnect → cleanup
                    console.log(`[TTS] Connection lost, cleaning up: ${voiceChannel.name}`);
                    try { connection.destroy(); } catch (_) {}
                    storage.removeVoiceState(voiceChannel.guild.id);
                    players.delete(voiceChannel.guild.id);
                }
            });

            connection.on(VoiceConnectionStatus.Destroyed, () => {
                // Cleanup khi connection bị destroy
                players.delete(voiceChannel.guild.id);
            });

            return connection;
        } catch (error) {
            lastError = error;
            const isAbortError = error.code === 'ABORT_ERR' || error.message?.includes('aborted');

            if (isAbortError && attempt < maxRetries) {
                console.log(`[TTS] Join timeout (lần ${attempt}/${maxRetries}), thử lại sau ${attempt * 2}s...`);
                await new Promise(r => setTimeout(r, attempt * 2000));
            } else if (!isAbortError) {
                // Lỗi khác (không phải timeout) → không retry
                break;
            }
        }
    }

    // Tất cả retry đều thất bại
    const logPrefix = isRestore ? '[TTS] Restore failed' : '[TTS] Join failed';
    console.error(`${logPrefix} sau ${maxRetries} lần thử:`, lastError?.message || lastError);

    // Cleanup connection nếu còn sót
    const leftover = getVoiceConnection(voiceChannel.guild.id);
    if (leftover) {
        try { leftover.destroy(); } catch (_) {}
    }

    throw lastError;
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

/**
 * Speak text in Vietnamese
 * @param {string} guildId 
 * @param {string} text - Text to speak
 */
async function speak(guildId, text) {
    if (!isConnected(guildId)) {
        console.log('[TTS] Not connected to voice channel');
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

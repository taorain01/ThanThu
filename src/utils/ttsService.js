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

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { VoiceConnectionStatus } = require('@discordjs/voice');
const ttsService = require('./ttsService');

const FALLBACK_TTS_BOT_IDS = [
    '1249314016371675258', // Bot 1 - Đại Ngỗng
    '1484078950312316968', // Bot 2 - Tiểu Ngỗng
    '1484855462233899150'  // Bot 3 - Chiến Ngỗng
];

const DEFAULT_RELAY_BLOCK_MESSAGE = '🔇 Voice relay đang bật. Hãy tắt relay trước khi dùng TTS.';

function getConfiguredTtsBotIds(options = {}) {
    const env = options.env || process.env;
    const currentBotId = normalizeDiscordId(options.currentBotId);
    const configuredIds = parseIdList(env.TTS_BOT_IDS);
    const ids = configuredIds.length > 0 ? configuredIds : [...FALLBACK_TTS_BOT_IDS];

    if (currentBotId) ids.push(currentBotId);
    return [...new Set(ids.map(normalizeDiscordId).filter(Boolean))];
}

function parseIdList(raw) {
    return String(raw || '')
        .split(/[,\s]+/)
        .map(normalizeDiscordId)
        .filter(Boolean);
}

function normalizeDiscordId(value) {
    const id = String(value || '').trim();
    return /^\d{15,25}$/.test(id) ? id : '';
}

function isRelayTtsBlocked(clientOrRuntime) {
    const runtime = clientOrRuntime?.voiceRelay || clientOrRuntime;
    return runtime?.enabled === true && runtime?.config?.relay_enabled === true;
}

function findOtherTtsBotsInChannel(channel, options = {}) {
    const currentBotId = normalizeDiscordId(options.currentBotId);
    const ttsBotIds = new Set(
        (options.ttsBotIds || getConfiguredTtsBotIds({ currentBotId })).map(normalizeDiscordId).filter(Boolean)
    );

    return collectionValues(channel?.members).filter((member) => {
        const memberId = normalizeDiscordId(getMemberId(member));
        return memberId && memberId !== currentBotId && ttsBotIds.has(memberId);
    });
}

function canJoinTtsChannel(channel, options = {}) {
    const blockers = findOtherTtsBotsInChannel(channel, options);
    return {
        allowed: blockers.length === 0,
        blockers
    };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Thời gian mỗi bậc "backup" chờ trước khi thế chỗ bot ưu tiên hơn (nếu bot đó offline/không vào được).
const SMART_JOIN_BACKUP_STEP_MS = 2500;

// Thứ tự ưu tiên các bot TTS (bot đứng trước được ưu tiên vào phòng trước).
function getTtsBotPriority(options = {}) {
    const env = options.env || process.env;
    const currentBotId = normalizeDiscordId(options.currentBotId);
    const ordered = parseIdList(env.TTS_BOT_PRIORITY);
    const ids = ordered.length > 0 ? ordered : getConfiguredTtsBotIds({ env, currentBotId });
    return [...new Set(ids.map(normalizeDiscordId).filter(Boolean))];
}

// Kênh voice hiện tại của một bot (quan sát qua voice state của guild — mọi bot đều thấy được).
function getBotVoiceChannelId(guild, botId) {
    const id = normalizeDiscordId(botId);
    if (!id) return null;
    const voiceState = guild?.voiceStates?.cache?.get?.(id);
    return voiceState?.channelId || null;
}

function voiceChannelHasHumanById(guild, channelId) {
    if (!channelId) return false;
    const channel = guild?.channels?.cache?.get?.(channelId);
    return channelHasHuman(channel);
}

// Bot đang ở trong phòng target (nếu có).
function findTtsBotInChannel(guild, channelId, ttsBotIds) {
    return ttsBotIds.find((id) => getBotVoiceChannelId(guild, id) === channelId) || null;
}

// Bot "bận" = đang ở một phòng khác target và phòng đó còn người thật.
function isBotBusyElsewhere(guild, botId, targetChannelId) {
    const channelId = getBotVoiceChannelId(guild, botId);
    if (!channelId) return false;                 // không ở voice → rảnh
    if (channelId === targetChannelId) return false;
    return voiceChannelHasHumanById(guild, channelId);
}

/**
 * Quyết định hành động cho bot HIỆN TẠI khi có lệnh ?join chung (pool 3 bot).
 * Trả về { action, ... } với action:
 *   - 'already-here'  : chính bot này đang ở phòng target
 *   - 'occupied'      : phòng target đã có bot TTS khác (bot này im lặng)
 *   - 'busy-self'     : bot này đang bận phòng khác (im lặng, nhường bot khác)
 *   - 'all-busy'      : không bot nào rảnh
 *   - 'join'          : bot này nên vào (kèm myPos = thứ hạng trong danh sách bot rảnh)
 */
function decideSmartJoin({ guild, targetChannel, myBotId, env }) {
    const ttsBotIds = getConfiguredTtsBotIds({ env, currentBotId: myBotId });
    const priority = getTtsBotPriority({ env, currentBotId: myBotId });
    const rankOf = (id) => {
        const index = priority.indexOf(normalizeDiscordId(id));
        return index === -1 ? 999 : index;
    };
    const me = normalizeDiscordId(myBotId);
    const targetId = targetChannel.id;

    const botInTarget = findTtsBotInChannel(guild, targetId, ttsBotIds);
    if (botInTarget) {
        return botInTarget === me ? { action: 'already-here' } : { action: 'occupied', by: botInTarget };
    }

    const freeBots = ttsBotIds
        .filter((id) => !isBotBusyElsewhere(guild, id, targetId))
        .sort((a, b) => rankOf(a) - rankOf(b));

    if (freeBots.length === 0) return { action: 'all-busy' };

    const myPos = freeBots.indexOf(me);
    if (myPos === -1) return { action: 'busy-self' }; // mình đang bận phòng khác, nhường bot rảnh

    return { action: 'join', myPos, freeBots };
}

async function handleSmartJoin(message, voiceChannel, options) {
    const guild = message.guild;
    const myBotId = message.client?.user?.id;
    const env = options.env || process.env;
    const botName = options.botName || message.client?.user?.username || 'Bot TTS';

    const decision = decideSmartJoin({ guild, targetChannel: voiceChannel, myBotId, env });

    if (decision.action === 'already-here') {
        await message.reply(`🎤 ${botName} đã ở **${voiceChannel.name}** rồi! Gõ \`.nội dung\` để bot đọc.`);
        return true;
    }
    if (decision.action === 'occupied' || decision.action === 'busy-self') {
        return true; // im lặng, để bot phù hợp xử lý
    }
    if (decision.action === 'all-busy') {
        if (options.isResponder) {
            await message.reply('😴 Tất cả bot TTS đang bận ở phòng khác rồi, chờ chút hoặc gõ `?leave` ở phòng đó nhé.');
        }
        return true;
    }

    // action === 'join'. Bot đứng đầu danh sách rảnh (myPos 0) vào ngay;
    // các bot backup chờ theo bậc rồi mới thế chỗ nếu phòng vẫn trống (bot ưu tiên offline).
    if (decision.myPos > 0) {
        await delay(decision.myPos * SMART_JOIN_BACKUP_STEP_MS);
        const stillEmpty = !findTtsBotInChannel(
            guild,
            voiceChannel.id,
            getConfiguredTtsBotIds({ env, currentBotId: myBotId })
        );
        if (!stillEmpty) return true;                 // bot khác đã vào
        if (isBotBusyElsewhere(guild, myBotId, voiceChannel.id)) return true; // mình vừa bận
    }

    return performTtsJoin(message, voiceChannel, options, botName);
}

async function performTtsJoin(message, voiceChannel, options, botName) {
    // Nếu bot đang có connection cũ (phòng trống/đã destroy) thì rời trước khi vào phòng mới.
    const currentConnection = ttsService.getConnection(message.guild.id);
    if (currentConnection) {
        try { ttsService.leaveChannel(message.guild.id); } catch (error) { /* ignore */ }
    }

    const permissions = voiceChannel.permissionsFor?.(message.client.user);
    if (!permissions?.has(PermissionFlagsBits.Connect) || !permissions?.has(PermissionFlagsBits.Speak)) {
        return message.reply('❌ Bot không có quyền vào hoặc nói trong voice channel này!');
    }

    try {
        await ttsService.joinChannel(voiceChannel);
        await message.reply(`🎤 ${botName} đã vào **${voiceChannel.name}**! Gõ \`.nội dung\` để bot đọc.`);
    } catch (error) {
        console.error('[TTS] Join error:', error.message);
        await message.reply(getJoinFailMessage(options, botName));
    }
    return true;
}

async function executeTtsCommand(message, args = [], options = {}) {
    const command = (options.commandName || getCommandFromMessage(message, options.prefix)).toLowerCase();
    if (!['join', 'leave', 'stop'].includes(command)) return false;

    if (isRelayTtsBlocked(options.client || message.client)) {
        if (!options.smartPool || options.isResponder) {
            await message.reply(options.relayBlockMessage || DEFAULT_RELAY_BLOCK_MESSAGE);
        }
        return true;
    }

    if (command === 'join') return handleJoin(message, args, options);
    if (command === 'leave') return handleLeave(message, options);
    if (command === 'stop') return handleStop(message, options);
    return false;
}

async function handleTtsAutoRead(message, options = {}) {
    if (!isTtsAutoReadMessage(message)) return false;

    const guildId = message.guild?.id;
    if (!guildId || !ttsService.isConnected(guildId)) return false;

    if (isRelayTtsBlocked(options.client || message.client)) {
        if (options.replyOnRelayBlocked !== false) {
            await message.reply(options.relayBlockMessage || DEFAULT_RELAY_BLOCK_MESSAGE).catch(() => null);
        }
        return true;
    }

    const textToSpeak = message.content.slice(1).trim();
    if (typeof options.beforeAutoRead === 'function') {
        const guard = await options.beforeAutoRead(message, {
            guildId,
            textToSpeak,
            ttsService
        });

        if (guard?.delete) {
            await message.delete().catch(() => { });
            return true;
        }
        if (guard === false || guard?.allowed === false) return true;
    }

    const botConnection = ttsService.getConnection(guildId);
    const userVoiceChannel = message.member?.voice?.channel;

    if (botConnection && userVoiceChannel && botConnection.joinConfig?.channelId === userVoiceChannel.id && textToSpeak) {
        await ttsService.speak(guildId, textToSpeak);
    }

    return true;
}

async function handleJoin(message, args, options) {
    const botName = options.botName || message.client?.user?.username || 'Bot TTS';
    const prefix = options.prefix || '?';
    const voiceChannel = await resolveVoiceChannel(message, args, options);

    if (!voiceChannel) {
        if (options.smartPool && !options.isResponder) return true; // tránh 3 bot cùng báo lỗi
        return message.reply(`❌ Bạn cần vào voice channel trước, hoặc dùng \`${prefix}join <voiceChannelId>\`.`);
    }

    if (options.smartPool) {
        return handleSmartJoin(message, voiceChannel, options);
    }

    const currentConnection = ttsService.getConnection(message.guild.id);
    if (currentConnection) {
        const currentResult = await handleCurrentConnection(message, voiceChannel, currentConnection, { botName, prefix });
        if (currentResult === 'handled') return true;
    }

    const smartJoin = canJoinTtsChannel(voiceChannel, {
        currentBotId: message.client?.user?.id,
        ttsBotIds: getConfiguredTtsBotIds({ currentBotId: message.client?.user?.id })
    });

    if (!smartJoin.allowed) {
        const botNames = smartJoin.blockers.map(getMemberDisplayName).join(', ');
        return message.reply(`🚫 Phòng đã có **${botNames}** rồi! Mỗi bot TTS chỉ vào một phòng thôi nha.`);
    }

    const permissions = voiceChannel.permissionsFor?.(message.client.user);
    if (!permissions?.has(PermissionFlagsBits.Connect) || !permissions?.has(PermissionFlagsBits.Speak)) {
        return message.reply('❌ Bot không có quyền vào hoặc nói trong voice channel này!');
    }

    try {
        await ttsService.joinChannel(voiceChannel);
        await message.reply(`🎤 ${botName} đã vào **${voiceChannel.name}**! Gõ \`.nội dung\` để bot đọc.`);
    } catch (error) {
        console.error('[TTS] Join error:', error.message);
        await message.reply(getJoinFailMessage(options, botName));
    }

    return true;
}

async function handleCurrentConnection(message, targetChannel, currentConnection, options) {
    const guildId = message.guild.id;

    if (!isAliveConnection(currentConnection)) {
        console.log(`[TTS] Connection cũ status: ${currentConnection.state?.status} -> destroy và join lại`);
        try {
            ttsService.leaveChannel(guildId);
        } catch (error) {
            try { currentConnection.destroy(); } catch (e) { }
        }
        return 'continue';
    }

    const currentChannelId = currentConnection.joinConfig?.channelId;
    if (currentChannelId === targetChannel.id) {
        await message.reply(`🎤 ${options.botName} đã ở **${targetChannel.name}** rồi! Gõ \`.nội dung\` để bot đọc.`);
        return 'handled';
    }

    const currentChannel = await getGuildChannel(message.guild, currentChannelId);
    if (channelHasHuman(currentChannel)) {
        if (isPrivateChannel(currentChannel)) {
            await message.reply(`${options.botName} đang bận ở một phòng riêng tư rồi! Gõ \`${options.prefix}leave\` ở phòng đó trước nhé.`);
        } else {
            const channelName = currentChannel?.name || 'một phòng khác';
            await message.reply(`${options.botName} đang ở **${channelName}** rồi! Gõ \`${options.prefix}leave\` ở phòng đó trước hoặc chờ bot rời đi nhé.`);
        }
        return 'handled';
    }

    console.log(`[TTS] Phòng ${currentChannelId} chỉ có bot hoặc trống -> tự leave và join ${targetChannel.id}`);
    try { ttsService.leaveChannel(guildId); } catch (e) { }
    return 'continue';
}

async function handleLeave(message, options) {
    const connection = ttsService.getConnection(message.guild.id);
    const disconnected = !connection || connection.state?.status === VoiceConnectionStatus.Destroyed;

    if (options.smartPool) {
        if (disconnected) return true; // bot này không ở voice → im lặng
        const callerChannel = message.member?.voice?.channel;
        const myChannelId = connection.joinConfig?.channelId;
        if (callerChannel) {
            if (myChannelId !== callerChannel.id) return true; // không phải phòng của người gọi
        } else if (!options.isResponder) {
            return true; // người gọi không ở voice → chỉ bot responder xử lý
        }
        ttsService.leaveChannel(message.guild.id);
        await message.reply('👋 Đã rời voice channel!');
        return true;
    }

    if (disconnected) {
        if (options.silentLeaveWhenDisconnected) return true;
        return message.reply('❌ Bot không ở trong voice channel nào!');
    }

    ttsService.leaveChannel(message.guild.id);
    await message.reply('👋 Đã rời voice channel!');
    return true;
}

async function handleStop(message, options) {
    const connection = ttsService.getConnection(message.guild.id);
    const disconnected = !connection || connection.state?.status === VoiceConnectionStatus.Destroyed;

    if (options.smartPool) {
        if (disconnected) return true;
        const callerChannel = message.member?.voice?.channel;
        const myChannelId = connection.joinConfig?.channelId;
        if (callerChannel) {
            if (myChannelId !== callerChannel.id) return true;
        } else if (!options.isResponder) {
            return true;
        }
        ttsService.stop(message.guild.id);
        await message.reply('⏹️ Đã dừng đọc!');
        return true;
    }

    if (disconnected) {
        return message.reply('❌ Bot không ở trong voice channel nào!');
    }

    ttsService.stop(message.guild.id);
    await message.reply('⏹️ Đã dừng đọc!');
    return true;
}

function getCommandFromMessage(message, prefix = '?') {
    const content = String(message.content || '');
    const body = content.startsWith(prefix) ? content.slice(prefix.length) : content;
    return body.trim().split(/\s+/)[0] || '';
}

function isTtsAutoReadMessage(message) {
    return typeof message.content === 'string' && message.content.startsWith('.') && message.content.length > 1;
}

async function resolveVoiceChannel(message, args = [], options = {}) {
    if (options.allowVoiceChannelId) {
        const requestedId = args[0]?.match(/\d{15,25}/)?.[0];
        const requestedChannel = await fetchVoiceChannel(message.guild, requestedId);
        if (requestedChannel) return requestedChannel;
    }

    const memberVoice = message.member?.voice?.channel;
    if (isVoiceChannel(memberVoice)) return memberVoice;

    if (options.allowVoiceChannelId && options.defaultVoiceChannelId) {
        const defaultChannel = await fetchVoiceChannel(message.guild, options.defaultVoiceChannelId);
        if (defaultChannel) return defaultChannel;
    }

    return null;
}

async function fetchVoiceChannel(guild, channelId) {
    if (!channelId || !guild?.channels) return null;

    const cached = guild.channels.cache?.get?.(channelId);
    if (isVoiceChannel(cached)) return cached;

    if (typeof guild.channels.fetch !== 'function') return null;
    const fetched = await guild.channels.fetch(channelId).catch(() => null);
    return isVoiceChannel(fetched) ? fetched : null;
}

async function getGuildChannel(guild, channelId) {
    if (!channelId || !guild?.channels) return null;
    const cached = guild.channels.cache?.get?.(channelId);
    if (cached) return cached;
    if (typeof guild.channels.fetch !== 'function') return null;
    return await guild.channels.fetch(channelId).catch(() => null);
}

function isVoiceChannel(channel) {
    return channel?.type === ChannelType.GuildVoice
        || channel?.type === ChannelType.GuildStageVoice
        || channel?.isVoiceBased?.() === true;
}

function isAliveConnection(connection) {
    return [
        VoiceConnectionStatus.Ready,
        VoiceConnectionStatus.Signalling,
        VoiceConnectionStatus.Connecting
    ].includes(connection?.state?.status);
}

function channelHasHuman(channel) {
    return collectionValues(channel?.members).some((member) => member.user?.bot !== true);
}

function isPrivateChannel(channel) {
    if (!channel) return false;
    try {
        const everyone = channel.guild?.roles?.everyone;
        const permissions = everyone ? channel.permissionsFor?.(everyone) : null;
        return permissions ? !permissions.has(PermissionFlagsBits.ViewChannel) : false;
    } catch (error) {
        return false;
    }
}

function collectionValues(collection) {
    if (!collection) return [];
    if (Array.isArray(collection)) return collection;
    if (collection.cache) return collectionValues(collection.cache);
    if (typeof collection.values === 'function') return Array.from(collection.values());
    if (typeof collection[Symbol.iterator] === 'function') {
        return Array.from(collection).map((item) => Array.isArray(item) ? item[1] : item);
    }
    return [];
}

function getMemberId(member) {
    return member?.id || member?.user?.id || '';
}

function getMemberDisplayName(member) {
    return member?.displayName
        || member?.nickname
        || member?.user?.globalName
        || member?.user?.username
        || member?.user?.tag
        || getMemberId(member)
        || 'bot TTS';
}

function getJoinFailMessage(options, botName) {
    if (Array.isArray(options.joinFailMessages) && options.joinFailMessages.length > 0) {
        return options.joinFailMessages[Math.floor(Math.random() * options.joinFailMessages.length)];
    }
    return `😵 ${botName} chưa vào voice được, thử lại sau nhé.`;
}

module.exports = {
    FALLBACK_TTS_BOT_IDS,
    DEFAULT_RELAY_BLOCK_MESSAGE,
    canJoinTtsChannel,
    decideSmartJoin,
    executeTtsCommand,
    findOtherTtsBotsInChannel,
    findTtsBotInChannel,
    getConfiguredTtsBotIds,
    getTtsBotPriority,
    handleTtsAutoRead,
    isRelayTtsBlocked
};

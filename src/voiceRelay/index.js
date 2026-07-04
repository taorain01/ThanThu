const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { loadVoiceRelayEnv } = require('./config/env');
const { SupabaseConfig } = require('./config/supabaseConfig');
const { StatusReporter } = require('./config/statusReporter');
const { RelayState } = require('./core/relayState');
const { VoiceRelayLogger } = require('./core/logger');
const { LinkPeer } = require('./link/linkPeer');
const { VoiceRelayVoiceManager } = require('./discord/voiceManager');
const { VoiceRelayCapture } = require('./discord/capture');
const { VoiceRelayPlayback } = require('./discord/playback');
const { VoiceRelayGuildSync } = require('./discord/guildSync');
const { handleVoiceRelayMessage } = require('./discord/commands');
const { findLangGiaRole } = require('../utils/langGiaRole');

const ENTRY_PERMISSION_BITS = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect;
const BOT_VOICE_PERMISSION_BITS = ENTRY_PERMISSION_BITS | PermissionFlagsBits.Speak | PermissionFlagsBits.Stream | PermissionFlagsBits.UseVAD;

// Tên hiển thị của kênh anchor (BANG CHIẾN) khi relay đang chạy có người.
const TEAM_TOP_NAME = '⚡ Team Top';
// Tên trả lại cho anchor khi hết người, nếu không lưu được tên gốc (fallback an toàn).
const ANCHOR_RESTORE_FALLBACK = 'BANG CHIẾN';

async function initVoiceRelay(client, options = {}) {
  const env = loadVoiceRelayEnv(options);
  const logger = new VoiceRelayLogger(env);

  if (!env.enabled) {
    logger.info('Voice relay đang tắt (đặt VOICE_RELAY_ENABLED=true để bật)');
    return { enabled: false, env, logger };
  }

  const relayState = new RelayState(env);
  relayState.update({ discordConnected: client.isReady?.() === true });
  syncBotIdentity(client, relayState, env);

  const supabaseConfig = new SupabaseConfig(env, logger);
  const voiceManager = new VoiceRelayVoiceManager(client, env, relayState, supabaseConfig, logger);
  const capture = new VoiceRelayCapture(env, relayState, logger);
  const playback = new VoiceRelayPlayback(logger, env);
  const guildSync = new VoiceRelayGuildSync(client, env, supabaseConfig, logger);
  const link = new LinkPeer(env, logger);
  const statusReporter = new StatusReporter(env, supabaseConfig, relayState, logger, voiceManager);

  const runtime = {
    enabled: true,
    client,
    env,
    logger,
    relayState,
    supabaseConfig,
    voiceManager,
    capture,
    playback,
    guildSync,
    link,
    statusReporter,
    config: null,
    anchorOriginalName: null,
    getCommandPrefixes() {
      const prefixes = new Set([
        this.config?.command_prefix,
        env.commandPrefix,
        ...(env.alternateCommandPrefixes || [])
      ].filter(Boolean));
      return prefixes;
    },
    async patchConfig(patch) {
      const next = await supabaseConfig.patchConfig(patch);
      await applyConfig(next);
      return next;
    },
    async handleAction(action) {
      if (action === 'leave') return voiceManager.leave();
      if (action === 'rejoin') return voiceManager.ensureConnection();
      if (action === 'stopLeave') return voiceManager.leave();
      if (action === 'stopDelete') return voiceManager.stopAndDeleteManaged({ force: true });
      if (action === 'quickSetup') return quickSetup(runtime);
      return null;
    }
  };

  client.on('userUpdate', (_oldUser, newUser) => {
    if (!client.user?.id || newUser?.id !== client.user.id) return;
    syncBotIdentity(client, relayState, env);
  });

  async function applyConfig(config) {
    runtime.config = config;
    if (!runtime.anchorOriginalName && config.anchor_original_name) {
      runtime.anchorOriginalName = config.anchor_original_name;
    }
    capture.updateConfig(config);
    voiceManager.updateConfig(config);
    playback.setJitterMs(config.jitter_buffer_ms);
    playback.setSpeakerReleaseMs(config.speaker_release_ms);
    relayState.update({ relayEnabled: config.relay_enabled === true });
    if (config.auto_join) await voiceManager.ensureConnection().catch((error) => {
      logger.warn('Auto-join voice relay lỗi', error.message);
      relayState.update({ lastError: error.message });
      voiceManager.scheduleRejoin();
    });
    // Cập nhật tên anchor theo trạng thái relay (bật + có người → Team Top, ngược lại trả tên gốc).
    maybeRenameAnchor(runtime).catch((error) => logger.warn('Đổi tên anchor lỗi', error.message));
  }

  voiceManager.on('connection', (connection, guild) => {
    capture.attach(connection, guild);
    playback.attach(connection);
  });

  link.on('audio', (frame) => playback.onAudioFrame(frame));
  link.on('connect', () => relayState.update({ linkConnected: true }));
  link.on('disconnect', () => relayState.update({ linkConnected: false }));
  link.on('error', (error) => relayState.update({ lastError: error.message }));
  link.on('peer', () => {
    if (env.botId !== 1) return;
    syncManagedRelayRoomPermissions(runtime).catch((error) => {
      logger.warn('Đồng bộ quyền phòng relay theo bot phụ lỗi', error.message);
    });
  });
  capture.setLink(link);

  const config = await supabaseConfig.loadConfig({ createIfMissing: true });
  await applyConfig(config);
  supabaseConfig.subscribe((next) => applyConfig(next).catch((error) => {
    logger.warn('Áp dụng cấu hình voice relay lỗi', error.message);
    relayState.update({ lastError: error.message });
  }));

  link.start();
  guildSync.start();
  statusReporter.start((action) => runtime.handleAction(action));
  client.on('voiceStateUpdate', (oldState) => {
    if (env.botId !== 1) return;
    const channel = oldState?.channel;
    if (!channel || channel.members.filter((member) => !member.user?.bot).size > 0) return;
    cleanupEmptyManagedChannel(runtime, channel.id).catch((error) => {
      logger.warn('Không tự xóa được phòng relay trống', error.message);
    });
  });

  // Chỉ Bot 1 làm nhiệm vụ dọn phòng để tránh 3 bot cùng xoá.
  if (env.botId === 1) {
    voiceManager.sweepOrphanManagedChannels().catch((error) => logger.warn('Sweep phòng trống lỗi', error.message));
    const sweepTimer = setInterval(() => {
      voiceManager.sweepOrphanManagedChannels().catch((error) => logger.warn('Sweep phòng trống lỗi', error.message));
    }, 60_000);
    if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
  }

  client.voiceRelay = runtime;
  logger.info('Voice relay đã khởi động');
  return runtime;
}

function syncBotIdentity(client, relayState, env = null) {
  const user = client.user;
  if (!user) return;
  if (env) env.botUserId = user.id || null;

  const avatarUrl = typeof user.displayAvatarURL === 'function'
    ? user.displayAvatarURL({ extension: 'png', size: 128 })
    : null;

  relayState.update({
    botUsername: user.tag || user.username || null,
    botAvatarUrl: avatarUrl
  });
}

async function quickSetup(runtime) {
  const { env, voiceManager, supabaseConfig, logger } = runtime;
  if (env.botId !== 1) return voiceManager.ensureConnection();

  const guild = await voiceManager.resolveGuild();
  const anchorId = runtime.config?.voice_channel_id || runtime.config?.create_anchor_channel_id;
  const anchor = anchorId ? await guild.channels.fetch(anchorId).catch(() => null) : null;
  if (!anchor || !(anchor.type === ChannelType.GuildVoice || anchor.type === ChannelType.GuildStageVoice)) {
    throw new Error('Quick setup cần kênh mốc/phòng Bang Chiến hợp lệ cho Bot 1.');
  }

  await voiceManager.joinChannel(anchor.id, { persist: false });
  await supabaseConfig.patchConfig({
    voice_channel_id: anchor.id,
    relay_enabled: true,
    auto_join: true,
    mode: 'bridge',
    relay_targets: env.peerBotIds.map(String)
  });
  await waitForRelayPeerUserIds(runtime, 2, 5000);

  const created = [];
  const targets = [
    { botId: 2, name: '⚡ Team Mid', offset: 1 },
    { botId: 3, name: '⚡ Team Bot', offset: 2 }
  ];

  for (const target of targets) {
    const channel = await ensureManagedChannelForBot(runtime, anchor, target);
    created.push(channel.name);
  }
  logger.info(`Quick setup đã chuẩn bị phòng relay: ${created.join(', ')}`);
}

async function ensureManagedChannelForBot(runtime, anchor, target) {
  const { env, supabaseConfig, voiceManager } = runtime;
  const sbClient = supabaseConfig.getClient();
  const { data: row } = await sbClient
    .from('voice_relay_config')
    .select('voice_channel_id')
    .eq('guild_id', env.guildId)
    .eq('bot_id', target.botId)
    .maybeSingle();

  const guild = anchor.guild;
  let channel = row?.voice_channel_id ? await guild.channels.fetch(row.voice_channel_id).catch(() => null) : null;
  if (channel && !(await voiceManager.isManagedChannel(channel.id))) channel = null;
  // Tự nhận diện lại kênh: tìm phòng managed đã có của bot này (theo tên) để tái dùng, tránh tạo trùng gây spam.
  if (!channel) {
    channel = await voiceManager.findManagedChannelForBot(target.botId, target.name).catch(() => null);
  }
  if (!channel) {
    channel = await guild.channels.create({
      name: target.name,
      type: ChannelType.GuildVoice,
      parent: anchor.parent?.id || undefined,
      ...voiceCloneSettings(anchor),
      permissionOverwrites: relayRoomOverwrites(anchor, runtime),
      reason: `Voice relay quick setup Bot${target.botId}`
    });
    await voiceManager.markManagedChannel(channel.id, target.botId);
  } else {
    await syncRelayRoomWithAnchor(channel, anchor, target, runtime);
  }

  if (Number.isFinite(anchor.position)) {
    await channel.setPosition(anchor.position + target.offset).catch(() => null);
  }

  await supabaseConfig.upsertConfig({
    guild_id: env.guildId,
    bot_id: target.botId,
    voice_channel_id: channel.id,
    mode: 'bridge',
    relay_targets: env.allBotIds.filter((id) => id !== target.botId).map(String),
    relay_enabled: true,
    auto_join: true,
    pending_action: 'rejoin',
    ...relayPolicyFromConfig(runtime.config),
    updated_at: new Date().toISOString()
  }, { select: null });

  return channel;
}

function relayPolicyFromConfig(config = {}) {
  return {
    caller_role_ids: asStringArray(config.caller_role_ids),
    blocked_role_ids: asStringArray(config.blocked_role_ids),
    caller_user_ids: asStringArray(config.caller_user_ids),
    muted_user_ids: asStringArray(config.muted_user_ids),
    speaker_priority: config.speaker_priority === 'priority' ? 'priority' : 'mix',
    priority_role_ids: asStringArray(config.priority_role_ids),
    jitter_buffer_ms: config.jitter_buffer_ms,
    speaker_release_ms: config.speaker_release_ms
  };
}

function asStringArray(value) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

async function syncRelayRoomWithAnchor(channel, anchor, target, runtime) {
  const patch = {
    name: target.name,
    parent: anchor.parent?.id || null,
    ...voiceCloneSettings(anchor),
    reason: `Voice relay sync from Bang Chiến for Bot${target.botId}`
  };
  await channel.edit(patch);
  await channel.permissionOverwrites.set(
    relayRoomOverwrites(anchor, runtime),
    `Voice relay permissions: clone Bang Chiến, LangGia only`
  );
}

function voiceCloneSettings(anchor) {
  const settings = {};
  if (Number.isFinite(anchor.bitrate)) settings.bitrate = anchor.bitrate;
  if (Number.isFinite(anchor.userLimit)) settings.userLimit = anchor.userLimit;
  if ('rtcRegion' in anchor) settings.rtcRegion = anchor.rtcRegion || null;
  if (anchor.videoQualityMode != null) settings.videoQualityMode = anchor.videoQualityMode;
  return settings;
}

function relayRoomOverwrites(anchor, runtime) {
  const { env, logger, client } = runtime;
  const guild = anchor.guild;
  const langGiaRole = findLangGiaRole(guild);
  if (!langGiaRole) {
    throw new Error('Không tìm thấy role LangGia để khóa phòng relay.');
  }

  const configuredBotIds = (env.relayBotUserIds || []).filter(isDiscordSnowflake);
  const learnedBotIds = runtime.link?.getPeerUserIds?.() || [];
  const botUserIds = new Set([client.user?.id, env.botUserId, ...configuredBotIds, ...learnedBotIds].filter(Boolean).map(String));
  const overwrites = new Map();

  for (const overwrite of anchor.permissionOverwrites.cache.values()) {
    const next = {
      id: overwrite.id,
      type: overwrite.type,
      allow: toPermissionBits(overwrite.allow?.bitfield),
      deny: toPermissionBits(overwrite.deny?.bitfield)
    };

    if (String(overwrite.id) !== String(langGiaRole.id) && !botUserIds.has(String(overwrite.id))) {
      next.allow &= ~ENTRY_PERMISSION_BITS;
    }
    overwrites.set(String(overwrite.id), next);
  }

  const everyone = upsertOverwrite(overwrites, guild.id, 0);
  everyone.allow &= ~ENTRY_PERMISSION_BITS;
  everyone.deny |= ENTRY_PERMISSION_BITS;

  const langGia = upsertOverwrite(overwrites, langGiaRole.id, 0);
  langGia.allow |= ENTRY_PERMISSION_BITS;
  langGia.deny &= ~ENTRY_PERMISSION_BITS;

  for (const botId of botUserIds) {
    const botOverwrite = upsertOverwrite(overwrites, botId, 1);
    botOverwrite.allow |= BOT_VOICE_PERMISSION_BITS;
    botOverwrite.deny &= ~BOT_VOICE_PERMISSION_BITS;
  }

  if (botUserIds.size < 3) {
    logger?.warn?.('Chưa biết đủ Discord user ID của 3 bot relay; nếu Bot 2/3 không thấy phòng, chờ link kết nối hoặc cấu hình VOICE_RELAY_BOT_USER_IDS.');
  }

  return [...overwrites.values()];
}

async function waitForRelayPeerUserIds(runtime, expectedCount, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const ids = runtime.link?.getPeerUserIds?.() || [];
    if (ids.length >= expectedCount) return ids;
    await sleep(250);
  }
  return runtime.link?.getPeerUserIds?.() || [];
}

async function syncManagedRelayRoomPermissions(runtime) {
  const { env, config, voiceManager, logger } = runtime;
  if (env.botId !== 1 || !config?.voice_channel_id) return 0;

  const guild = await voiceManager.resolveGuild();
  const anchor = await guild.channels.fetch(config.voice_channel_id).catch(() => null);
  if (!anchor || !(anchor.type === ChannelType.GuildVoice || anchor.type === ChannelType.GuildStageVoice)) return 0;

  const rows = await voiceManager.listManagedChannels().catch(() => []);
  let synced = 0;
  for (const row of rows) {
    const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
    if (!channel || !(channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice)) continue;
    await channel.permissionOverwrites.set(
      relayRoomOverwrites(anchor, runtime),
      'Voice relay permissions: sync bot phụ'
    );
    synced += 1;
  }
  if (synced > 0) logger.info(`Đã đồng bộ quyền cho ${synced} phòng relay theo bot phụ`);
  return synced;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function upsertOverwrite(overwrites, id, type) {
  const key = String(id);
  if (!overwrites.has(key)) {
    overwrites.set(key, { id: key, type, allow: 0n, deny: 0n });
  }
  return overwrites.get(key);
}

function toPermissionBits(value) {
  if (typeof value === 'bigint') return value;
  if (value == null) return 0n;
  return BigInt(value);
}

function isDiscordSnowflake(value) {
  return /^\d{15,25}$/.test(String(value || '').trim());
}

async function cleanupEmptyManagedChannel(runtime, channelId) {
  const { voiceManager } = runtime;
  // deleteManagedChannel chỉ xoá khi phòng không còn người → an toàn, không đá ai ra.
  await voiceManager.deleteManagedChannel(channelId, { force: false });
}

// Đổi tên anchor (BANG CHIẾN) thành "Team Top" khi relay BẬT, và trả lại tên gốc khi relay TẮT.
// Chỉ Bot 1 làm. Lưu ý: Discord giới hạn đổi tên kênh ~2 lần/10 phút nên tên có thể cập nhật trễ.
async function maybeRenameAnchor(runtime) {
  const { env, config, voiceManager, supabaseConfig, logger } = runtime;
  if (env.botId !== 1 || !config) return;

  const anchorId = config.voice_channel_id;
  if (!anchorId) return;

  const guild = await voiceManager.resolveGuild();
  const anchor = await guild.channels.fetch(anchorId).catch(() => null);
  if (!anchor || !(anchor.type === ChannelType.GuildVoice || anchor.type === ChannelType.GuildStageVoice)) return;

  // Chỉ dựa vào relay bật/tắt, không phụ thuộc số người trong phòng.
  const shouldBeTop = config.relay_enabled === true;

  if (shouldBeTop && anchor.name !== TEAM_TOP_NAME) {
    // Lưu tên gốc lần đầu (memory + Supabase best-effort) để trả lại sau, kể cả khi restart.
    if (!runtime.anchorOriginalName) {
      runtime.anchorOriginalName = anchor.name;
      supabaseConfig.patchConfig({ anchor_original_name: anchor.name }).catch(() => null);
    }
    await anchor.setName(TEAM_TOP_NAME).catch((error) => logger.warn('Đổi tên anchor → Team Top lỗi', error.message));
  } else if (!shouldBeTop && anchor.name === TEAM_TOP_NAME) {
    const original = runtime.anchorOriginalName || config.anchor_original_name || ANCHOR_RESTORE_FALLBACK;
    await anchor.setName(original).catch((error) => logger.warn('Trả tên anchor lỗi', error.message));
  }
}

module.exports = {
  initVoiceRelay,
  handleVoiceRelayMessage
};

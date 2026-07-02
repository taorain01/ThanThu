const { ChannelType } = require('discord.js');
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

async function initVoiceRelay(client, options = {}) {
  const env = loadVoiceRelayEnv(options);
  const logger = new VoiceRelayLogger(env);

  if (!env.enabled) {
    logger.info('Voice relay đang tắt (đặt VOICE_RELAY_ENABLED=true để bật)');
    return { enabled: false, env, logger };
  }

  const relayState = new RelayState(env);
  relayState.update({ discordConnected: client.isReady?.() === true });
  syncBotIdentity(client, relayState);

  const supabaseConfig = new SupabaseConfig(env, logger);
  const voiceManager = new VoiceRelayVoiceManager(client, env, relayState, supabaseConfig, logger);
  const capture = new VoiceRelayCapture(env, relayState, logger);
  const playback = new VoiceRelayPlayback(logger);
  const guildSync = new VoiceRelayGuildSync(client, env, supabaseConfig, logger);
  const link = new LinkPeer(env, logger);
  const statusReporter = new StatusReporter(env, supabaseConfig, relayState, logger, voiceManager);

  const runtime = {
    enabled: true,
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
    syncBotIdentity(client, relayState);
  });

  async function applyConfig(config) {
    runtime.config = config;
    capture.updateConfig(config);
    voiceManager.updateConfig(config);
    relayState.update({ relayEnabled: config.relay_enabled === true });
    if (config.auto_join) await voiceManager.ensureConnection().catch((error) => {
      logger.warn('Auto-join voice relay lỗi', error.message);
      relayState.update({ lastError: error.message });
    });
  }

  voiceManager.on('connection', (connection, guild) => {
    capture.attach(connection, guild);
    playback.attach(connection);
  });

  link.on('audio', (frame) => playback.onAudioFrame(frame));
  link.on('connect', () => relayState.update({ linkConnected: true }));
  link.on('disconnect', () => relayState.update({ linkConnected: false }));
  link.on('error', (error) => relayState.update({ lastError: error.message }));
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

  client.voiceRelay = runtime;
  logger.info('Voice relay đã khởi động');
  return runtime;
}

function syncBotIdentity(client, relayState) {
  const user = client.user;
  if (!user) return;

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

  const created = [];
  const targets = [
    { botId: 2, name: '⚡ Tiểu Ngỗng', offset: 1 },
    { botId: 3, name: '⚡ Chiến Ngỗng', offset: 2 }
  ];

  for (const target of targets) {
    const channel = await ensureManagedChannelForBot(runtime, anchor, target);
    created.push(channel.name);
  }
  logger.info(`Quick setup đã chuẩn bị phòng relay: ${created.join(', ')}`);
}

async function ensureManagedChannelForBot(runtime, anchor, target) {
  const { env, supabaseConfig, voiceManager } = runtime;
  const client = supabaseConfig.getClient();
  const { data: row } = await client
    .from('voice_relay_config')
    .select('voice_channel_id')
    .eq('guild_id', env.guildId)
    .eq('bot_id', target.botId)
    .maybeSingle();

  const guild = anchor.guild;
  let channel = row?.voice_channel_id ? await guild.channels.fetch(row.voice_channel_id).catch(() => null) : null;
  if (!channel || !(await voiceManager.isManagedChannel(channel.id))) {
    channel = await guild.channels.create({
      name: target.name,
      type: ChannelType.GuildVoice,
      parent: anchor.parent?.id || undefined,
      reason: `Voice relay quick setup Bot${target.botId}`
    });
    await voiceManager.markManagedChannel(channel.id, target.botId);
  }

  if (Number.isFinite(anchor.position)) {
    await channel.setPosition(anchor.position + target.offset).catch(() => null);
  }

  await client.from('voice_relay_config').upsert({
    guild_id: env.guildId,
    bot_id: target.botId,
    voice_channel_id: channel.id,
    mode: 'bridge',
    relay_targets: env.allBotIds.filter((id) => id !== target.botId).map(String),
    relay_enabled: true,
    auto_join: true,
    pending_action: 'rejoin',
    updated_at: new Date().toISOString()
  }, { onConflict: 'guild_id,bot_id' });

  return channel;
}

async function cleanupEmptyManagedChannel(runtime, channelId) {
  const { supabaseConfig, voiceManager, env } = runtime;
  const { data } = await supabaseConfig.getClient()
    .from('voice_relay_master')
    .select('enabled,stop_mode')
    .eq('guild_id', env.guildId)
    .maybeSingle();
  if (data?.enabled === false) {
    await voiceManager.deleteManagedChannel(channelId, { force: false });
  }
}

module.exports = {
  initVoiceRelay,
  handleVoiceRelayMessage
};

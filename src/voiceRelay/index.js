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

  const supabaseConfig = new SupabaseConfig(env, logger);
  const voiceManager = new VoiceRelayVoiceManager(client, env, relayState, supabaseConfig, logger);
  const capture = new VoiceRelayCapture(env, relayState, logger);
  const playback = new VoiceRelayPlayback(logger);
  const guildSync = new VoiceRelayGuildSync(client, env, supabaseConfig, logger);
  const link = new LinkPeer(env, logger);
  const statusReporter = new StatusReporter(env, supabaseConfig, relayState, logger);

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
      return null;
    }
  };

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

  client.voiceRelay = runtime;
  logger.info('Voice relay đã khởi động');
  return runtime;
}

module.exports = {
  initVoiceRelay,
  handleVoiceRelayMessage
};

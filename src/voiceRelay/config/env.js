function firstEnv(keys, fallback = '') {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && String(value).trim() !== '') return String(value).trim();
  }
  return fallback;
}

function boolEnv(keys, fallback = false) {
  const raw = firstEnv(Array.isArray(keys) ? keys : [keys], '');
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(raw.toLowerCase());
}

function intEnv(keys, fallback) {
  const raw = firstEnv(Array.isArray(keys) ? keys : [keys], '');
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function listEnv(keys, fallback = []) {
  const raw = firstEnv(Array.isArray(keys) ? keys : [keys], '');
  if (!raw) return fallback;
  return raw.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
}

function normalizeBotId(value, fallback) {
  const n = Number(value);
  return n === 1 || n === 2 || n === 3 ? n : fallback;
}

function loadVoiceRelayEnv(options = {}) {
  const botId = normalizeBotId(
    options.botId ?? firstEnv(['VOICE_RELAY_BOT_ID', 'BOT_ID'], ''),
    options.defaultBotId || 1
  );
  const botMeta = {
    1: { name: 'Đại Ngỗng', prefix: '?relay', altPrefixes: ['?vr'], guildKeys: ['VOICE_RELAY_GUILD_ID', 'GUILD_ID'], voiceKeys: ['VOICE_RELAY_VOICE_CHANNEL_ID', 'VOICE_CHANNEL_ID'] },
    2: { name: 'Tiểu Ngỗng', prefix: '!relay', altPrefixes: ['!vr'], guildKeys: ['VOICE_RELAY_GUILD_ID', 'BOT2_GUILD_ID', 'GUILD_ID'], voiceKeys: ['VOICE_RELAY_VOICE_CHANNEL_ID', 'BOT2_VOICE_CHANNEL_ID', 'VOICE_CHANNEL_ID'] },
    3: { name: 'Chiến Ngỗng', prefix: '#relay', altPrefixes: ['#vr'], guildKeys: ['VOICE_RELAY_GUILD_ID', 'BOT3_GUILD_ID', 'GUILD_ID'], voiceKeys: ['VOICE_RELAY_VOICE_CHANNEL_ID', 'BOT3_VOICE_CHANNEL_ID', 'VOICE_CHANNEL_ID'] }
  }[botId];
  const enabled = boolEnv(['VOICE_RELAY_ENABLED', 'RELAY_ENABLED'], false);

  const commandPrefix = firstEnv(
    botId === 2
      ? ['VOICE_RELAY_COMMAND_PREFIX', 'BOT2_RELAY_PREFIX', 'BOT2_COMMAND_PREFIX']
      : botId === 3
        ? ['VOICE_RELAY_COMMAND_PREFIX', 'BOT3_RELAY_PREFIX', 'BOT3_COMMAND_PREFIX']
        : ['VOICE_RELAY_COMMAND_PREFIX', 'COMMAND_PREFIX'],
    botMeta.prefix
  );
  const allBotIds = [1, 2, 3];
  const peerBotIds = allBotIds.filter((id) => id !== botId);

  const env = {
    enabled,
    botId,
    allBotIds,
    peerBotIds,
    peerBotId: peerBotIds[0],
    botName: options.botName || botMeta.name,
    guildId: firstEnv(botMeta.guildKeys),
    commandPrefix,
    alternateCommandPrefixes: listEnv(
      botId === 2
        ? ['VOICE_RELAY_ALT_PREFIXES', 'BOT2_RELAY_ALT_PREFIXES']
        : botId === 3
          ? ['VOICE_RELAY_ALT_PREFIXES', 'BOT3_RELAY_ALT_PREFIXES']
          : ['VOICE_RELAY_ALT_PREFIXES'],
      botMeta.altPrefixes
    ),
    relayBotUserIds: listEnv(['VOICE_RELAY_BOT_USER_IDS', 'TTS_BOT_IDS'], []),
    requireAdminCommands: boolEnv(['VOICE_RELAY_REQUIRE_ADMIN_COMMANDS', 'REQUIRE_ADMIN_COMMANDS'], true),
    commandAdminIds: listEnv(['VOICE_RELAY_COMMAND_ADMIN_IDS', 'COMMAND_ADMIN_IDS'], []),
    defaultVoiceChannelId: firstEnv(botMeta.voiceKeys),
    linkMode: firstEnv(['VOICE_RELAY_LINK_MODE', 'LINK_MODE'], botId === 1 ? 'server' : 'client').toLowerCase(),
    linkPort: intEnv(['VOICE_RELAY_LINK_PORT', 'LINK_PORT'], 8790),
    linkUrl: firstEnv(['VOICE_RELAY_LINK_URL', 'LINK_URL'], 'ws://127.0.0.1:8790'),
    linkSecret: firstEnv(['VOICE_RELAY_LINK_SECRET', 'LINK_SECRET']),
    supabaseUrl: firstEnv(['SUPABASE_URL', 'VOICE_RELAY_SUPABASE_URL']),
    supabaseServiceKey: firstEnv([
      'SUPABASE_SERVICE_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_SECRET_KEY',
      'VOICE_RELAY_SUPABASE_SERVICE_KEY'
    ]),
    verboseLogs: boolEnv(['VOICE_RELAY_VERBOSE_LOGS', 'VOICE_RELAY_DEBUG_LOGS'], false),
    jitterBufferMs: intEnv(['VOICE_RELAY_JITTER_MS', 'VOICE_RELAY_JITTER_BUFFER_MS'], 400),
    statusIntervalMs: intEnv(['VOICE_RELAY_STATUS_INTERVAL_MS'], 15000),
    configPollIntervalMs: intEnv(['VOICE_RELAY_CONFIG_POLL_MS'], 10000),
    commandPollIntervalMs: intEnv(['VOICE_RELAY_COMMAND_POLL_MS'], 5000)
  };

  if (!enabled) return env;

  const missing = [];
  if (!env.guildId) missing.push('VOICE_RELAY_GUILD_ID/GUILD_ID');
  if (!['server', 'client'].includes(env.linkMode)) missing.push('VOICE_RELAY_LINK_MODE=server|client');
  if (!env.linkSecret) missing.push('VOICE_RELAY_LINK_SECRET/LINK_SECRET');
  if (!env.supabaseUrl) missing.push('SUPABASE_URL');
  if (!env.supabaseServiceKey) missing.push('SUPABASE_SERVICE_KEY');
  if (env.linkMode === 'client' && !env.linkUrl) missing.push('VOICE_RELAY_LINK_URL/LINK_URL');

  if (missing.length) {
    throw new Error(`Voice relay thiếu biến môi trường: ${missing.join(', ')}`);
  }

  return env;
}

module.exports = {
  firstEnv,
  loadVoiceRelayEnv
};

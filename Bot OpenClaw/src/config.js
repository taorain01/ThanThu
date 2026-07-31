'use strict';

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

function requireValue(env, name) {
  const value = String(env[name] || '').trim();
  if (!value) {
    throw new ConfigError(`Thiếu biến môi trường ${name}.`);
  }
  return value;
}

function parseSnowflake(value, name) {
  if (!/^\d{17,20}$/.test(value)) {
    throw new ConfigError(`${name} phải là Discord ID hợp lệ.`);
  }
  return value;
}

function parseInteger(value, name, min, max) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new ConfigError(`${name} phải nằm trong khoảng ${min}-${max}.`);
  }
  return parsed;
}

function parseAgentId(value) {
  const agentId = String(value || 'main').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(agentId)) {
    throw new ConfigError('OPENCLAW_AGENT_ID không hợp lệ.');
  }
  return agentId;
}

function parseLoopbackUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError('OPENCLAW_BASE_URL không phải URL hợp lệ.');
  }

  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (url.protocol !== 'http:' || !loopbackHosts.has(url.hostname)) {
    throw new ConfigError('OPENCLAW_BASE_URL bắt buộc dùng HTTP loopback cục bộ.');
  }
  if (url.username || url.password || (url.pathname !== '/' && url.pathname !== '')) {
    throw new ConfigError('OPENCLAW_BASE_URL chỉ được chứa origin của Gateway.');
  }

  return url.origin;
}

function loadConfig(env = process.env) {
  const allowedUserIds = new Set(
    requireValue(env, 'DISCORD_ALLOWED_USER_IDS')
      .split(',')
      .map((value) => parseSnowflake(value.trim(), 'DISCORD_ALLOWED_USER_IDS')),
  );

  const prefix = String(env.DISCORD_PREFIX || '>').trim();
  if (!prefix || /\s/.test(prefix) || prefix.length > 5) {
    throw new ConfigError('DISCORD_PREFIX phải dài 1-5 ký tự và không chứa khoảng trắng.');
  }

  return Object.freeze({
    discordToken: requireValue(env, 'DISCORD_TOKEN'),
    applicationId: parseSnowflake(
      requireValue(env, 'DISCORD_APPLICATION_ID'),
      'DISCORD_APPLICATION_ID',
    ),
    guildId: parseSnowflake(requireValue(env, 'DISCORD_GUILD_ID'), 'DISCORD_GUILD_ID'),
    allowedUserIds,
    prefix,
    openclawBaseUrl: parseLoopbackUrl(requireValue(env, 'OPENCLAW_BASE_URL')),
    openclawGatewayToken: requireValue(env, 'OPENCLAW_GATEWAY_TOKEN'),
    openclawModel: String(env.OPENCLAW_MODEL || 'openclaw/default').trim(),
    openclawAgentId: parseAgentId(env.OPENCLAW_AGENT_ID),
    requestTimeoutMs: parseInteger(
      env.OPENCLAW_REQUEST_TIMEOUT_MS || '300000',
      'OPENCLAW_REQUEST_TIMEOUT_MS',
      1000,
      900000,
    ),
    maxPending: parseInteger(
      env.OPENCLAW_MAX_PENDING || '5',
      'OPENCLAW_MAX_PENDING',
      1,
      20,
    ),
  });
}

module.exports = {
  ConfigError,
  loadConfig,
};

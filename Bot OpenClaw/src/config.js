'use strict';

const path = require('node:path');

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

function parseSourceRoots(value) {
  const roots = String(value || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);

  for (const root of roots) {
    if (!path.isAbsolute(root) || path.parse(root).root === path.resolve(root)) {
      throw new ConfigError('OPENCLAW_MEDIA_SOURCE_ROOTS chỉ được chứa thư mục tuyệt đối, không dùng trực tiếp gốc ổ đĩa.');
    }
  }
  return roots;
}

function parseAgentId(value) {
  const agentId = String(value || 'main').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(agentId)) {
    throw new ConfigError('OPENCLAW_AGENT_ID không hợp lệ.');
  }
  return agentId;
}

function parseBackendModel(value, name, fallback) {
  const model = String(value || fallback).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(model)) {
    throw new ConfigError(`${name} phải có dạng provider/model hợp lệ.`);
  }
  return model;
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

  const openclawBackendModels = Object.freeze({
    '9router': parseBackendModel(
      env.OPENCLAW_BACKEND_MODEL_9ROUTER,
      'OPENCLAW_BACKEND_MODEL_9ROUTER',
      '9router/cx/gpt-5.6-sol',
    ),
    // Mặc định phải là tag Ollama ĐANG tồn tại: tag cũ (qwen3:8b) đã bị xoá nên
    // gateway trả 404 khi profile local không có OPENCLAW_BACKEND_MODEL_LOCAL.
    local: parseBackendModel(
      env.OPENCLAW_BACKEND_MODEL_LOCAL,
      'OPENCLAW_BACKEND_MODEL_LOCAL',
      'ollama/qwen3.5:9b',
    ),
    opus: parseBackendModel(
      env.OPENCLAW_BACKEND_MODEL_OPUS,
      'OPENCLAW_BACKEND_MODEL_OPUS',
      'anthropic/claude-opus-5',
    ),
  });

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
    openclawBackendModels,
    requestIdleTimeoutMs: parseInteger(
      env.OPENCLAW_REQUEST_IDLE_TIMEOUT_MS || env.OPENCLAW_REQUEST_TIMEOUT_MS || '1800000',
      'OPENCLAW_REQUEST_IDLE_TIMEOUT_MS',
      1000,
      43200000,
    ),
    requestMaxRuntimeMs: parseInteger(
      env.OPENCLAW_REQUEST_MAX_RUNTIME_MS || '43200000',
      'OPENCLAW_REQUEST_MAX_RUNTIME_MS',
      60000,
      86400000,
    ),
    maxPending: parseInteger(
      env.OPENCLAW_MAX_PENDING || '5',
      'OPENCLAW_MAX_PENDING',
      1,
      20,
    ),
    maxConcurrentSessions: parseInteger(
      env.OPENCLAW_MAX_CONCURRENT_SESSIONS || '2',
      'OPENCLAW_MAX_CONCURRENT_SESSIONS',
      1,
      10,
    ),
    jobPollMs: parseInteger(
      env.OPENCLAW_JOB_POLL_MS || '2000',
      'OPENCLAW_JOB_POLL_MS',
      500,
      60000,
    ),
    // Admin HTTP RPC quan sát p50 ~3,1s / p95 ~3,9s; timeout 5s cũ làm RPC
    // trượt thường xuyên và kéo theo fallback CLI 12-18s. 12s cho đủ headroom.
    taskRpcTimeoutMs: parseInteger(
      env.OPENCLAW_TASK_RPC_TIMEOUT_MS || '12000',
      'OPENCLAW_TASK_RPC_TIMEOUT_MS',
      1000,
      60000,
    ),
    cancelWarningMs: parseInteger(
      env.OPENCLAW_CANCEL_WARNING_MS || '120000',
      'OPENCLAW_CANCEL_WARNING_MS',
      1000,
      3600000,
    ),
    jobHeartbeatMs: parseInteger(
      env.OPENCLAW_JOB_HEARTBEAT_MS || '60000',
      'OPENCLAW_JOB_HEARTBEAT_MS',
      10000,
      3600000,
    ),
    // Chờ thêm sau khi durable task cuối kết thúc nếu agent đã trả lời xong mà
    // worker nền vẫn còn chạy: session OpenClaw tự tiếp tục công việc sau đó
    // (tạo task mới / giao MEDIA), settle sớm sẽ bỏ lỡ toàn bộ phần còn lại.
    taskContinuationGraceMs: parseInteger(
      env.OPENCLAW_TASK_CONTINUATION_GRACE_MS || '90000',
      'OPENCLAW_TASK_CONTINUATION_GRACE_MS',
      30000,
      600000,
    ),
    statusUpdateDebounceMs: parseInteger(
      env.OPENCLAW_STATUS_UPDATE_DEBOUNCE_MS || '1000',
      'OPENCLAW_STATUS_UPDATE_DEBOUNCE_MS',
      250,
      10000,
    ),
    streamUpdateMs: parseInteger(
      env.OPENCLAW_STREAM_UPDATE_MS || '2000',
      'OPENCLAW_STREAM_UPDATE_MS',
      1000,
      10000,
    ),
    mediaOutboxRetentionHours: parseInteger(
      env.OPENCLAW_MEDIA_OUTBOX_RETENTION_HOURS || '168',
      'OPENCLAW_MEDIA_OUTBOX_RETENTION_HOURS',
      1,
      8760,
    ),
    mediaSourceRoots: parseSourceRoots(env.OPENCLAW_MEDIA_SOURCE_ROOTS),
  });
}

module.exports = {
  ConfigError,
  loadConfig,
};

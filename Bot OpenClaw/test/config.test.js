'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ConfigError, loadConfig } = require('../src/config');

function validEnv(overrides = {}) {
  return {
    DISCORD_TOKEN: 'discord-token',
    DISCORD_APPLICATION_ID: '1532668080524759201',
    DISCORD_GUILD_ID: '1239836342456942643',
    DISCORD_ALLOWED_USER_IDS: '395151484179841024,111111111111111111',
    DISCORD_PREFIX: '>',
    OPENCLAW_BASE_URL: 'http://127.0.0.1:18789',
    OPENCLAW_GATEWAY_TOKEN: 'gateway-token',
    OPENCLAW_MODEL: 'openclaw/default',
    OPENCLAW_AGENT_ID: 'main',
    OPENCLAW_REQUEST_IDLE_TIMEOUT_MS: '1800000',
    OPENCLAW_REQUEST_MAX_RUNTIME_MS: '43200000',
    OPENCLAW_MAX_PENDING: '5',
    OPENCLAW_MAX_CONCURRENT_SESSIONS: '2',
    OPENCLAW_MEDIA_SOURCE_ROOTS: 'F:\\Hình Ảnh\\anhYoutube',
    ...overrides,
  };
}

test('đọc cấu hình hợp lệ và tạo allowlist', () => {
  const config = loadConfig(validEnv());
  assert.equal(config.openclawBaseUrl, 'http://127.0.0.1:18789');
  assert.equal(config.requestIdleTimeoutMs, 1800000);
  assert.equal(config.requestMaxRuntimeMs, 43200000);
  assert.equal(config.maxPending, 5);
  assert.equal(config.maxConcurrentSessions, 2);
  assert.deepEqual(config.mediaSourceRoots, ['F:\\Hình Ảnh\\anhYoutube']);
  assert.equal(config.openclawAgentId, 'main');
  assert.deepEqual(config.openclawBackendModels, {
    '9router': '9router/cx/gpt-5.6-sol',
    local: 'ollama/qwen3:8b',
  });
  assert.equal(config.allowedUserIds.has('395151484179841024'), true);
  assert.equal(config.allowedUserIds.size, 2);
});

test('từ chối Gateway không phải loopback', () => {
  assert.throws(
    () => loadConfig(validEnv({ OPENCLAW_BASE_URL: 'https://example.com' })),
    ConfigError,
  );
});

test('từ chối Discord ID và giới hạn số không hợp lệ', () => {
  assert.throws(
    () => loadConfig(validEnv({ DISCORD_GUILD_ID: 'abc' })),
    /Discord ID hợp lệ/,
  );
  assert.throws(
    () => loadConfig(validEnv({ OPENCLAW_MAX_PENDING: '0' })),
    /khoảng 1-20/,
  );
  assert.throws(
    () => loadConfig(validEnv({ OPENCLAW_MAX_CONCURRENT_SESSIONS: '11' })),
    /khoảng 1-10/,
  );
});

test('bắt buộc token và allowlist', () => {
  assert.throws(
    () => loadConfig(validEnv({ DISCORD_TOKEN: '' })),
    /DISCORD_TOKEN/,
  );
  assert.throws(
    () => loadConfig(validEnv({ DISCORD_ALLOWED_USER_IDS: '' })),
    /DISCORD_ALLOWED_USER_IDS/,
  );
});

test('từ chối OpenClaw agent ID không hợp lệ', () => {
  assert.throws(
    () => loadConfig(validEnv({ OPENCLAW_AGENT_ID: '../main' })),
    /OPENCLAW_AGENT_ID/,
  );
});

test('đọc model backend tùy chỉnh và từ chối model không có provider', () => {
  const config = loadConfig(validEnv({
    OPENCLAW_BACKEND_MODEL_9ROUTER: '9router/custom-model',
    OPENCLAW_BACKEND_MODEL_LOCAL: 'ollama/qwen3:14b',
  }));
  assert.equal(config.openclawBackendModels['9router'], '9router/custom-model');
  assert.equal(config.openclawBackendModels.local, 'ollama/qwen3:14b');
  assert.throws(
    () => loadConfig(validEnv({ OPENCLAW_BACKEND_MODEL_LOCAL: 'qwen3:8b' })),
    /provider\/model/,
  );
});

test('hỗ trợ timeout cũ nhưng từ chối allowlist là gốc ổ đĩa', () => {
  const config = loadConfig(validEnv({
    OPENCLAW_REQUEST_IDLE_TIMEOUT_MS: '',
    OPENCLAW_REQUEST_TIMEOUT_MS: '900000',
  }));
  assert.equal(config.requestIdleTimeoutMs, 900000);
  assert.throws(
    () => loadConfig(validEnv({ OPENCLAW_MEDIA_SOURCE_ROOTS: 'F:\\' })),
    /không dùng trực tiếp gốc ổ đĩa/,
  );
});

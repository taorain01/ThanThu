'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  appProfileFingerprint,
  normalizeBaseUrl,
  readAppProfile,
  readOpenClawProviders,
  resolveAppBackend,
} = require('../src/app-profile');

function tempFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-profile-test-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(content));
  return file;
}

test('chuẩn hóa Base URL các dạng', () => {
  assert.equal(normalizeBaseUrl('https://api.xpiki.com/v1'), 'https://api.xpiki.com');
  assert.equal(normalizeBaseUrl('https://api.xpiki.com/v1/'), 'https://api.xpiki.com');
  assert.equal(normalizeBaseUrl('https://api.xpiki.com'), 'https://api.xpiki.com');
  assert.equal(normalizeBaseUrl('https://proxy/v1/messages'), 'https://proxy');
  assert.equal(normalizeBaseUrl('http://127.0.0.1:20128/v1/chat/completions'), 'http://127.0.0.1:20128');
  assert.equal(normalizeBaseUrl('  https://API.XPIKI.COM/V1/  '), 'https://api.xpiki.com');
});

test('đọc profile đang active từ settings.json giả', () => {
  const file = tempFile('settings.json', {
    profile_name: 'Tuat Claude',
    env: {
      ANTHROPIC_BASE_URL: 'https://api.xpiki.com/v1',
      ANTHROPIC_API_KEY: 'sk-test-1234567890abcdef',
      ANTHROPIC_AUTH_TOKEN: 'sk-test-1234567890abcdef',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5',
    },
  });
  const profile = readAppProfile({ settingsPath: file });
  assert.equal(profile.name, 'Tuat Claude');
  assert.equal(profile.baseUrl, 'https://api.xpiki.com/v1');
  assert.equal(profile.apiKey, 'sk-test-1234567890abcdef');
  assert.equal(profile.opusModel, 'claude-opus-5');
});

test('trả null khi settings.json thiếu Base URL hoặc key', () => {
  const noUrl = tempFile('settings.json', { env: { ANTHROPIC_API_KEY: 'sk-x' } });
  assert.equal(readAppProfile({ settingsPath: noUrl }), null);
  const noKey = tempFile('settings.json', { env: { ANTHROPIC_BASE_URL: 'https://x' } });
  assert.equal(readAppProfile({ settingsPath: noKey }), null);
  assert.equal(readAppProfile({ settingsPath: path.join(os.tmpdir(), 'khong-ton-tai.json') }), null);
});

test('đọc providers từ openclaw.json giả', () => {
  const file = tempFile('openclaw.json', {
    models: {
      providers: {
        '9router': { baseUrl: 'http://127.0.0.1:20128/v1', api: 'openai-completions' },
        ollama: { baseUrl: 'http://127.0.0.1:11434', api: 'ollama' },
        anthropic: { baseUrl: 'https://api.xpiki.com/v1', api: 'anthropic-messages' },
      },
    },
  });
  const providers = readOpenClawProviders({ configPath: file });
  assert.equal(providers['9router'].baseUrl, 'http://127.0.0.1:20128');
  assert.equal(providers.anthropic.baseUrl, 'https://api.xpiki.com');
  assert.equal(providers.anthropic.api, 'anthropic-messages');
});

function fakeConfig() {
  return {
    openclawBackendModels: {
      '9router': '9router/cx/gpt-5.6-sol',
      local: 'ollama/qwen3:8b',
      opus: 'anthropic/claude-opus-5',
    },
  };
}

test('resolve profile cứng khi Base URL khớp provider cùng tên', () => {
  const config = fakeConfig();
  const providers = {
    '9router': { baseUrl: 'http://127.0.0.1:20128', api: 'openai-completions' },
    ollama: { baseUrl: 'http://127.0.0.1:11434', api: 'ollama' },
    anthropic: { baseUrl: 'https://api.xpiki.com', api: 'anthropic-messages' },
  };
  const p9 = resolveAppBackend(
    { name: '9router', baseUrl: 'http://127.0.0.1:20128/v1', apiKey: 'k', opusModel: 'x' },
    providers,
    config,
  );
  assert.deepEqual(p9, { kind: 'profile', name: '9router', label: '9router — 9router/cx/gpt-5.6-sol' });

  const pLocal = resolveAppBackend(
    { name: 'local', baseUrl: 'http://127.0.0.1:11434', apiKey: 'k', opusModel: 'x' },
    providers,
    config,
  );
  assert.equal(pLocal.kind, 'profile');
  assert.equal(pLocal.name, 'local');
});

test('resolve model anthropic/<opus> khi Base URL khớp provider anthropic', () => {
  const config = fakeConfig();
  const providers = {
    anthropic: { baseUrl: 'https://api.xpiki.com', api: 'anthropic-messages' },
  };
  const result = resolveAppBackend(
    { name: 'Tuat Claude', baseUrl: 'https://api.xpiki.com/v1', apiKey: 'k', opusModel: 'claude-opus-5' },
    providers,
    config,
  );
  assert.deepEqual(result, { kind: 'model', id: 'anthropic/claude-opus-5', label: 'anthropic/claude-opus-5' });
});

test('resolve dùng opus_model tùy chỉnh của profile', () => {
  const config = fakeConfig();
  const providers = {
    anthropic: { baseUrl: 'https://api.xpiki.com', api: 'anthropic-messages' },
  };
  const result = resolveAppBackend(
    { name: 'X', baseUrl: 'https://api.xpiki.com', apiKey: 'k', opusModel: 'claude-opus-4-8' },
    providers,
    config,
  );
  assert.equal(result.id, 'anthropic/claude-opus-4-8');
});

test('trả null khi Base URL không khớp provider nào', () => {
  const config = fakeConfig();
  const providers = {
    anthropic: { baseUrl: 'https://api.xpiki.com', api: 'anthropic-messages' },
  };
  const result = resolveAppBackend(
    { name: 'Lạ', baseUrl: 'https://proxy-khac.example.com/v1', apiKey: 'k', opusModel: 'claude-opus-5' },
    providers,
    config,
  );
  assert.equal(result, null);
  assert.equal(resolveAppBackend(null, providers, config), null);
});

test('trả null khi Base URL khớp nhưng API key khác provider', () => {
  const config = fakeConfig();
  const providers = {
    anthropic: { baseUrl: 'https://api.xpiki.com', api: 'anthropic-messages', apiKey: 'sk-dung' },
  };
  const result = resolveAppBackend(
    { name: 'Khác key', baseUrl: 'https://api.xpiki.com/v1', apiKey: 'sk-khac', opusModel: 'claude-opus-5' },
    providers,
    config,
  );
  assert.equal(result, null);

  // Cùng key thì resolve được
  const sameKey = resolveAppBackend(
    { name: 'Cùng key', baseUrl: 'https://api.xpiki.com/v1', apiKey: 'sk-dung', opusModel: 'claude-opus-5' },
    providers,
    config,
  );
  assert.equal(sameKey.id, 'anthropic/claude-opus-5');
});

test('fingerprint profile ổn định và đổi khi có thay đổi', () => {
  const a = { name: 'Tuat', baseUrl: 'https://x/v1', apiKey: 'k1', opusModel: 'claude-opus-5' };
  const same = { name: 'Tuat', baseUrl: 'https://x/v1', apiKey: 'k1', opusModel: 'claude-opus-5' };
  const different = { name: 'Tuat', baseUrl: 'https://x/v1', apiKey: 'k2', opusModel: 'claude-opus-5' };
  assert.equal(appProfileFingerprint(a), appProfileFingerprint(same));
  assert.notEqual(appProfileFingerprint(a), appProfileFingerprint(different));
  assert.match(appProfileFingerprint(a), /^[a-f0-9]{64}$/);
  assert.equal(appProfileFingerprint(a).includes('k1'), false);
  assert.equal(appProfileFingerprint(null), null);
});

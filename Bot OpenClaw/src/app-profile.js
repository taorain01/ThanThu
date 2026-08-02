'use strict';

// Đồng bộ profile đang kích hoạt trong Claude Profile Switcher (app desktop)
// sang model của bot OpenClaw. Bot đọc ~/.claude/settings.json (file app vừa
// copy khi KÍCH HOẠT profile) và ~/.openclaw/openclaw.json (providers OpenClaw)
// để suy ra model nên dùng mà không cần sửa gì bên app.

const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const OPENCLAW_CONFIG_PATH = path.join(os.homedir(), '.openclaw', 'openclaw.json');

// Chuẩn hóa Base URL để so khớp: bỏ trailing slash và hậu tố endpoint.
function normalizeBaseUrl(url) {
  let value = String(url || '').trim().toLowerCase().replace(/\/+$/, '');
  if (value.endsWith('/v1/messages') || value.endsWith('/v1/chat/completions')) {
    value = value.replace(/\/(v1\/messages|v1\/chat\/completions)$/, '');
  } else if (value.endsWith('/v1')) {
    value = value.slice(0, -3);
  }
  return value.replace(/\/+$/, '');
}

// Đọc profile đang kích hoạt trong app switcher (settings.json của Claude Code).
// Trả null nếu không đọc được hoặc thiếu Base URL/API Key.
function readAppProfile({ settingsPath = CLAUDE_SETTINGS_PATH } = {}) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    return null;
  }
  const env = data?.env || {};
  const baseUrl = String(env.ANTHROPIC_BASE_URL || '').trim();
  const apiKey = String(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || '').trim();
  if (!baseUrl || !apiKey) {
    return null;
  }
  return {
    name: String(data.profile_name || '').trim() || 'Đang dùng',
    baseUrl,
    apiKey,
    opusModel: String(env.ANTHROPIC_DEFAULT_OPUS_MODEL || 'claude-opus-5').trim(),
    sonnetModel: String(env.ANTHROPIC_DEFAULT_SONNET_MODEL || 'claude-sonnet-5').trim(),
    haikuModel: String(env.ANTHROPIC_DEFAULT_HAIKU_MODEL || 'claude-haiku-4-5').trim(),
  };
}

// Đọc các provider (baseUrl, api) đang cấu hình trong OpenClaw.
function readOpenClawProviders({ configPath = OPENCLAW_CONFIG_PATH } = {}) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
  const providers = data?.models?.providers || {};
  const out = {};
  for (const [name, provider] of Object.entries(providers)) {
    if (provider?.baseUrl) {
      out[name] = {
        baseUrl: normalizeBaseUrl(provider.baseUrl),
        api: String(provider.api || ''),
        apiKey: String(provider.apiKey || ''),
      };
    }
  }
  return out;
}

// Profile cứng của bot tương ứng với provider OpenClaw theo loại API:
// ollama → local, openai-completions/responses → 9router (tên provider cũng
// được chấp nhận để khỏi phụ thuộc api label).
const PROFILE_BY_API = {
  ollama: 'local',
  'openai-completions': '9router',
  'openai-responses': '9router',
};

// Suy ra model OpenClaw nên dùng từ profile app đang active.
// Trả null nếu Base URL không khớp provider nào trong OpenClaw.
function resolveAppBackend(appProfile, providers, config) {
  if (!appProfile) {
    return null;
  }
  const base = normalizeBaseUrl(appProfile.baseUrl);

  function keyMatches(provider) {
    // Provider không khai báo key (vd ollama) → bỏ qua so sánh.
    return !provider.apiKey || appProfile.apiKey === provider.apiKey;
  }

  // Profile cứng (9router / local) nếu Base URL khớp provider tương ứng.
  for (const [providerName, provider] of Object.entries(providers)) {
    const profileName = PROFILE_BY_API[provider.api]
      || (providerName === '9router' ? '9router' : null);
    if (profileName && base === provider.baseUrl && keyMatches(provider)) {
      return {
        kind: 'profile',
        name: profileName,
        label: `${profileName} — ${config.openclawBackendModels[profileName]}`,
      };
    }
  }

  // Provider Anthropic-compatible (proxy như xpiki): model = anthropic/<opus_model>.
  const anthropicProvider = Object.entries(providers)
    .find(([, provider]) => String(provider.api || '').includes('anthropic'));
  if (anthropicProvider
    && base === normalizeBaseUrl(anthropicProvider[1].baseUrl)
    && keyMatches(anthropicProvider[1])) {
    const id = `anthropic/${appProfile.opusModel || 'claude-opus-5'}`;
    return { kind: 'model', id, label: id };
  }

  return null;
}

// Fingerprint để biết profile app có đổi hay không (so với lần áp dụng trước).
function appProfileFingerprint(appProfile) {
  if (!appProfile) {
    return null;
  }
  return crypto
    .createHash('sha256')
    .update([appProfile.name, appProfile.baseUrl, appProfile.apiKey, appProfile.opusModel].join('|'))
    .digest('hex');
}

module.exports = {
  CLAUDE_SETTINGS_PATH,
  OPENCLAW_CONFIG_PATH,
  appProfileFingerprint,
  normalizeBaseUrl,
  readAppProfile,
  readOpenClawProviders,
  resolveAppBackend,
};

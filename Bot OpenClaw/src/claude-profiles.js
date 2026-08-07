'use strict';

// Quét profile của Claude Profile Switcher (app desktop) và ánh xạ mỗi profile
// thành một provider OpenClaw riêng, để bot Discord có thể chọn đúng profile mà
// app đang dùng — kể cả profile người dùng mới thêm sau này.
//
// Contract của app (ClaudeProfileSwitcher.py):
//   - Mỗi profile là file ~/.claude/settings_<Tên>.json
//   - Kích hoạt = copy file profile lên ~/.claude/settings.json
// Vì vậy bot chỉ cần đọc thư mục, không cần app phải export gì thêm.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const ACTIVE_SETTINGS_FILE = 'settings.json';
const PROVIDER_PREFIX = 'capp-';
const PATCH_TIMEOUT_MS = 30000;

// CLI OpenClaw dùng optimistic locking khi ghi openclaw.json: nếu file đổi giữa
// lúc CLI đọc và lúc ghi thì thoát với mã 1 kèm "ConfigMutationConflictError:
// config changed since last load". Bot chạy nhiều patch song song (provider
// profile + route model cứng) nên rất dễ đụng nhau — thử lại vài lần là xong.
const PATCH_RETRY_DELAYS_MS = [200, 600, 1500];
const CONFLICT_PATTERN = /ConfigMutationConflictError|config changed since last load/i;

// Tên hiển thị đặc biệt, khớp với logic của app desktop.
const SPECIAL_DISPLAY_NAMES = Object.freeze({
  tuat_claude: 'Tuat Claude',
  ht_store: 'H&T Store',
});

class ClaudeProfileError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'ClaudeProfileError';
  }
}

function displayNameFromFile(fileName) {
  const stem = fileName.replace(/^settings_/, '').replace(/\.json$/, '');
  return SPECIAL_DISPLAY_NAMES[stem.toLowerCase()] || stem.replace(/_/g, ' ');
}

// Slug an toàn cho tên provider OpenClaw (chỉ chữ/số/gạch ngang).
// Bỏ dấu tiếng Việt trước để "Sửa tay" ra "sua-tay" thay vì "s-a-tay".
function slugifyProfileName(name) {
  const slug = String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'profile';
}

function providerNameForSlug(slug) {
  return `${PROVIDER_PREFIX}${slug}`;
}

function isManagedProviderName(name) {
  return String(name || '').startsWith(PROVIDER_PREFIX);
}

function credentialKey(baseUrl, apiKey) {
  return crypto
    .createHash('sha256')
    .update(`${String(baseUrl || '').trim()}|${String(apiKey || '').trim()}`)
    .digest('hex');
}

function parseProfileSettings(raw, { fileName = null } = {}) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const env = data?.env || {};
  const baseUrl = String(env.ANTHROPIC_BASE_URL || '').trim();
  const apiKey = String(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || '').trim();
  if (!baseUrl || !apiKey) {
    return null;
  }
  const name = String(data.profile_name || '').trim()
    || (fileName ? displayNameFromFile(fileName) : 'Đang dùng');
  return {
    name,
    baseUrl,
    apiKey,
    opusModel: String(env.ANTHROPIC_DEFAULT_OPUS_MODEL || 'claude-opus-5').trim(),
    sonnetModel: String(env.ANTHROPIC_DEFAULT_SONNET_MODEL || 'claude-sonnet-5').trim(),
    haikuModel: String(env.ANTHROPIC_DEFAULT_HAIKU_MODEL || 'claude-haiku-4-5').trim(),
    credentialKey: credentialKey(baseUrl, apiKey),
  };
}

// Danh sách profile app, sắp theo tên. Slug được đảm bảo không trùng nhau.
function listAppProfiles({ claudeDir = CLAUDE_DIR } = {}) {
  let files;
  try {
    files = fs.readdirSync(claudeDir);
  } catch {
    return [];
  }
  const profiles = [];
  const candidates = files
    .filter((file) => file.startsWith('settings_') && file.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b));

  for (const file of candidates) {
    let raw;
    try {
      raw = fs.readFileSync(path.join(claudeDir, file), 'utf8');
    } catch {
      continue;
    }
    const parsed = parseProfileSettings(raw, { fileName: file });
    if (parsed) {
      profiles.push({ ...parsed, file });
    }
  }

  const usedSlugs = new Set();
  for (const profile of profiles) {
    let slug = slugifyProfileName(profile.name);
    if (usedSlugs.has(slug)) {
      slug = `${slug}-${profile.credentialKey.slice(0, 6)}`;
    }
    usedSlugs.add(slug);
    profile.slug = slug;
    profile.providerName = providerNameForSlug(slug);
    profile.modelId = `${profile.providerName}/${profile.opusModel}`;
  }

  profiles.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  return profiles;
}

// Profile app đang được kích hoạt. Đối chiếu baseUrl+apiKey với danh sách file
// để lấy đúng slug (settings.json chỉ là bản copy nên không tự biết mình là ai).
function readActiveAppProfile({ claudeDir = CLAUDE_DIR, profiles = null } = {}) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(claudeDir, ACTIVE_SETTINGS_FILE), 'utf8');
  } catch {
    return null;
  }
  const active = parseProfileSettings(raw);
  if (!active) {
    return null;
  }
  const known = profiles || listAppProfiles({ claudeDir });
  const matched = known.find((profile) => profile.credentialKey === active.credentialKey);
  if (matched) {
    return { ...matched, active: true };
  }
  // settings.json bị sửa tay, không khớp profile nào: vẫn dùng được nhưng
  // đánh dấu untracked để log/embed nói rõ.
  const slug = slugifyProfileName(active.name);
  return {
    ...active,
    file: ACTIVE_SETTINGS_FILE,
    slug,
    providerName: providerNameForSlug(slug),
    modelId: `${providerNameForSlug(slug)}/${active.opusModel}`,
    active: true,
    untracked: true,
  };
}

// Transport anthropic-messages của OpenClaw BẮT BUỘC maxTokens > 0 cho mỗi model,
// nếu thiếu thì mọi request đều chết với "requires a positive maxTokens value"
// (schema lại cho phép thiếu, nên lỗi chỉ hiện ra lúc gọi thật). Vì vậy luôn ghi
// maxTokens + contextWindow cho mọi model đăng ký.
const DEFAULT_MAX_TOKENS = 32000;
const DEFAULT_CONTEXT_WINDOW = 200000;

// Model không phải Claude đi qua proxy anthropic-messages thường có cửa sổ nhỏ
// hơn; giữ mức an toàn để không bị proxy từ chối vì maxTokens quá lớn.
function modelLimitsFor(id) {
  if (/^claude-(opus|sonnet)/i.test(id)) {
    return { maxTokens: DEFAULT_MAX_TOKENS, contextWindow: DEFAULT_CONTEXT_WINDOW };
  }
  if (/^claude-haiku/i.test(id)) {
    return { maxTokens: 8192, contextWindow: DEFAULT_CONTEXT_WINDOW };
  }
  return { maxTokens: 8192, contextWindow: 128000 };
}

// Payload provider cho một profile app.
// backendModelIds = model thật mà key đó dùng được (lấy từ /v1/models) — đăng ký
// hết để bảng chọn của bot có thể route tới bất kỳ model nào, không chỉ 3 tier
// khai báo trong settings_<Tên>.json.
// existingModelIds = model đã đăng ký trong openclaw.json. Chỉ dùng khi
// backendModelIds RỖNG (backend offline / hết quota / endpoint /models lỗi): khi
// đó giữ nguyên danh sách cũ thay vì thu về 3 tier, vì --replace-path cho phép
// ghi danh sách ngắn hơn nên một lần fetch lỗi sẽ xóa sạch model dùng được.
function providerPayloadForProfile(profile, {
  backendModelIds = [],
  existingModelIds = [],
} = {}) {
  const models = [];
  const seen = new Set();
  const entries = [
    [profile.opusModel, 'Opus'],
    [profile.sonnetModel, 'Sonnet'],
    [profile.haikuModel, 'Haiku'],
  ];
  for (const [id, tier] of entries) {
    const value = String(id || '').trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    models.push({
      id: value,
      name: `${profile.name} ${tier}`,
      input: ['text', 'image'],
      ...modelLimitsFor(value),
    });
  }
  const source = (backendModelIds || []).length > 0 ? backendModelIds : existingModelIds;
  const extras = [...new Set((source || [])
    .map((id) => String(id || '').trim())
    .filter(Boolean))]
    .filter((id) => !seen.has(id))
    .sort((a, b) => a.localeCompare(b));
  for (const id of extras) {
    seen.add(id);
    models.push({
      id,
      name: `${profile.name} ${id}`,
      input: ['text', 'image'],
      ...modelLimitsFor(id),
    });
  }
  return {
    baseUrl: profile.baseUrl.replace(/\/+$/, ''),
    apiKey: profile.apiKey,
    api: 'anthropic-messages',
    models,
  };
}

function providersEquivalent(current, next) {
  if (!current) {
    return false;
  }
  if (String(current.baseUrl || '').replace(/\/+$/, '') !== next.baseUrl
    || String(current.apiKey || '') !== next.apiKey
    || String(current.api || '') !== next.api) {
    return false;
  }
  // So cả maxTokens/contextWindow: provider cũ đăng ký thiếu maxTokens vẫn phải
  // được ghi lại, nếu chỉ so id thì cấu hình lỗi sẽ không bao giờ được sửa.
  const fingerprint = (list) => (list || [])
    .map((m) => [
      String(m?.id || ''),
      Number(m?.maxTokens) || 0,
      Number(m?.contextWindow ?? m?.contextTokens) || 0,
    ].join(':'))
    .sort();
  const currentIds = fingerprint(current.models);
  const nextIds = fingerprint(next.models);
  return currentIds.length === nextIds.length
    && currentIds.every((id, index) => id === nextIds[index]);
}

function openclawCliCommand() {
  return process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw';
}

// Ghi patch qua CLI để được validate theo schema; OpenClaw áp dụng thay đổi
// provider mà không cần restart gateway.
// replacePaths: CLI từ chối patch nếu mảng models mới bỏ bớt entry đang có
// ("Refusing to replace ... it would remove existing entries"), nên phải khai báo
// --replace-path cho đúng đường dẫn mảng đó.
function runConfigPatchOnce(patch, {
  cliCommand = openclawCliCommand(),
  timeoutMs = PATCH_TIMEOUT_MS,
  replacePaths = [],
} = {}) {
  return new Promise((resolve, reject) => {
    const args = ['config', 'patch', '--stdin'];
    for (const replacePath of replacePaths) {
      args.push('--replace-path', replacePath);
    }
    const child = spawn(cliCommand, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new ClaudeProfileError('Hết thời gian chờ khi ghi cấu hình OpenClaw.'));
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(new ClaudeProfileError(`Không chạy được CLI OpenClaw: ${error.message}`, error));
    });
    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        // Giữ lại stderr: trước đây thông báo chỉ có mã lỗi nên nguyên nhân thật
        // (vd xung đột optimistic lock) bị nuốt, không debug được từ log.
        const detail = String(stderr || stdout || '').trim().split('\n')[0].slice(0, 300);
        const error = new ClaudeProfileError(
          `CLI OpenClaw trả mã ${code} khi ghi cấu hình provider.${detail ? ` ${detail}` : ''}`,
        );
        error.exitCode = code;
        error.stderr = stderr;
        error.conflict = CONFLICT_PATTERN.test(`${stderr}\n${stdout}`);
        reject(error);
      }
    });

    child.stdin.on('error', () => { /* child đã thoát, lỗi được xử lý ở 'close' */ });
    child.stdin.end(JSON.stringify(patch));
  });
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// Hàng đợi tuần tự hóa MỌI patch của tiến trình bot: nhiều kênh Discord có thể
// cùng mở bảng chọn model, mỗi lượt lại patch provider + route model cứng. Ghi
// tuần tự loại bỏ nguồn xung đột do chính bot gây ra; retry bên dưới chỉ còn
// phải lo xung đột với tiến trình khác (app desktop, CLI người dùng gõ tay).
let patchQueue = Promise.resolve();

// Bọc runConfigPatchOnce với retry cho riêng lỗi xung đột optimistic lock.
// Các lỗi khác (schema sai, CLI thiếu) fail ngay để không chờ vô ích.
async function runConfigPatch(patch, options = {}) {
  const run = async () => {
    let lastError = null;
    for (let attempt = 0; attempt <= PATCH_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        return await runConfigPatchOnce(patch, options);
      } catch (error) {
        lastError = error;
        if (!error.conflict || attempt === PATCH_RETRY_DELAYS_MS.length) {
          throw error;
        }
        await sleep(PATCH_RETRY_DELAYS_MS[attempt]);
      }
    }
    throw lastError;
  };
  // Nối vào đuôi hàng đợi; lỗi của lượt trước không được chặn lượt sau.
  const result = patchQueue.then(run, run);
  patchQueue = result.catch(() => {});
  return result;
}

function readOpenClawProviderMap(configPath) {
  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return data?.models?.providers || {};
  } catch {
    return {};
  }
}

// Đảm bảo mọi profile app đều có provider tương ứng trong openclaw.json.
// Chỉ ghi khi thực sự có thay đổi để tránh patch mỗi lần gọi.
// backendModelsByKey: Map(credentialKey -> [model id thật của key đó]) để đăng ký
// đầy đủ model thay vì chỉ 3 tier khai báo.
async function syncProvidersForProfiles(profiles, {
  configPath,
  runPatch = runConfigPatch,
  removeStale = true,
  backendModelsByKey = null,
} = {}) {
  if (!Array.isArray(profiles) || profiles.length === 0) {
    return { changed: false, added: [], updated: [], removed: [] };
  }
  const existing = readOpenClawProviderMap(configPath);
  const patchProviders = {};
  const patchModels = {};
  const replacePaths = [];
  const added = [];
  const updated = [];
  const removed = [];

  for (const profile of profiles) {
    const backendModelIds = backendModelsByKey
      ? (backendModelsByKey.get(profile.credentialKey) || [])
      : [];
    const current = existing[profile.providerName];
    const existingModelIds = (current?.models || [])
      .map((model) => String(model?.id || '').trim())
      .filter(Boolean);
    const payload = providerPayloadForProfile(profile, { backendModelIds, existingModelIds });
    if (providersEquivalent(current, payload)) {
      continue;
    }
    patchProviders[profile.providerName] = payload;
    patchModels[`${profile.providerName}/*`] = {};
    // Mảng models được thay nguyên khối: khai báo replace-path để CLI không từ
    // chối khi danh sách model mới ngắn hơn danh sách cũ.
    replacePaths.push(`models.providers.${profile.providerName}.models`);
    (current ? updated : added).push(profile.providerName);
  }

  if (removeStale) {
    const wanted = new Set(profiles.map((profile) => profile.providerName));
    for (const name of Object.keys(existing)) {
      if (isManagedProviderName(name) && !wanted.has(name)) {
        patchProviders[name] = null;
        patchModels[`${name}/*`] = null;
        removed.push(name);
      }
    }
  }

  if (Object.keys(patchProviders).length === 0) {
    return { changed: false, added, updated, removed };
  }

  await runPatch({
    models: { providers: patchProviders },
    agents: { defaults: { models: patchModels } },
  }, { replacePaths });
  return { changed: true, added, updated, removed };
}

module.exports = {
  ACTIVE_SETTINGS_FILE,
  CLAUDE_DIR,
  ClaudeProfileError,
  PROVIDER_PREFIX,
  credentialKey,
  displayNameFromFile,
  isManagedProviderName,
  listAppProfiles,
  parseProfileSettings,
  providerPayloadForProfile,
  providersEquivalent,
  readActiveAppProfile,
  readOpenClawProviderMap,
  runConfigPatch,
  runConfigPatchOnce,
  slugifyProfileName,
  syncProvidersForProfiles,
};

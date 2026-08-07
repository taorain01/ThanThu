'use strict';

// Danh mục model tổng hợp cho bảng chọn `. o m` của bot Discord.
//
// Bảng chọn chia làm 3 cấp để tránh vượt giới hạn cứng 25 options của
// StringSelectMenu Discord:
//   - Cấp 1: chọn NHÓM — "Claude" (gom toàn bộ profile app) và từng profile
//     cứng của bot (9router / local / opus).
//   - Cấp 2: với nhóm Claude → chọn profile app (Tuat, Ying, BBDEV…);
//     với nhóm cứng → chọn luôn model của backend đó.
//   - Cấp 3: chọn model của profile app (opus/sonnet/haiku khai báo + model
//     backend thật bổ sung).
// Model thật của từng backend được gọi qua /models (fallback /v1/models) —
// gồm cả ollama (gemma4:e4b, qwen3.5:… ) và 9router (GPT55, cx/gpt-5.6-sol…).

const MODEL_PICK_PAGE_SIZE = 25;
const BACKEND_MODELS_TIMEOUT_MS = 8000;

// Nhóm cấp 1 gom toàn bộ profile app; các nhóm còn lại trùng tên profile cứng
// trong config.openclawBackendModels (9router / local / opus).
const GROUP_APP_PROFILES = 'claude';

// Lấy danh sách model thật của một backend: thử /models rồi /v1/models (tùy
// proxy). Endpoint hỏng hoặc backend offline → trả [] để caller dùng model đã
// khai báo thay thế. Ollama/9router local không cần API key.
async function fetchBackendModels({ baseUrl, apiKey = null, fetchImpl = fetch } = {}) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) {
    return [];
  }
  // Cùng một signal cho cả hai endpoint: tổng thời gian chờ ≤ 8 giây/backend.
  const signal = AbortSignal.timeout(BACKEND_MODELS_TIMEOUT_MS);
  for (const endpoint of [`${base}/models`, `${base}/v1/models`]) {
    try {
      const headers = {};
      if (String(apiKey || '').trim()) {
        headers.Authorization = `Bearer ${apiKey}`;
      }
      const response = await fetchImpl(endpoint, {
        method: 'GET',
        headers,
        signal,
      });
      if (!response.ok) {
        continue;
      }
      const payload = await response.json();
      const ids = (payload?.data || payload?.models || [])
        .map((m) => (m && typeof m.id === 'string' ? m.id.trim() : null))
        .filter(Boolean);
      if (ids.length > 0) {
        return [...new Set(ids)];
      }
    } catch {
      // Thử endpoint tiếp theo; hết thời gian → trả []
    }
  }
  return [];
}

// Bậc model trong profile (Opus/Sonnet/Haiku) để dán nhãn cho dễ nhận biết.
function tierOfModel(modelId, profile) {
  const id = String(modelId || '');
  if (id === profile.opusModel) {
    return 'Opus';
  }
  if (id === profile.sonnetModel) {
    return 'Sonnet';
  }
  if (id === profile.haikuModel) {
    return 'Haiku';
  }
  return null;
}

// Nhóm profile app theo backend thật (baseUrl + apiKey) để chỉ gọi /models một
// lần cho mỗi backend thay vì cho mỗi profile (Ying/YingFree cùng proxy chung).
function groupProfilesByCredential(profiles) {
  const groups = new Map();
  for (const profile of profiles) {
    let group = groups.get(profile.credentialKey);
    if (!group) {
      group = {
        credentialKey: profile.credentialKey,
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
        profiles: [],
      };
      groups.set(profile.credentialKey, group);
    }
    group.profiles.push(profile);
  }
  return [...groups.values()].sort((a, b) => a.baseUrl.localeCompare(b.baseUrl));
}

// Cấp 1: nhóm chọn (Claude + profile cứng).
function buildGroupPickerOptions({ appProfileCount = 0, hardcodedGroups = [] } = {}) {
  const options = [];
  options.push({
    label: `Claude — ${appProfileCount} profile app`,
    description: appProfileCount ? 'Tuat, Ying, BBDEV, H&T Store…' : 'Chưa có profile app',
    value: `group:${GROUP_APP_PROFILES}`,
  });
  for (const group of hardcodedGroups) {
    options.push({
      label: `${group.name} — ${group.model}`,
      description: group.baseUrl ? 'Chọn model của backend này' : 'Chọn model khai báo',
      value: `group:${group.name}`,
    });
  }
  return options;
}

// Cấp 2 (nhóm Claude): profile app, đánh dấu profile đang bật/đang dùng.
function buildProfilePickerOptions(profiles = [], current = {}) {
  const options = [];
  const sorted = [...profiles].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  for (const profile of sorted) {
    const inUse = String(current.customModel || '').startsWith(`${profile.providerName}/`);
    options.push({
      label: `${profile.active ? '● ' : ''}${profile.name}`,
      description: inUse ? 'Đang dùng' : profile.opusModel,
      value: `profile:${profile.credentialKey}`,
    });
  }
  return options;
}

// Cấp 3: model của một profile app — opus → sonnet → haiku rồi model backend
// bổ sung theo bảng chữ cái.
function buildProfileModelOptions(profile, backendModelIds = [], current = {}) {
  const options = [];
  const usedValues = new Set();

  function addOption(option) {
    if (usedValues.has(option.value)) {
      return false;
    }
    usedValues.add(option.value);
    options.push({
      label: String(option.label).slice(0, 100),
      description: String(option.description).slice(0, 100),
      value: option.value,
    });
    return true;
  }

  const declared = [profile.opusModel, profile.sonnetModel, profile.haikuModel]
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  const seen = new Set();
  const ordered = [];
  for (const id of declared) {
    if (!seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  }
  const extras = (backendModelIds || [])
    .filter((id) => !seen.has(id))
    .sort((a, b) => a.localeCompare(b));

  for (const id of [...ordered, ...extras]) {
    const value = `${profile.providerName}/${id}`;
    const isMain = id === profile.opusModel;
    const tier = tierOfModel(id, profile);
    const parts = [];
    if (tier) {
      parts.push(tier);
    }
    if (current.customModel === value) {
      parts.push('Đang dùng');
    }
    if (profile.active) {
      parts.push('App đang bật');
    }
    addOption({
      label: `${profile.active && isMain ? '● ' : ''}${profile.name} — ${id}`,
      description: [...parts, value].join(' · '),
      value: `model:${value}`,
    });
  }
  return options;
}

// Cấp 2 (nhóm cứng 9router/local/opus): model khai báo + model backend thật.
// Model backend trả về chưa có prefix provider (ollama trả "gemma4:e4b") nên
// được thêm prefix của model khai báo ("ollama/") để route đúng provider.
function buildHardGroupModelOptions(group, backendModelIds = [], current = {}) {
  const options = [];
  const declared = String(group.model || '').trim();
  const prefix = declared.includes('/')
    ? `${declared.split('/')[0]}/`
    : `${group.name}/`;
  const fullId = (id) => (String(id).startsWith(prefix) ? String(id) : `${prefix}${id}`);
  const seen = new Set();
  const ids = [];
  if (declared) {
    ids.push(declared);
    seen.add(declared);
  }
  for (const id of (backendModelIds || []).sort((a, b) => a.localeCompare(b))) {
    const value = fullId(id);
    if (!seen.has(value)) {
      ids.push(value);
      seen.add(value);
    }
  }
  for (const id of ids) {
    const active = !current.customModel && current.modelProfile === group.name && id === declared;
    const parts = [];
    if (active) {
      parts.push('Đang dùng');
    }
    if (id === declared) {
      parts.push('Profile cứng');
    }
    options.push({
      label: `${group.name} — ${id}`,
      description: [...parts, id].join(' · '),
      value: `model:${id}`,
    });
  }
  return options;
}

// Danh mục gộp toàn bộ model (mọi profile + mọi nhóm cứng) — dùng cho tìm
// kiếm bằng `> o m <model-id>` và đếm tổng model/backend.
function buildCatalogOptions({
  appProfiles = [],
  backendModelsByKey = new Map(),
  hardcodedGroups = [],
  current = {},
} = {}) {
  const options = [];
  const sortedProfiles = [...appProfiles].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  for (const profile of sortedProfiles) {
    options.push(...buildProfileModelOptions(
      profile,
      backendModelsByKey.get(profile.credentialKey) || [],
      current,
    ));
  }
  for (const group of hardcodedGroups) {
    options.push(...buildHardGroupModelOptions(
      group,
      backendModelsByKey.get(group.name) || [],
      current,
    ));
  }
  return {
    options,
    modelCount: options.length,
    backendCount: backendModelsByKey.size,
  };
}

// Cắt danh mục thành từng trang 25 options. Trang ngoài khoảng bị kẹp về
// trang hợp lệ; danh mục rỗng vẫn trả một trang rỗng để UI ổn định.
function paginateOptions(options, page, pageSize = MODEL_PICK_PAGE_SIZE) {
  const total = Array.isArray(options) ? options.length : 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(0, Math.floor(Number(page) || 0)), pageCount - 1);
  return {
    page: safePage,
    pageCount,
    options: options.slice(safePage * pageSize, (safePage + 1) * pageSize),
  };
}

// Tìm option model theo ID người dùng gõ trong `> o m <model-id>`. So khớp
// theo phần đuôi của ID nên gõ "claude-opus-4-6" cũng tìm được
// "capp-ying/claude-opus-4-6", và gõ "anthropic/claude-opus-4-6" cũng khớp.
function findModelInCatalog(options, needle) {
  const wanted = String(needle || '').toLowerCase().trim();
  if (!wanted) {
    return null;
  }
  const lastSegment = (id) => String(id).split('/').filter(Boolean).at(-1) || '';
  return (options || []).find((option) => {
    if (!String(option.value || '').startsWith('model:')) {
      return false;
    }
    const modelId = option.value.slice('model:'.length).toLowerCase();
    return modelId === wanted || lastSegment(modelId) === lastSegment(wanted);
  }) || null;
}

module.exports = {
  BACKEND_MODELS_TIMEOUT_MS,
  GROUP_APP_PROFILES,
  MODEL_PICK_PAGE_SIZE,
  buildCatalogOptions,
  buildGroupPickerOptions,
  buildHardGroupModelOptions,
  buildProfileModelOptions,
  buildProfilePickerOptions,
  fetchBackendModels,
  findModelInCatalog,
  groupProfilesByCredential,
  paginateOptions,
  tierOfModel,
};

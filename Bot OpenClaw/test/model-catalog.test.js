'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
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
} = require('../src/model-catalog');

// Profile app giống cấu hình thật: mỗi profile một provider capp-<slug> và
// khai báo opus/sonnet/haiku riêng.
function profile({ name, providerName, credKey, opus, sonnet = null, haiku = null, active = false }) {
  return {
    name,
    providerName,
    credentialKey: credKey,
    opusModel: opus,
    sonnetModel: sonnet || opus,
    haikuModel: haiku || opus,
    active,
  };
}

const PROFILES = [
  profile({ name: 'Ying', providerName: 'capp-ying', credKey: 'k-ying', opus: 'claude-opus-5', sonnet: 'claude-sonnet-5', haiku: 'claude-haiku-4-5', active: true }),
  // Cùng backend với Ying nhưng API key khác (account khác).
  profile({ name: 'YingFree', providerName: 'capp-yingfree', credKey: 'k-yingfree', opus: 'claude-opus-5' }),
  profile({ name: 'Tuat 1 ngay', providerName: 'capp-tuat-1-ngay', credKey: 'k-tuat', opus: 'claude-opus-5', sonnet: 'claude-sonnet-5' }),
];

// Nhóm cứng giống config thật, kèm baseUrl/apiKey đọc từ openclaw.json.
const HARD_GROUPS = [
  { name: '9router', model: '9router/cx/gpt-5.6-sol', baseUrl: 'http://127.0.0.1:20128/v1', apiKey: null },
  { name: 'local', model: 'ollama/qwen3:8b', baseUrl: 'http://127.0.0.1:11434', apiKey: null },
  { name: 'opus', model: 'anthropic/claude-opus-5', baseUrl: null, apiKey: null },
];

// Map key: credentialKey cho nhóm app, tên nhóm cho nhóm cứng.
const BACKEND_MODELS = new Map([
  ['k-ying', ['claude-haiku-4-5', 'claude-opus-4-6', 'claude-opus-5', 'claude-sonnet-5']],
  ['k-yingfree', ['claude-opus-5']],
  ['k-tuat', []],
  // Ollama thật: gemma4:e4b, qwen3.5:… (user yêu cầu các model local này).
  ['local', ['gemma4:latest', 'gemma4:e4b', 'gemma4:e2b', 'qwen3.5:27b', 'qwen3.5:9b', 'qwen3.5:4b']],
  ['9router', ['GPT55', 'claude', 'cx/gpt-5.6-sol']],
]);

function buildCatalog(overrides = {}) {
  return buildCatalogOptions({
    appProfiles: PROFILES,
    backendModelsByKey: BACKEND_MODELS,
    hardcodedGroups: HARD_GROUPS,
    current: { customModel: null, modelProfile: null },
    ...overrides,
  });
}

test('groupProfilesByCredential nhóm theo backend và sắp theo baseUrl', () => {
  const groups = groupProfilesByCredential([
    { credentialKey: 'a', baseUrl: 'https://z.example', apiKey: 'z' },
    { credentialKey: 'b', baseUrl: 'https://a.example', apiKey: 'a' },
    { credentialKey: 'a', baseUrl: 'https://z.example', apiKey: 'z' },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].baseUrl, 'https://a.example');
  assert.equal(groups[1].profiles.length, 2);
});

test('fetchBackendModels đọc /models rồi fallback /v1/models', async () => {
  const calls = [];
  const ok = (data) => ({ ok: true, json: async () => data });

  // Base URL đã có /v1 → endpoint đầu tiên là /v1/models luôn, không fallback.
  const viaV1 = await fetchBackendModels({
    baseUrl: 'https://proxy.example/v1/',
    apiKey: 'secret',
    fetchImpl: async (url) => {
      calls.push(url);
      return url.endsWith('/v1/models')
        ? ok({ data: [{ id: 'claude-opus-5' }, { id: 'claude-sonnet-5' }] })
        : { ok: false, json: async () => ({}) };
    },
  });
  assert.deepEqual(viaV1, ['claude-opus-5', 'claude-sonnet-5']);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].endsWith('/v1/models'));

  // Base URL không có /v1 → thử /models trước rồi fallback /v1/models.
  calls.length = 0;
  const viaFallback = await fetchBackendModels({
    baseUrl: 'https://proxy.example',
    apiKey: 'secret',
    fetchImpl: async (url) => {
      calls.push(url);
      return url.endsWith('/v1/models')
        ? ok({ models: [{ id: 'claude-opus-5' }] })
        : { ok: false, json: async () => ({}) };
    },
  });
  assert.deepEqual(viaFallback, ['claude-opus-5']);
  assert.ok(calls[0].endsWith('/models'));
  assert.ok(calls[1].endsWith('/v1/models'));
});

test('fetchBackendModels gọi không cần API key (ollama/9router local)', async () => {
  let sentHeader = null;
  const ids = await fetchBackendModels({
    baseUrl: 'http://127.0.0.1:11434',
    fetchImpl: async (_url, options) => {
      sentHeader = options.headers.Authorization;
      return {
        ok: true,
        json: async () => ({ data: [{ id: 'gemma4:e4b' }, { id: 'qwen3.5:4b' }] }),
      };
    },
  });
  assert.deepEqual(ids, ['gemma4:e4b', 'qwen3.5:4b']);
  assert.equal(sentHeader, undefined);
});

test('fetchBackendModels giữ nguyên dạng ID backend (không thêm prefix)', async () => {
  const ids = await fetchBackendModels({
    baseUrl: 'https://proxy.example',
    apiKey: 'secret',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ models: [{ id: 'claude-opus-5' }, { id: 'claude-opus-4-6' }] }),
    }),
  });
  assert.deepEqual(ids, ['claude-opus-5', 'claude-opus-4-6']);
});

test('fetchBackendModels trả [] khi cả hai endpoint hỏng hoặc thiếu baseUrl', async () => {
  const failing = await fetchBackendModels({
    baseUrl: 'https://proxy.example',
    apiKey: 'secret',
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.deepEqual(failing, []);
  assert.deepEqual(await fetchBackendModels({ baseUrl: '', apiKey: 'x' }), []);
  assert.deepEqual(await fetchBackendModels({}), []);
});

test('tierOfModel nhận diện đúng bậc opus/sonnet/haiku', () => {
  const p = PROFILES[0];
  assert.equal(tierOfModel('claude-opus-5', p), 'Opus');
  assert.equal(tierOfModel('claude-sonnet-5', p), 'Sonnet');
  assert.equal(tierOfModel('claude-haiku-4-5', p), 'Haiku');
  assert.equal(tierOfModel('claude-opus-4-6', p), null);
});

test('buildGroupPickerOptions ra nhóm Claude trước rồi từng nhóm cứng', () => {
  const options = buildGroupPickerOptions({
    appProfileCount: 7,
    hardcodedGroups: HARD_GROUPS,
  });
  assert.equal(options[0].value, `group:${GROUP_APP_PROFILES}`);
  assert.match(options[0].label, /^Claude — 7 profile app$/);
  assert.deepEqual(options.map((o) => o.value), [
    'group:claude',
    'group:9router',
    'group:local',
    'group:opus',
  ]);
});

test('buildProfilePickerOptions liệt kê profile, đánh dấu đang dùng', () => {
  const options = buildProfilePickerOptions(PROFILES, { customModel: 'capp-ying/claude-sonnet-5' });
  const ying = options.find((o) => o.value === 'profile:k-ying');
  assert.equal(ying.label, '● Ying');
  assert.match(ying.description, /Đang dùng/);
  const tuat = options.find((o) => o.value === 'profile:k-tuat');
  assert.equal(tuat.description, 'claude-opus-5');
});

test('buildProfileModelOptions: opus → sonnet → haiku → model backend bổ sung', () => {
  const ying = PROFILES.find((p) => p.credentialKey === 'k-ying');
  const options = buildProfileModelOptions(ying, BACKEND_MODELS.get('k-ying'), {});
  assert.deepEqual(options.map((o) => o.value), [
    'model:capp-ying/claude-opus-5',
    'model:capp-ying/claude-sonnet-5',
    'model:capp-ying/claude-haiku-4-5',
    'model:capp-ying/claude-opus-4-6',
  ]);
  assert.match(options[0].label, /^● Ying — claude-opus-5$/);
  assert.match(options[0].description, /^Opus · App đang bật · capp-ying\/claude-opus-5$/);
});

test('buildHardGroupModelOptions: model khai báo trước, rồi model backend thật', () => {
  const local = HARD_GROUPS.find((g) => g.name === 'local');
  const options = buildHardGroupModelOptions(local, BACKEND_MODELS.get('local'), {});
  assert.deepEqual(options.map((o) => o.value), [
    'model:ollama/qwen3:8b',
    'model:ollama/gemma4:e2b',
    'model:ollama/gemma4:e4b',
    'model:ollama/gemma4:latest',
    'model:ollama/qwen3.5:27b',
    'model:ollama/qwen3.5:4b',
    'model:ollama/qwen3.5:9b',
  ]);
  assert.match(options[0].description, /Profile cứng/);
  // Model local user yêu cầu đều có trong danh sách.
  for (const id of ['ollama/gemma4:e4b', 'ollama/gemma4:e2b', 'ollama/qwen3.5:27b', 'ollama/qwen3.5:9b', 'ollama/qwen3.5:4b']) {
    assert.ok(options.some((o) => o.value === `model:${id}`), `thiếu ${id}`);
  }
});

test('buildHardGroupModelOptions đánh dấu nhóm cứng đang dùng của kênh', () => {
  const opus = HARD_GROUPS.find((g) => g.name === 'opus');
  const options = buildHardGroupModelOptions(opus, [], {
    customModel: null,
    modelProfile: 'opus',
  });
  assert.equal(options.length, 1);
  assert.equal(options[0].value, 'model:anthropic/claude-opus-5');
  assert.match(options[0].description, /^Đang dùng · Profile cứng/);
});

test('buildCatalogOptions xếp profile trước, nhóm cứng cuối', () => {
  const { options } = buildCatalog();
  const values = options.map((o) => o.value);
  const ying = values.filter((v) => v.startsWith('model:capp-ying/'));
  assert.deepEqual(ying, [
    'model:capp-ying/claude-opus-5',
    'model:capp-ying/claude-sonnet-5',
    'model:capp-ying/claude-haiku-4-5',
    'model:capp-ying/claude-opus-4-6',
  ]);
  const tuat = values.filter((v) => v.startsWith('model:capp-tuat-1-ngay/'));
  assert.deepEqual(tuat, [
    'model:capp-tuat-1-ngay/claude-opus-5',
    'model:capp-tuat-1-ngay/claude-sonnet-5',
  ]);
  // Nhóm cứng ở cuối.
  assert.equal(options.at(-1).value, 'model:anthropic/claude-opus-5');
  assert.ok(options.some((o) => o.value === 'model:ollama/gemma4:e4b'));
  assert.ok(options.some((o) => o.value === 'model:9router/GPT55'));
});

test('buildCatalogOptions đếm đúng modelCount/backendCount', () => {
  const { modelCount, backendCount } = buildCatalog();
  // Ying: 4 · YingFree: 1 · Tuat: 2 · local: 7 · 9router: 3 (declared + GPT55 + claude) · opus: 1
  assert.equal(modelCount, 18);
  assert.equal(backendCount, 5);
});

test('paginateOptions cắt đúng 25 options/trang và kẹp trang ngoài khoảng', () => {
  const options = Array.from({ length: 60 }, (_, i) => ({ value: `model:${i}` }));
  const first = paginateOptions(options, 0);
  assert.equal(first.page, 0);
  assert.equal(first.pageCount, 3);
  assert.equal(first.options.length, 25);

  const last = paginateOptions(options, 99);
  assert.equal(last.page, 2);
  assert.equal(last.options.length, 10);
  assert.equal(last.options.at(-1).value, 'model:59');

  const negative = paginateOptions(options, -3);
  assert.equal(negative.page, 0);
});

test('paginateOptions xử lý danh mục rỗng và vừa khít một trang', () => {
  const empty = paginateOptions([], 2);
  assert.equal(empty.page, 0);
  assert.equal(empty.pageCount, 1);
  assert.deepEqual(empty.options, []);

  const exact = paginateOptions(Array.from({ length: MODEL_PICK_PAGE_SIZE }, (_, i) => i), 0);
  assert.equal(exact.pageCount, 1);
  assert.equal(exact.options.length, MODEL_PICK_PAGE_SIZE);
});

test('findModelInCatalog khớp ID đầy đủ hoặc phần đuôi ID', () => {
  const { options } = buildCatalog();
  const byFull = findModelInCatalog(options, 'capp-ying/claude-opus-4-6');
  assert.equal(byFull?.value, 'model:capp-ying/claude-opus-4-6');
  const byBare = findModelInCatalog(options, 'claude-opus-4-6');
  assert.equal(byBare?.value, 'model:capp-ying/claude-opus-4-6');
  const byAnthropic = findModelInCatalog(options, 'anthropic/claude-opus-4-6');
  assert.equal(byAnthropic?.value, 'model:capp-ying/claude-opus-4-6');
  const byUpper = findModelInCatalog(options, 'CLAUDE-OPUS-4-6');
  assert.equal(byUpper?.value, 'model:capp-ying/claude-opus-4-6');
  // Model local tìm theo tên backend hoặc ID model.
  const byLocal = findModelInCatalog(options, 'ollama/qwen3.5:4b');
  assert.equal(byLocal?.value, 'model:ollama/qwen3.5:4b');
});

test('findModelInCatalog không khớp nhóm hay chuỗi rỗng', () => {
  const { options } = buildCatalog();
  assert.equal(findModelInCatalog(options, '9router'), null);
  assert.equal(findModelInCatalog(options, ''), null);
  assert.equal(findModelInCatalog(options, 'gpt-5.6-sol-missing'), null);
});

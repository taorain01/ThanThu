'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  PROVIDER_PREFIX,
  credentialKey,
  displayNameFromFile,
  isManagedProviderName,
  listAppProfiles,
  parseProfileSettings,
  providerPayloadForProfile,
  providersEquivalent,
  readActiveAppProfile,
  runConfigPatch,
  slugifyProfileName,
  syncProvidersForProfiles,
} = require('../src/claude-profiles');

function tempClaudeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claude-profiles-test-'));
}

function writeProfile(dir, fileName, content) {
  fs.writeFileSync(path.join(dir, fileName), JSON.stringify(content));
}

function profileSettings({ name, baseUrl, apiKey, opus, sonnet, haiku }) {
  const env = {
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_AUTH_TOKEN: apiKey,
  };
  if (opus) {
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = opus;
  }
  if (sonnet) {
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnet;
  }
  if (haiku) {
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = haiku;
  }
  return name ? { profile_name: name, env } : { env };
}

test('slug hóa tên profile thành tên provider hợp lệ', () => {
  assert.equal(slugifyProfileName('Tuat 1 ngay'), 'tuat-1-ngay');
  assert.equal(slugifyProfileName('H&T Store'), 'h-t-store');
  assert.equal(slugifyProfileName('  YingFree  '), 'yingfree');
  assert.equal(slugifyProfileName('***'), 'profile');
  assert.equal(slugifyProfileName(''), 'profile');
  assert.match(slugifyProfileName('Tên có dấu'), /^[a-z0-9-]+$/);
  assert.equal(slugifyProfileName('x'.repeat(80)).length, 40);
});

test('suy ra tên hiển thị từ tên file khi thiếu profile_name', () => {
  assert.equal(displayNameFromFile('settings_Tuat_1_ngay.json'), 'Tuat 1 ngay');
  assert.equal(displayNameFromFile('settings_tuat_claude.json'), 'Tuat Claude');
  assert.equal(displayNameFromFile('settings_ht_store.json'), 'H&T Store');
  assert.equal(displayNameFromFile('settings_Ying.json'), 'Ying');
});

test('nhận diện provider do bot quản lý', () => {
  assert.equal(isManagedProviderName(`${PROVIDER_PREFIX}ying`), true);
  assert.equal(isManagedProviderName('anthropic'), false);
  assert.equal(isManagedProviderName('9router'), false);
  assert.equal(isManagedProviderName(null), false);
});

test('parse settings profile và bỏ qua file thiếu credential', () => {
  const parsed = parseProfileSettings(JSON.stringify(profileSettings({
    name: 'Ying',
    baseUrl: 'https://api.xpiki.com/v1',
    apiKey: 'sk-ying',
    opus: 'claude-opus-5',
  })));
  assert.equal(parsed.name, 'Ying');
  assert.equal(parsed.baseUrl, 'https://api.xpiki.com/v1');
  assert.equal(parsed.opusModel, 'claude-opus-5');
  assert.match(parsed.credentialKey, /^[a-f0-9]{64}$/);

  assert.equal(parseProfileSettings('{khong-phai-json'), null);
  assert.equal(parseProfileSettings(JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://x' } })), null);
  assert.equal(parseProfileSettings(JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'sk-x' } })), null);
});

test('credentialKey không chứa API key thô', () => {
  const key = credentialKey('https://x', 'sk-secret-value');
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(key.includes('sk-secret-value'), false);
  assert.equal(credentialKey('https://x', 'sk-a'), credentialKey('https://x', 'sk-a'));
  assert.notEqual(credentialKey('https://x', 'sk-a'), credentialKey('https://x', 'sk-b'));
});

test('quét toàn bộ profile app và sinh model id riêng cho từng profile', () => {
  const dir = tempClaudeDir();
  writeProfile(dir, 'settings_Ying.json', profileSettings({
    name: 'Ying', baseUrl: 'https://api.xpiki.com/v1', apiKey: 'sk-ying', opus: 'claude-opus-5',
  }));
  writeProfile(dir, 'settings_Tuat_1_ngay.json', profileSettings({
    name: 'Tuat 1 ngay', baseUrl: 'https://api.tuongtacfree.vn/', apiKey: 'sk-tuat', opus: 'claude-opus-5',
  }));
  writeProfile(dir, 'settings_BBDEV.json', profileSettings({
    name: 'BBDEV', baseUrl: 'https://api.bddevlab.online/', apiKey: 'sk-bdev', opus: 'claude-opus-4.8',
  }));
  // File không phải profile → bị bỏ qua
  writeProfile(dir, 'settings.json', profileSettings({
    name: 'Ying', baseUrl: 'https://api.xpiki.com/v1', apiKey: 'sk-ying', opus: 'claude-opus-5',
  }));
  fs.writeFileSync(path.join(dir, 'settings_broken.json'), 'khong-phai-json');

  const profiles = listAppProfiles({ claudeDir: dir });
  assert.equal(profiles.length, 3);
  assert.deepEqual(profiles.map((p) => p.name), ['BBDEV', 'Tuat 1 ngay', 'Ying']);
  assert.deepEqual(profiles.map((p) => p.providerName), [
    'capp-bbdev',
    'capp-tuat-1-ngay',
    'capp-ying',
  ]);
  assert.equal(profiles[0].modelId, 'capp-bbdev/claude-opus-4.8');
  assert.equal(profiles[2].modelId, 'capp-ying/claude-opus-5');
});

test('profile mới thêm vào thư mục xuất hiện ngay ở lần quét sau', () => {
  const dir = tempClaudeDir();
  writeProfile(dir, 'settings_Ying.json', profileSettings({
    name: 'Ying', baseUrl: 'https://api.xpiki.com/v1', apiKey: 'sk-ying',
  }));
  assert.equal(listAppProfiles({ claudeDir: dir }).length, 1);

  writeProfile(dir, 'settings_MoiThem.json', profileSettings({
    name: 'Moi Them', baseUrl: 'https://api.moithem.dev', apiKey: 'sk-moi',
  }));
  const profiles = listAppProfiles({ claudeDir: dir });
  assert.equal(profiles.length, 2);
  assert.ok(profiles.some((p) => p.providerName === 'capp-moi-them'));
});

test('slug trùng tên được tách bằng credentialKey', () => {
  const dir = tempClaudeDir();
  writeProfile(dir, 'settings_A.json', profileSettings({
    name: 'Trùng Tên', baseUrl: 'https://a.example', apiKey: 'sk-a',
  }));
  writeProfile(dir, 'settings_B.json', profileSettings({
    name: 'Trùng Tên', baseUrl: 'https://b.example', apiKey: 'sk-b',
  }));
  const profiles = listAppProfiles({ claudeDir: dir });
  assert.equal(profiles.length, 2);
  const names = new Set(profiles.map((p) => p.providerName));
  assert.equal(names.size, 2);
});

test('thư mục không tồn tại trả danh sách rỗng', () => {
  assert.deepEqual(listAppProfiles({ claudeDir: path.join(os.tmpdir(), 'khong-ton-tai-abc') }), []);
});

test('đọc profile app đang kích hoạt và khớp đúng slug', () => {
  const dir = tempClaudeDir();
  writeProfile(dir, 'settings_Ying.json', profileSettings({
    name: 'Ying', baseUrl: 'https://api.xpiki.com/v1', apiKey: 'sk-ying', opus: 'claude-opus-5',
  }));
  writeProfile(dir, 'settings_Tuat_1_ngay.json', profileSettings({
    name: 'Tuat 1 ngay', baseUrl: 'https://api.tuongtacfree.vn/', apiKey: 'sk-tuat', opus: 'claude-opus-5',
  }));
  // App kích hoạt = copy nguyên file profile lên settings.json
  fs.copyFileSync(path.join(dir, 'settings_Tuat_1_ngay.json'), path.join(dir, 'settings.json'));

  const active = readActiveAppProfile({ claudeDir: dir });
  assert.equal(active.name, 'Tuat 1 ngay');
  assert.equal(active.providerName, 'capp-tuat-1-ngay');
  assert.equal(active.modelId, 'capp-tuat-1-ngay/claude-opus-5');
  assert.equal(active.active, true);
  assert.equal(active.untracked, undefined);
});

test('settings.json sửa tay không khớp profile nào được đánh dấu untracked', () => {
  const dir = tempClaudeDir();
  writeProfile(dir, 'settings_Ying.json', profileSettings({
    name: 'Ying', baseUrl: 'https://api.xpiki.com/v1', apiKey: 'sk-ying',
  }));
  writeProfile(dir, 'settings.json', profileSettings({
    name: 'Sửa Tay', baseUrl: 'https://la.example', apiKey: 'sk-la', opus: 'claude-opus-5',
  }));
  const active = readActiveAppProfile({ claudeDir: dir });
  assert.equal(active.name, 'Sửa Tay');
  assert.equal(active.untracked, true);
  assert.equal(active.modelId, 'capp-sua-tay/claude-opus-5');
});

test('không có settings.json thì trả null', () => {
  const dir = tempClaudeDir();
  assert.equal(readActiveAppProfile({ claudeDir: dir }), null);
});

test('payload provider gồm 3 tier và bỏ model trùng', () => {
  const payload = providerPayloadForProfile({
    name: 'H&T Store',
    baseUrl: 'https://codex.hungnguyen.codes/',
    apiKey: 'sk-ht',
    opusModel: 'claude-opus-5',
    sonnetModel: 'claude-sonnet-4-6',
    haikuModel: 'claude-sonnet-4-6',
  });
  assert.equal(payload.baseUrl, 'https://codex.hungnguyen.codes');
  assert.equal(payload.api, 'anthropic-messages');
  assert.deepEqual(payload.models.map((m) => m.id), ['claude-opus-5', 'claude-sonnet-4-6']);
  assert.equal(payload.models[0].name, 'H&T Store Opus');
  assert.deepEqual(payload.models[0].input, ['text', 'image']);
});

test('so sánh provider hiện có với payload mới', () => {
  const payload = providerPayloadForProfile({
    name: 'Ying', baseUrl: 'https://api.xpiki.com/v1', apiKey: 'sk-ying',
    opusModel: 'claude-opus-5', sonnetModel: 'claude-sonnet-5', haikuModel: 'claude-haiku-4-5',
  });
  assert.equal(providersEquivalent(null, payload), false);
  assert.equal(providersEquivalent({ ...payload, baseUrl: 'https://api.xpiki.com/v1/' }, payload), true);
  assert.equal(providersEquivalent({ ...payload, apiKey: 'sk-khac' }, payload), false);
  assert.equal(providersEquivalent({ ...payload, api: 'openai-completions' }, payload), false);
  assert.equal(providersEquivalent({ ...payload, models: payload.models.slice(0, 1) }, payload), false);
});

// Transport anthropic-messages của OpenClaw bắt buộc maxTokens > 0, thiếu là mọi
// request đều chết với "requires a positive maxTokens value".
test('mọi model đăng ký đều có maxTokens > 0 và contextWindow', () => {
  const payload = providerPayloadForProfile({
    name: 'Ying',
    baseUrl: 'https://api.xpiki.com/v1',
    apiKey: 'sk-ying',
    opusModel: 'claude-opus-5',
    sonnetModel: 'claude-sonnet-5',
    haikuModel: 'claude-haiku-4-5',
  }, { backendModelIds: ['claude-fable-5', 'deepseek-v4-pro'] });

  assert.ok(payload.models.length >= 5);
  for (const model of payload.models) {
    assert.ok(model.maxTokens > 0, `${model.id} thiếu maxTokens`);
    assert.ok(model.contextWindow > 0, `${model.id} thiếu contextWindow`);
  }
});

test('provider thiếu maxTokens bị coi là khác payload để được ghi lại', () => {
  const profile = {
    name: 'Ying', baseUrl: 'https://api.xpiki.com/v1', apiKey: 'sk-ying',
    opusModel: 'claude-opus-5', sonnetModel: 'claude-sonnet-5', haikuModel: 'claude-haiku-4-5',
  };
  const payload = providerPayloadForProfile(profile);
  // Provider cũ (bot bản trước ghi) có đúng id nhưng không có maxTokens.
  const legacy = {
    ...payload,
    models: payload.models.map(({ id, name, input }) => ({ id, name, input })),
  };
  assert.equal(providersEquivalent(legacy, payload), false);
});

test('đăng ký đầy đủ model thật của key, bỏ trùng với 3 tier khai báo', () => {
  const payload = providerPayloadForProfile({
    name: 'Ying',
    baseUrl: 'https://api.xpiki.com/v1',
    apiKey: 'sk-ying',
    opusModel: 'claude-opus-5',
    sonnetModel: 'claude-sonnet-5',
    haikuModel: 'claude-haiku-4-5',
  }, {
    backendModelIds: ['claude-opus-5', 'claude-opus-4-8', 'claude-fable-5', 'claude-opus-4-6'],
  });

  assert.deepEqual(payload.models.map((m) => m.id), [
    // 3 tier khai báo giữ đúng thứ tự opus → sonnet → haiku
    'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5',
    // model backend bổ sung xếp theo bảng chữ cái, không lặp claude-opus-5
    'claude-fable-5', 'claude-opus-4-6', 'claude-opus-4-8',
  ]);
});

test('sync dùng backendModelsByKey và khai báo replace-path cho mảng models', async () => {
  const profiles = fakeProfiles();
  const configFile = path.join(tempClaudeDir(), 'openclaw.json');
  fs.writeFileSync(configFile, JSON.stringify({ models: { providers: {} } }));

  const backendModelsByKey = new Map([
    [profiles[0].credentialKey, ['claude-fable-5']],
  ]);
  const calls = [];
  const result = await syncProvidersForProfiles(profiles, {
    configPath: configFile,
    backendModelsByKey,
    runPatch: async (patch, options) => { calls.push({ patch, options }); },
  });

  assert.equal(result.changed, true);
  const { patch, options } = calls[0];
  const first = patch.models.providers[profiles[0].providerName];
  assert.ok(first.models.some((m) => m.id === 'claude-fable-5'));
  // Thiếu --replace-path thì CLI từ chối khi danh sách model mới ngắn hơn cũ.
  assert.ok(options.replacePaths.includes(`models.providers.${profiles[0].providerName}.models`));
});

function fakeProfiles() {
  return listAppProfilesFromSpecs([
    { name: 'Ying', baseUrl: 'https://api.xpiki.com/v1', apiKey: 'sk-ying', opus: 'claude-opus-5' },
    { name: 'BBDEV', baseUrl: 'https://api.bddevlab.online', apiKey: 'sk-bdev', opus: 'claude-opus-4.8' },
  ]);
}

function listAppProfilesFromSpecs(specs) {
  const dir = tempClaudeDir();
  for (const spec of specs) {
    writeProfile(dir, `settings_${slugifyProfileName(spec.name).replace(/-/g, '_')}.json`, profileSettings(spec));
  }
  return listAppProfiles({ claudeDir: dir });
}

test('đăng ký provider cho profile chưa có trong openclaw.json', async () => {
  const profiles = fakeProfiles();
  const configFile = path.join(tempClaudeDir(), 'openclaw.json');
  fs.writeFileSync(configFile, JSON.stringify({
    models: { providers: { anthropic: { baseUrl: 'https://api.xpiki.com/v1', api: 'anthropic-messages' } } },
  }));

  const patches = [];
  const result = await syncProvidersForProfiles(profiles, {
    configPath: configFile,
    runPatch: async (patch) => { patches.push(patch); },
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.added.sort(), ['capp-bbdev', 'capp-ying']);
  assert.deepEqual(result.updated, []);
  assert.deepEqual(result.removed, []);
  assert.equal(patches.length, 1);
  assert.deepEqual(Object.keys(patches[0].models.providers).sort(), ['capp-bbdev', 'capp-ying']);
  assert.deepEqual(Object.keys(patches[0].agents.defaults.models).sort(), ['capp-bbdev/*', 'capp-ying/*']);
  // Không đụng tới provider do người dùng tự cấu hình
  assert.equal(Object.hasOwn(patches[0].models.providers, 'anthropic'), false);
});

test('không ghi patch khi provider đã khớp', async () => {
  const profiles = fakeProfiles();
  const providers = {};
  for (const profile of profiles) {
    providers[profile.providerName] = providerPayloadForProfile(profile);
  }
  const configFile = path.join(tempClaudeDir(), 'openclaw.json');
  fs.writeFileSync(configFile, JSON.stringify({ models: { providers } }));

  let called = 0;
  const result = await syncProvidersForProfiles(profiles, {
    configPath: configFile,
    runPatch: async () => { called += 1; },
  });
  assert.equal(result.changed, false);
  assert.equal(called, 0);
});

test('cập nhật provider khi API key của profile đổi', async () => {
  const profiles = fakeProfiles();
  const providers = {};
  for (const profile of profiles) {
    providers[profile.providerName] = providerPayloadForProfile(profile);
  }
  providers[profiles[0].providerName].apiKey = 'sk-cu';
  const configFile = path.join(tempClaudeDir(), 'openclaw.json');
  fs.writeFileSync(configFile, JSON.stringify({ models: { providers } }));

  const patches = [];
  const result = await syncProvidersForProfiles(profiles, {
    configPath: configFile,
    runPatch: async (patch) => { patches.push(patch); },
  });
  assert.equal(result.changed, true);
  assert.deepEqual(result.updated, [profiles[0].providerName]);
  assert.deepEqual(result.added, []);
});

test('xóa provider capp- của profile đã bị xóa khỏi app', async () => {
  const profiles = fakeProfiles();
  const providers = {};
  for (const profile of profiles) {
    providers[profile.providerName] = providerPayloadForProfile(profile);
  }
  providers['capp-da-xoa'] = { baseUrl: 'https://cu.example', apiKey: 'sk-cu', api: 'anthropic-messages', models: [] };
  providers['9router'] = { baseUrl: 'http://127.0.0.1:20128/v1', api: 'openai-completions' };
  const configFile = path.join(tempClaudeDir(), 'openclaw.json');
  fs.writeFileSync(configFile, JSON.stringify({ models: { providers } }));

  const patches = [];
  const result = await syncProvidersForProfiles(profiles, {
    configPath: configFile,
    runPatch: async (patch) => { patches.push(patch); },
  });
  assert.equal(result.changed, true);
  assert.deepEqual(result.removed, ['capp-da-xoa']);
  assert.equal(patches[0].models.providers['capp-da-xoa'], null);
  assert.equal(patches[0].agents.defaults.models['capp-da-xoa/*'], null);
  // Provider của người dùng không bị xóa
  assert.equal(Object.hasOwn(patches[0].models.providers, '9router'), false);
});

test('danh sách profile rỗng thì không ghi gì', async () => {
  let called = 0;
  const result = await syncProvidersForProfiles([], {
    configPath: path.join(os.tmpdir(), 'khong-ton-tai.json'),
    runPatch: async () => { called += 1; },
  });
  assert.equal(result.changed, false);
  assert.equal(called, 0);
});

test('fetch backend thất bại thì giữ nguyên model đã đăng ký, không tụt về 3 tier', () => {
  const profile = {
    name: 'Ying', baseUrl: 'https://api.xpiki.com/v1', apiKey: 'sk-ying',
    opusModel: 'claude-opus-5', sonnetModel: 'claude-sonnet-5', haikuModel: 'claude-haiku-4-5',
  };
  const payload = providerPayloadForProfile(profile, {
    backendModelIds: [],
    existingModelIds: [
      'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5',
      'claude-fable-5', 'claude-opus-4-6', 'claude-opus-4-8',
    ],
  });
  assert.deepEqual(payload.models.map((m) => m.id), [
    'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5',
    'claude-fable-5', 'claude-opus-4-6', 'claude-opus-4-8',
  ]);
});

test('có model backend thật thì bỏ qua danh sách cũ trong config', () => {
  const profile = {
    name: 'Ying', baseUrl: 'https://api.xpiki.com/v1', apiKey: 'sk-ying',
    opusModel: 'claude-opus-5', sonnetModel: 'claude-sonnet-5', haikuModel: 'claude-haiku-4-5',
  };
  const payload = providerPayloadForProfile(profile, {
    backendModelIds: ['claude-opus-5', 'claude-fable-5'],
    // Model cũ đã bị backend gỡ: không được giữ lại nữa.
    existingModelIds: ['claude-opus-5', 'model-da-bi-go'],
  });
  assert.deepEqual(payload.models.map((m) => m.id), [
    'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-fable-5',
  ]);
});

test('sync lấy model đã đăng ký làm dự phòng khi backend không trả /models', async () => {
  const profiles = fakeProfiles();
  const ying = profiles.find((p) => p.providerName === 'capp-ying');
  const configFile = path.join(tempClaudeDir(), 'openclaw.json');
  fs.writeFileSync(configFile, JSON.stringify({
    models: {
      providers: {
        'capp-ying': {
          baseUrl: ying.baseUrl,
          apiKey: ying.apiKey,
          api: 'anthropic-messages',
          models: [
            { id: 'claude-opus-5', maxTokens: 32000, contextWindow: 200000 },
            { id: 'claude-sonnet-5', maxTokens: 32000, contextWindow: 200000 },
            { id: 'claude-haiku-4-5', maxTokens: 8192, contextWindow: 200000 },
            { id: 'claude-fable-5', maxTokens: 8192, contextWindow: 128000 },
          ],
        },
      },
    },
  }));

  const patches = [];
  // backendModelsByKey rỗng = mọi backend fetch lỗi.
  await syncProvidersForProfiles(profiles, {
    configPath: configFile,
    backendModelsByKey: new Map(),
    runPatch: async (patch) => { patches.push(patch); },
  });

  // capp-ying đã khớp (giữ claude-fable-5) nên không bị ghi lại; chỉ capp-bbdev mới được thêm.
  assert.equal(patches.length, 1);
  assert.equal(Object.hasOwn(patches[0].models.providers, 'capp-ying'), false);
  assert.equal(Object.hasOwn(patches[0].models.providers, 'capp-bbdev'), true);
});

// CLI giả để kiểm tra retry: lần gọi đầu trả ConfigMutationConflictError (mã 1).
function fakeCliCommand(counterFile, fails) {
  process.env.FAKE_CLI_COUNTER = counterFile;
  process.env.FAKE_CLI_FAILS = String(fails);
  return `node "${path.join(__dirname, 'fixtures', 'fake-openclaw-cli.js')}"`;
}

test('runConfigPatch thử lại khi CLI báo xung đột optimistic lock', async () => {
  const counterFile = path.join(tempClaudeDir(), 'counter.txt');
  const result = await runConfigPatch({ models: {} }, {
    cliCommand: fakeCliCommand(counterFile, 2),
  });
  assert.match(result.stdout, /Applied/);
  // 2 lần lỗi + 1 lần thành công
  assert.equal(fs.readFileSync(counterFile, 'utf8'), '3');
});

test('runConfigPatch giữ stderr trong thông báo lỗi và không retry lỗi khác', async () => {
  const counterFile = path.join(tempClaudeDir(), 'counter.txt');
  process.env.FAKE_CLI_COUNTER = counterFile;
  process.env.FAKE_CLI_FAILS = '99';
  process.env.FAKE_CLI_MESSAGE = 'ConfigValidationError: models.providers.x.api invalid';
  await assert.rejects(
    runConfigPatch({ models: {} }, {
      cliCommand: `node "${path.join(__dirname, 'fixtures', 'fake-openclaw-cli.js')}"`,
    }),
    (error) => {
      assert.match(error.message, /ConfigValidationError/);
      assert.equal(error.conflict, false);
      return true;
    },
  );
  // Lỗi không phải xung đột: gọi đúng 1 lần, không retry.
  assert.equal(fs.readFileSync(counterFile, 'utf8'), '1');
  delete process.env.FAKE_CLI_MESSAGE;
});

test('runConfigPatch tuần tự hóa các patch song song để không tự gây xung đột', async () => {
  const counterFile = path.join(tempClaudeDir(), 'counter.txt');
  process.env.FAKE_CLI_COUNTER = counterFile;
  process.env.FAKE_CLI_FAILS = '0';
  process.env.FAKE_CLI_OVERLAP = counterFile + '.overlap';
  const cli = `node "${path.join(__dirname, 'fixtures', 'fake-openclaw-cli.js')}"`;
  await Promise.all([
    runConfigPatch({ models: { a: 1 } }, { cliCommand: cli }),
    runConfigPatch({ models: { b: 2 } }, { cliCommand: cli }),
    runConfigPatch({ models: { c: 3 } }, { cliCommand: cli }),
  ]);
  // CLI giả ghi lỗi nếu phát hiện 2 tiến trình chạy chồng nhau.
  assert.equal(fs.existsSync(process.env.FAKE_CLI_OVERLAP), false);
  assert.equal(fs.readFileSync(counterFile, 'utf8'), '3');
  delete process.env.FAKE_CLI_OVERLAP;
});

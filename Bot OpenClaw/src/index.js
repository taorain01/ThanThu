'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const dotenv = require('dotenv');
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
} = require('discord.js');
const { loadConfig } = require('./config');
const { parseCommand } = require('./commands');
const { StateStore, StateStoreError } = require('./state-store');
const { JobStore, JobStoreError } = require('./job-store');
const {
  MessageCursorStore,
  MessageCursorStoreError,
  compareSnowflakes,
} = require('./message-cursor-store');
const {
  QueueFullError,
  QueueStoppedError,
  SessionRequestQueue,
} = require('./request-queue');
const {
  AttachmentError,
  appendAudioTranscripts,
  prepareMessageAttachments,
} = require('./image-payload');
const { AudioTranscriber, AudioTranscriptionError } = require('./audio-transcriber');
const {
  OpenClawClient,
  OpenClawError,
  isGatewayFailureText,
  isGatewayNonDeliverableText,
} = require('./openclaw-client');
const { OpenClawTaskClient } = require('./openclaw-task-client');
const {
  OPENCLAW_CONFIG_PATH,
  appProfileFingerprint,
  readAppProfile,
} = require('./app-profile');
const {
  listAppProfiles,
  readActiveAppProfile,
  readOpenClawProviderMap,
  runConfigPatch,
  syncProvidersForProfiles,
} = require('./claude-profiles');
const {
  GROUP_APP_PROFILES,
  buildCatalogOptions,
  buildGroupPickerOptions,
  buildHardGroupModelOptions,
  buildProfileModelOptions,
  buildProfilePickerOptions,
  fetchBackendModels,
  findModelInCatalog,
  groupProfilesByCredential,
  paginateOptions,
} = require('./model-catalog');
const { JobSupervisor, TERMINAL_JOB_STATUSES, artifactCounts } = require('./job-supervisor');
const { ACTIVE_TASK_STATUSES } = require('./task-summary');
const { RequestDeadline } = require('./request-deadline');
const {
  ResponseDeliveryGate,
  isNoResponsePlaceholder,
} = require('./response-delivery-gate');
const { splitDiscordText } = require('./message-utils');
const {
  buildJobDetailEmbed,
  buildJobStatusEmbed,
  buildOpenClawStatusEmbed,
  buildResponseEmbeds,
  buildSessionActivityEmbed,
  buildSystemStatusEmbed,
} = require('./discord-embeds');
const { isRootTranscriptFinal } = require('./discord-activity');
const { sanitizeActivityText } = require('./session-activity');
const { readSessionContextUsage } = require('./session-context');
const {
  findSessionResponse,
  fingerprintText,
  waitForSessionResponse,
} = require('./response-recovery');
const { createLogger } = require('./logger');
const {
  artifactCaption,
  cleanupOutbox,
  extractMediaReferences,
  stageMediaReference,
} = require('./response-media');
const {
  buildJobActionRows,
  buildScreenshotGalleryPayload,
  shortJobId,
} = require('./discord-job-ui');
const { startStatusHeartbeat, statusUpdateDelay } = require('./status-heartbeat');
const { collectSystemMetrics } = require('./system-metrics');
const {
  shouldMoveStatusToBottom,
} = require('./discord-ordering');
const { fixMediaFolderMojibake } = require('../scripts/fix-media-folder-mojibake');

const BOT_ROOT = path.resolve(__dirname, '..');
const OPENCLAW_HOME = path.join(os.homedir(), '.openclaw');
dotenv.config({ path: path.join(BOT_ROOT, '.env'), quiet: true });

const config = loadConfig();
const OPENCLAW_SESSIONS_DIR = path.join(
  OPENCLAW_HOME,
  'agents',
  config.openclawAgentId,
  'sessions',
);
const OPENCLAW_OUTBOX_ROOT = path.join(OPENCLAW_HOME, 'media', 'discord-outbox');
const OPENCLAW_MEDIA_ROOTS = [...new Set([
  path.join(OPENCLAW_HOME, 'workspace'),
  path.join(OPENCLAW_HOME, 'media'),
  ...config.mediaSourceRoots,
])];

const logger = createLogger(path.join(BOT_ROOT, 'logs', 'bot.log'));
const stateStore = new StateStore(path.join(BOT_ROOT, 'data', 'state.json'));
const jobStore = new JobStore(path.join(BOT_ROOT, 'data', 'jobs.json'));
const messageCursorStore = new MessageCursorStore(
  path.join(BOT_ROOT, 'data', 'message-cursors.json'),
);
const openclaw = new OpenClawClient(config);
const taskClient = new OpenClawTaskClient({
  baseUrl: config.openclawBaseUrl,
  gatewayToken: config.openclawGatewayToken,
  rpcTimeoutMs: config.taskRpcTimeoutMs,
  listCacheMs: config.jobPollMs,
});
const audioTranscriber = new AudioTranscriber({ timeoutMs: config.requestIdleTimeoutMs });
const requestQueue = new SessionRequestQueue(
  config.maxPending,
  config.maxConcurrentSessions,
);
const sourceMessages = new Map();
const statusUpdateTimers = new Map();
const statusUpdatePromises = new Map();
const statusUpdatedAt = new Map();
const jobThreadPromises = new Map();
const jobDetailUpdatePromises = new Map();
const screenshotUpdatePromises = new Map();
const threadCreationFailures = new Set();
const finalizedScreenshotGalleries = new Set();
const sessionActivityUpdateTimers = new Map();
const sessionActivityUpdatePromises = new Map();
const activityDeliveryChains = new Map();
const responseDeliveryPromises = new Map();
// Phản hồi transcript-final đến TRONG khi worker nền vẫn chạy: chưa phải phản
// hồi cuối, hoãn gửi (jobId → responseText). Gửi khi hết task active hoặc khi
// job kết thúc — tránh gửi lời tự thuật giữa chừng và không đánh dấu
// responseSent sớm để chặn response thật của agent.
const deferredResponses = new Map();
const streamPreviews = new Map();
const messageDispatches = new Map();
const handledMessageIds = new Set();
// Điều hướng của từng bảng chọn model (key = messageId): cấp đang xem (1: nhóm,
// 2: profile/model, 3: model của profile), nhóm/profile đang chọn và trang.
// Bảng chọn đóng (chọn/hủy) sẽ xóa entry; bot restart → quay về cấp 1.
const modelPickNav = new Map();
const bufferedGatewayMessages = [];
let acceptingGatewayMessages = false;
let statusHeartbeat = null;
let supervisor;

// Model cache — làm mới mỗi 5 phút
let modelsCache = null;
let modelsCacheExpiresAt = 0;
const MODELS_CACHE_TTL_MS = 5 * 60 * 1000;

// Cache danh mục model tổng hợp cho `> o m` (model mọi profile app/backend).
// Mỗi entry đã là một request /models tới backend proxy nên cache dùng chung
// chu kỳ 5 phút với modelsCache; lệnh `> o m refresh` xóa cả hai.
let catalogCache = null;
let catalogCacheExpiresAt = 0;

// Đồng bộ profile từ Claude Profile Switcher (app desktop): khi app KÍCH HOẠT
// profile khác, ~/.claude/settings.json đổi nội dung → bot tự cập nhật model
// cho từng kênh. Fingerprint được lưu trong state để không đè lựa chọn thủ công
// sau khi bot restart.
//
// Mỗi profile app được đăng ký thành một provider OpenClaw riêng (capp-<slug>)
// nên profile mới thêm trong app sẽ tự xuất hiện trong bảng chọn của bot.

// Cache danh sách profile app (đọc file, rẻ nhưng gọi rất thường xuyên).
let appProfilesCache = null;
let appProfilesCacheExpiresAt = 0;
const APP_PROFILES_CACHE_TTL_MS = 10 * 1000;

// Tự retry khi lượt gọi model thất bại tạm thời: lần đầu + 2 lần thử lại.
// Thời gian chờ cho provider kịp hồi phục (transient outage/rate limit).
const OPENCLAW_CHAT_RETRY_DELAYS_MS = [15000, 45000];

function appProfilesCached({ force = false } = {}) {
  const now = Date.now();
  if (!force && appProfilesCache && now < appProfilesCacheExpiresAt) {
    return appProfilesCache;
  }
  const profiles = listAppProfiles();
  // Đánh dấu profile mà app desktop đang bật để bảng chọn hiển thị được.
  const active = readActiveAppProfile({ profiles });
  for (const profile of profiles) {
    profile.active = Boolean(active && profile.slug === active.slug);
  }
  appProfilesCache = profiles;
  appProfilesCacheExpiresAt = now + APP_PROFILES_CACHE_TTL_MS;
  return appProfilesCache;
}

function invalidateAppProfilesCache() {
  appProfilesCache = null;
  appProfilesCacheExpiresAt = 0;
}

// Đăng ký provider cho toàn bộ profile app. Lỗi ở đây không được làm chết luồng
// chính: bot vẫn chạy được với provider đã có sẵn.
// openclawClient: nếu truyền thì quét /v1/models của từng backend trước, để đăng
// ký ĐẦY ĐỦ model mà key đó dùng được (không chỉ 3 tier trong settings_<Tên>.json).
async function ensureAppProfileProviders({ force = false, openclawClient = null } = {}) {
  const profiles = appProfilesCached({ force });
  if (!profiles.length) {
    return { changed: false, profiles };
  }
  let backendModelsByKey = null;
  if (openclawClient) {
    try {
      const catalog = await fetchModelCatalogCached(openclawClient);
      backendModelsByKey = catalog.backendModelsByKey;
    } catch (error) {
      // Backend offline: vẫn đăng ký 3 tier khai báo để bot dùng được.
      logger.warn('Không quét được model backend khi đăng ký provider.', {
        name: error.name,
        message: error.message,
      });
    }
  }
  try {
    const result = await syncProvidersForProfiles(profiles, {
      configPath: OPENCLAW_CONFIG_PATH,
      backendModelsByKey,
    });
    if (result.changed) {
      logger.info('Đã cập nhật provider OpenClaw theo profile Claude Profile Switcher.', {
        added: result.added,
        updated: result.updated,
        removed: result.removed,
      });
      modelsCache = null;
      modelsCacheExpiresAt = 0;
      catalogCache = null;
      catalogCacheExpiresAt = 0;
    }
    return { ...result, profiles };
  } catch (error) {
    logger.warn('Không đăng ký được provider cho profile app.', {
      name: error.name,
      message: error.message,
    });
    return { changed: false, profiles, error };
  }
}

function activeAppProfile({ force = false } = {}) {
  return readActiveAppProfile({ profiles: appProfilesCached({ force }) });
}

async function rememberCurrentAppProfile(channelId) {
  const fingerprint = appProfileFingerprint(readAppProfile());
  await stateStore.setAppProfileFingerprint(config.guildId, channelId, fingerprint);
}

// Áp dụng model cho TOÀN BỘ session (mỗi kênh đang bật = một session OpenClaw).
// Ghi fingerprint profile app cho từng kênh để lựa chọn không bị đè sau restart.
async function applyModelToAllChannels({ customModel = null, modelProfile = null } = {}) {
  const channelIds = await stateStore.setModelForAllChannels(config.guildId, {
    customModel,
    modelProfile,
  });
  for (const channelId of channelIds) {
    await rememberCurrentAppProfile(channelId);
  }
  return channelIds;
}

async function syncModelFromApp(channelId) {
  const state = stateStore.getChannel(config.guildId, channelId);
  if (!state?.enabled) {
    return { changed: false, current: state };
  }
  const appProfile = readAppProfile();
  const fingerprint = appProfileFingerprint(appProfile);
  if (fingerprint === state.appProfileFingerprint) {
    return { changed: false, current: state };
  }

  if (!appProfile) {
    // Không có profile app (Claude mặc định) — giữ nguyên lựa chọn hiện tại.
    return { changed: false, current: state };
  }

  // Profile app đang active → đảm bảo provider tồn tại rồi trỏ kênh vào đúng
  // model của profile đó.
  await ensureAppProfileProviders({ force: true });
  const active = activeAppProfile();
  if (!active) {
    logger.warn('Không đọc được profile app đang kích hoạt.', { channelId });
    return { changed: false, current: state };
  }

  // Kênh chạy model cục bộ (Ollama) không liên quan tới profile Claude app —
  // chỉ ghi nhận fingerprint để khỏi kiểm tra lại, không đè customModel.
  if (state.modelProfile === 'local') {
    const current = await stateStore.setAppProfileFingerprint(
      config.guildId,
      channelId,
      fingerprint,
    );
    logger.info('Bỏ qua đồng bộ profile app cho kênh model cục bộ.', {
      channelId,
      appProfile: active.name,
      backend: config.openclawBackendModels.local,
    });
    return { changed: false, current };
  }

  await stateStore.setCustomModel(config.guildId, channelId, active.modelId);
  const current = await stateStore.setAppProfileFingerprint(
    config.guildId,
    channelId,
    fingerprint,
  );
  logger.info('Tự đồng bộ model từ Claude Profile Switcher.', {
    channelId,
    appProfile: active.name,
    backend: active.modelId,
    untracked: Boolean(active.untracked),
  });
  return {
    changed: true,
    label: `${active.name} — ${active.modelId}`,
    current,
  };
}

async function fetchModelsCached(openclawClient) {
  const now = Date.now();
  if (modelsCache && now < modelsCacheExpiresAt) {
    return modelsCache;
  }
  const models = await openclawClient.listModels();
  modelsCache = models;
  modelsCacheExpiresAt = now + MODELS_CACHE_TTL_MS;
  return models;
}

// Lấy danh mục model tổng hợp: model opus/sonnet/haiku khai báo trong mỗi
// profile app, toàn bộ model của MỌI backend riêng biệt (gọi /models, nhóm
// theo credentialKey) VÀ model thật của nhóm cứng (9router/ollama/opus),
// dùng cho bảng chọn `. o m`. Backend lỗi/offline chỉ bị bỏ qua, profile vẫn
// còn model khai báo.
async function fetchModelCatalogCached(openclawClient) {
  const now = Date.now();
  if (catalogCache && now < catalogCacheExpiresAt) {
    return catalogCache;
  }
  const profiles = appProfilesCached();
  const groups = groupProfilesByCredential(profiles);
  const hardGroups = hardcodedGroups();
  const targets = [
    ...groups.map((group) => ({
      key: group.credentialKey,
      baseUrl: group.baseUrl,
      apiKey: group.apiKey,
    })),
    ...hardGroups
      .filter((group) => group.baseUrl)
      .map((group) => ({ key: group.name, baseUrl: group.baseUrl, apiKey: group.apiKey })),
  ];
  const results = await Promise.allSettled(targets.map(async (target) => ({
    key: target.key,
    ids: await fetchBackendModels({
      baseUrl: target.baseUrl,
      apiKey: target.apiKey,
      fetchImpl: openclawClient.fetchImpl,
    }),
  })));
  const backendModelsByKey = new Map();
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.ids.length > 0) {
      backendModelsByKey.set(result.value.key, result.value.ids);
    }
  }
  // Backend không trả /models (offline, hết quota, endpoint lạ) → lấy model đã
  // đăng ký trong openclaw.json làm nguồn dự phòng, để bảng chọn vẫn hiện đầy đủ
  // model của key đó thay vì tụt về 3 tier khai báo.
  const providerMap = readOpenClawProviderMap(OPENCLAW_CONFIG_PATH);
  for (const profile of profiles) {
    if (backendModelsByKey.has(profile.credentialKey)) {
      continue;
    }
    const registered = (providerMap[profile.providerName]?.models || [])
      .map((model) => String(model?.id || '').trim())
      .filter(Boolean);
    if (registered.length > 0) {
      backendModelsByKey.set(profile.credentialKey, registered);
    }
  }
  catalogCache = { profiles, hardcodedGroups: hardGroups, backendModelsByKey };
  catalogCacheExpiresAt = now + MODELS_CACHE_TTL_MS;
  return catalogCache;
}

function invalidateCatalogCache() {
  catalogCache = null;
  catalogCacheExpiresAt = 0;
}

// Profile cứng (9router/local/opus) kèm baseUrl/apiKey đọc từ openclaw.json để
// fetch model thật của backend đó. Tên provider có thể khác tên nhóm (nhóm
// "local" trỏ provider "ollama") nên thử theo tên nhóm trước, rồi theo prefix
// của model khai báo; nhóm không có provider (vd opus) chỉ giữ model khai báo.
function hardcodedGroups() {
  const providerMap = readOpenClawProviderMap(OPENCLAW_CONFIG_PATH);
  return Object.entries(config.openclawBackendModels).map(([name, model]) => {
    const prefix = String(model || '').includes('/') ? model.split('/')[0] : null;
    const provider = providerMap[name] || (prefix ? providerMap[prefix] : null);
    return {
      name,
      model,
      baseUrl: provider?.baseUrl || null,
      apiKey: provider?.apiKey || null,
    };
  });
}

// Đảm bảo OpenClaw có route `9router/*`, `ollama/*`, `anthropic/*` trong
// agents.defaults.models để mọi model của nhóm cứng route được khi chọn
// (ollama/* thường đã có sẵn; 9router/* và anthropic/* hay thiếu). Prefix lấy
// từ model khai báo vì tên nhóm (local/opus) khác tên provider (ollama/anthropic).
async function ensureHardcodedModelRoutes() {
  try {
    const data = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf8'));
    const routes = data?.agents?.defaults?.models || {};
    const prefixes = Object.values(config.openclawBackendModels)
      .map((model) => (String(model || '').includes('/') ? model.split('/')[0] : null))
      .filter(Boolean);
    const missing = [...new Set(prefixes)]
      .filter((prefix) => !Object.hasOwn(routes, `${prefix}/*`));
    if (missing.length === 0) {
      return;
    }
    await runConfigPatch({
      agents: {
        defaults: {
          models: Object.fromEntries(missing.map((prefix) => [`${prefix}/*`, {}])),
        },
      },
    });
    logger.info('Đã đăng ký route model cứng OpenClaw.', { added: missing });
  } catch (error) {
    logger.warn('Không đăng ký được route model cứng.', {
      name: error.name,
      message: error.message,
    });
  }
}

// Danh mục cho bảng chọn từ state hiện tại của kênh. Profile app luôn đọc mới
// (cache 10 giây) để tên/nhãn "App đang bật" kịp thời; model backend lấy từ
// catalogCache đã fetch sẵn.
function modelPickerCatalog(current) {
  const backendModelsByKey = (catalogCache && catalogCache.backendModelsByKey) || new Map();
  const hardGroups = (catalogCache && catalogCache.hardcodedGroups) || hardcodedGroups();
  return {
    appProfiles: appProfilesCached(),
    hardcodedGroups: hardGroups,
    backendModelsByKey,
    ...buildCatalogOptions({
      appProfiles: appProfilesCached(),
      backendModelsByKey,
      hardcodedGroups: hardGroups,
      current,
    }),
  };
}

// Dựng nội dung cấp đang xem của bảng chọn (options + tiêu đề + footer cơ bản)
// theo trạng thái điều hướng. Trả null khi state không hợp lệ.
function buildPickerView(nav, current) {
  const catalog = modelPickerCatalog(current);
  if (nav.level === 1) {
    return {
      heading: null,
      footer: `${catalog.modelCount} model · ${catalog.backendCount} backend · OpenClaw Gateway`,
      options: buildGroupPickerOptions({
        appProfileCount: catalog.appProfiles.length,
        hardcodedGroups: catalog.hardcodedGroups,
      }),
    };
  }
  if (nav.level === 2 && nav.group === GROUP_APP_PROFILES) {
    const options = buildProfilePickerOptions(catalog.appProfiles, current);
    return {
      heading: 'Nhóm **Claude** — chọn profile app:',
      footer: `${options.length} profile app · OpenClaw Gateway`,
      options,
    };
  }
  const hardGroup = catalog.hardcodedGroups.find((group) => group.name === nav.group);
  if (nav.level === 2 && hardGroup) {
    const options = buildHardGroupModelOptions(
      hardGroup,
      catalog.backendModelsByKey.get(hardGroup.name) || [],
      current,
    );
    return {
      heading: `Nhóm **${hardGroup.name}** — chọn model:`,
      footer: `${options.length} model · OpenClaw Gateway`,
      options,
    };
  }
  const profile = catalog.appProfiles.find((item) => item.credentialKey === nav.profileKey);
  if (nav.level === 3 && profile) {
    const options = buildProfileModelOptions(
      profile,
      catalog.backendModelsByKey.get(profile.credentialKey) || [],
      current,
    );
    return {
      heading: `Profile **${profile.name}** — chọn model:`,
      footer: `${options.length} model · OpenClaw Gateway`,
      options,
    };
  }
  return null;
}

// Footer của bảng chọn: số model/backend (cấp 1) hoặc số lựa chọn cấp đó, kèm
// trang hiện tại khi phân trang.
function modelPickerFooterText(base, picker) {
  return picker.pageCount > 1
    ? `Trang ${picker.page + 1}/${picker.pageCount} · ${base}`
    : base;
}

// Components của bảng chọn theo cấp đang xem: select menu (1 trang = 25
// options) + hàng nút [◀ Trước | ← Quay lại | Hủy | Sau ▶] (ẩn nút không cần).
function buildModelPickerComponents(nav, picker) {
  const selectId = nav.level === 1
    ? 'oc-model-group'
    : nav.level === 2 && nav.group === GROUP_APP_PROFILES
      ? 'oc-model-profile'
      : 'oc-model-pick';
  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(selectId)
      .setPlaceholder('Chọn để điều hướng bảng chọn model...')
      .addOptions(picker.options),
  );
  const buttonRow = new ActionRowBuilder();
  if (picker.pageCount > 1) {
    buttonRow.addComponents(
      new ButtonBuilder()
        .setCustomId('oc-model-page-prev')
        .setLabel('◀ Trước')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(picker.page === 0),
    );
  }
  if (nav.level > 1) {
    buttonRow.addComponents(
      new ButtonBuilder()
        .setCustomId('oc-model-back')
        .setLabel('← Quay lại')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  buttonRow.addComponents(
    new ButtonBuilder()
      .setCustomId('oc-model-pick-cancel')
      .setLabel('Hủy')
      .setStyle(ButtonStyle.Secondary),
  );
  if (picker.pageCount > 1) {
    buttonRow.addComponents(
      new ButtonBuilder()
        .setCustomId('oc-model-page-next')
        .setLabel('Sau ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(picker.page === picker.pageCount - 1),
    );
  }
  return [selectRow, buttonRow];
}

// Nhãn model của kênh: ưu tiên tên profile app nếu model thuộc một profile.
function describeChannelModel(state) {
  const modelId = state?.customModel;
  if (!modelId) {
    return config.openclawBackendModels[state?.modelProfile] || 'chưa chọn';
  }
  const profile = appProfilesCached().find((item) => item.modelId === modelId);
  return profile ? `${profile.name} (${modelId})` : modelId;
}

// Nhãn model đã dùng cho một job: gắn tên profile app nếu model thuộc profile.
function describeBackendModel(modelId) {
  const id = String(modelId || '').trim();
  if (!id) {
    return null;
  }
  const profile = appProfilesCached().find((item) => item.modelId === id);
  return profile ? `${profile.name} (${id})` : id;
}

// Tìm profile app theo tên/slug người dùng gõ trong `> o m <tên>`.
function findAppProfileByArg(arg) {
  const needle = String(arg || '').toLowerCase().trim();
  if (!needle) {
    return null;
  }
  const profiles = appProfilesCached();
  return profiles.find((profile) => profile.slug === needle)
    || profiles.find((profile) => profile.name.toLowerCase() === needle)
    || profiles.find((profile) => profile.modelId.toLowerCase() === needle)
    || null;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function isAllowed(userId) {
  return config.allowedUserIds.has(userId);
}

function discordMessageOptions(content, files = []) {
  return {
    content,
    files,
    allowedMentions: { parse: [], repliedUser: false },
  };
}

function discordEmbedOptions(embed, options = {}) {
  return {
    ...(options.clearContent ? { content: null } : {}),
    embeds: [embed],
    files: options.files || [],
    ...(options.components ? { components: options.components } : {}),
    allowedMentions: { parse: [], repliedUser: false },
  };
}

function botIconUrl() {
  return client.user?.displayAvatarURL({ extension: 'png', size: 128 });
}

async function sendChunks(message, text, options = {}) {
  const chunks = splitDiscordText(text);
  const files = options.files || [];
  try {
    await message.reply(discordMessageOptions(chunks[0], files));
  } catch {
    await message.channel.send(discordMessageOptions(chunks[0], files));
  }
  for (const chunk of chunks.slice(1)) {
    await message.channel.send(discordMessageOptions(chunk));
  }
}

async function resolveDiscordChannel(channelId) {
  return client.channels.cache.get(channelId) || client.channels.fetch(channelId);
}

function jobThreadName(job) {
  return `openclaw-${shortJobId(job.id)}-chi-tiet`;
}

async function findExistingJobThread(job, statusMessage) {
  if (job.detailThreadId) {
    return resolveDiscordChannel(job.detailThreadId).catch(() => null);
  }
  if (statusMessage?.channel?.isThread?.()) {
    return statusMessage.channel;
  }
  if (statusMessage?.hasThread) {
    return statusMessage.thread
      || resolveDiscordChannel(statusMessage.id).catch(() => null);
  }
  return null;
}

async function createJobDetailThread(job, statusMessage = null) {
  const current = jobStore.getJob(job.id);
  if (!current) {
    return null;
  }
  let starter = sourceMessages.get(current.id) || null;
  if (!starter && current.requestMessageId) {
    const channel = await resolveDiscordChannel(current.channelId);
    starter = await channel.messages.fetch(current.requestMessageId).catch(() => null);
  }
  let thread = await findExistingJobThread(current, starter);
  if (!thread) {
    thread = await findExistingJobThread(current, statusMessage);
  }
  if (!thread && threadCreationFailures.has(current.id)) {
    return null;
  }

  if (!thread && !starter && current.statusMessageId) {
    const channel = await resolveDiscordChannel(current.channelId);
    starter = await channel.messages.fetch(current.statusMessageId).catch(() => null);
    thread = await findExistingJobThread(current, starter);
  }
  if (!thread && starter?.startThread) {
    try {
      thread = await starter.startThread({
        name: jobThreadName(current),
        autoArchiveDuration: 1440,
        reason: `Theo dõi chi tiết job OpenClaw ${current.id}`,
      });
    } catch (error) {
      threadCreationFailures.add(current.id);
      logger.warn('Không tạo được thread chi tiết cho job OpenClaw.', {
        jobId: current.id,
        name: error.name,
        message: error.message,
      });
      return null;
    }
  }
  if (!thread) {
    return null;
  }

  if (thread.archived && !TERMINAL_JOB_STATUSES.has(current.status)) {
    await thread.setArchived(false).catch(() => {});
  }
  if (current.detailThreadId !== thread.id) {
    await jobStore.updateJob(current.id, { detailThreadId: thread.id });
  }
  threadCreationFailures.delete(current.id);
  return thread;
}

async function ensureJobDetailThread(job, statusMessage = null) {
  if (!job) {
    return null;
  }
  if (jobThreadPromises.has(job.id)) {
    return jobThreadPromises.get(job.id);
  }
  const operation = createJobDetailThread(job, statusMessage);
  jobThreadPromises.set(job.id, operation);
  try {
    return await operation;
  } finally {
    jobThreadPromises.delete(job.id);
  }
}

async function sendJobResponse(job, text) {
  const embeds = buildResponseEmbeds(text, {
    jobId: job.id,
    model: describeBackendModel(job.backendModel),
    timestamp: job.updatedAt,
  });
  const source = sourceMessages.get(job.id);
  const channel = source?.channel || await resolveDiscordChannel(job.channelId);
  if (source) {
    try {
      await source.reply(discordEmbedOptions(embeds[0]));
    } catch {
      await channel.send(discordEmbedOptions(embeds[0]));
    }
  } else {
    await channel.send(discordEmbedOptions(embeds[0]));
  }
  for (const embed of embeds.slice(1)) {
    await channel.send(discordEmbedOptions(embed));
  }
}

function retryDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function enqueueDiscordDelivery(jobId, deliver) {
  const previous = activityDeliveryChains.get(jobId) || Promise.resolve();
  const operation = previous.catch(() => {}).then(deliver);
  activityDeliveryChains.set(jobId, operation);
  try {
    return await operation;
  } finally {
    if (activityDeliveryChains.get(jobId) === operation) {
      activityDeliveryChains.delete(jobId);
    }
  }
}

async function sendActivityToDiscord(job, event) {
  if (isRootTranscriptFinal(event)) {
    return sendOpenClawResponse(
      job.id,
      event.responseText || event.notificationText || event.text,
      { final: true, deferWhileTasksActive: true },
    );
  }
  return [];
}

// Gallery ảnh xem trước được lưu trong job và cập nhật tại chỗ, nên bot restart
// vẫn tiếp tục dùng đúng message cũ và giữ được bốn ảnh gần nhất.
async function archiveScreenshotInDetailThread(job, screenshot) {
  if (!screenshot || screenshot.threadMessageId) {
    return;
  }
  const thread = await ensureJobDetailThread(job);
  if (!thread?.send) {
    return;
  }
  const capturedAt = Math.floor(Date.parse(screenshot.capturedAt || '') / 1000);
  const extension = /^\.[a-z0-9]{2,5}$/i.test(screenshot.extension)
    ? screenshot.extension.toLowerCase()
    : '.png';
  const attachment = new AttachmentBuilder(screenshot.stagedPath, {
    name: `openclaw-history-${shortJobId(job.id)}-${screenshot.id.slice(0, 8)}${extension}`,
  });
  const timestamp = Number.isFinite(capturedAt) ? ` lúc <t:${capturedAt}:T>` : '';
  const sent = await thread.send(discordMessageOptions(
    `📸 **Ảnh OpenClaw đã xem${timestamp}** · Job \`#${shortJobId(job.id)}\``,
    [attachment],
  ));
  await jobStore.updateJob(job.id, (storedJob) => {
    const stored = storedJob.screenshots.find((item) => item.id === screenshot.id);
    if (stored) {
      stored.threadMessageId = sent.id;
    }
  });
}

async function deliverScreenshotGallery(job) {
  const current = jobStore.getJob(job.id) || job;
  const payload = buildScreenshotGalleryPayload(current);
  const channel = await resolveDiscordChannel(current.channelId);
  if (!payload || !channel) {
    return null;
  }
  if (current.screenshotMessageId) {
    const previous = await channel.messages.fetch(current.screenshotMessageId).catch(() => null);
    if (previous) {
      await previous.edit(payload);
      return previous;
    }
  }
  const sent = await channel.send(payload);
  await jobStore.updateJob(current.id, { screenshotMessageId: sent.id });
  return sent;
}

async function updateScreenshotGallery(job, filePath) {
  const file = String(filePath || '').trim().replace(/^["']|["']$/g, '');
  if (!file || !job?.channelId) {
    return;
  }
  const staged = await stageMediaReference(file, {
    openclawHome: OPENCLAW_HOME,
    allowedRoots: OPENCLAW_MEDIA_ROOTS,
    outboxRoot: OPENCLAW_OUTBOX_ROOT,
    jobId: job.id,
    maxBytes: 10 * 1024 * 1024,
  });
  if (!staged.artifact) {
    return;
  }

  const previous = jobStore.getJob(job.id);
  const alreadyStored = previous?.screenshots?.some((item) => item.id === staged.artifact.id);
  let current = await jobStore.addScreenshot(job.id, {
    ...staged.artifact,
    capturedAt: new Date().toISOString(),
  });

  try {
    if (!alreadyStored) {
      const screenshot = current.screenshots.find((item) => item.id === staged.artifact.id);
      await archiveScreenshotInDetailThread(current, screenshot);
      current = jobStore.getJob(current.id) || current;
    }
    await deliverScreenshotGallery(current);
    scheduleStatusUpdate(jobStore.getJob(current.id) || current);
  } catch (error) {
    logger.warn('Không cập nhật được gallery ảnh chụp màn hình.', {
      jobId: current.id,
      name: error.name,
      message: error.message,
    });
  }
}

async function enqueueScreenshotUpdate(jobId, update) {
  const previous = screenshotUpdatePromises.get(jobId) || Promise.resolve();
  const operation = previous.catch(() => {}).then(update);
  screenshotUpdatePromises.set(jobId, operation);
  try {
    return await operation;
  } finally {
    if (screenshotUpdatePromises.get(jobId) === operation) {
      screenshotUpdatePromises.delete(jobId);
    }
  }
}

async function sendScreenshotToDiscord(job, filePath) {
  return enqueueScreenshotUpdate(job.id, () => updateScreenshotGallery(job, filePath));
}

async function finalizeScreenshotGallery(job) {
  if (
    finalizedScreenshotGalleries.has(job.id)
    || !job.screenshotMessageId
    || !job.screenshots?.length
  ) {
    return;
  }
  await enqueueScreenshotUpdate(job.id, async () => {
    await deliverScreenshotGallery(jobStore.getJob(job.id) || job);
    finalizedScreenshotGalleries.add(job.id);
  });
}

function sessionActivityUpdateKey(jobId, sessionKey) {
  return `${jobId}\u0000${sessionKey}`;
}

async function updateJobDetailMessage(job, options = {}) {
  const current = jobStore.getJob(job.id);
  if (!current) {
    return null;
  }
  const thread = await ensureJobDetailThread(current, options.statusMessage);
  if (!thread?.messages) {
    return null;
  }
  const embed = buildJobDetailEmbed(current, {
    counts: artifactCounts(current),
    contextUsage: options.contextUsage,
    streamPreview: options.streamPreview,
    model: describeBackendModel(current.backendModel),
    botName: 'OPENCLAW // JOB DETAILS',
    botIconUrl: botIconUrl(),
  });

  if (current.detailMessageId) {
    try {
      return await thread.messages.edit(
        current.detailMessageId,
        discordEmbedOptions(embed, { clearContent: true }),
      );
    } catch (error) {
      logger.warn('Không cập nhật được bảng chi tiết cũ; sẽ tạo bảng thay thế.', {
        jobId: current.id,
        name: error.name,
      });
    }
  }

  const sent = await thread.send(discordEmbedOptions(embed));
  await jobStore.updateJob(current.id, { detailMessageId: sent.id });
  return sent;
}

async function ensureJobDetailMessage(job, options = {}) {
  if (!job) {
    return null;
  }
  const previous = jobDetailUpdatePromises.get(job.id) || Promise.resolve();
  const operation = previous.catch(() => {}).then(() => updateJobDetailMessage(job, options));
  jobDetailUpdatePromises.set(job.id, operation);
  try {
    return await operation;
  } finally {
    if (jobDetailUpdatePromises.get(job.id) === operation) {
      jobDetailUpdatePromises.delete(job.id);
    }
  }
}

async function updateSessionActivityMessage(jobId, sessionKey) {
  const current = jobStore.getJob(jobId);
  const activity = current?.sessionActivities?.[sessionKey];
  if (!current || !activity || !activity.events?.length) {
    return null;
  }
  const sessionKeys = Object.keys(current.sessionActivities).sort((left, right) => (
    Number(current.sessionStartedAt?.[left] || 0) - Number(current.sessionStartedAt?.[right] || 0)
  ));
  const embed = buildSessionActivityEmbed(current, sessionKey, {
    sessionNumber: Math.max(1, sessionKeys.indexOf(sessionKey) + 1),
    botName: 'OPENCLAW // SUB-SESSION',
    botIconUrl: botIconUrl(),
  });
  const channel = await ensureJobDetailThread(current)
    || await resolveDiscordChannel(current.channelId);

  if (activity.messageId) {
    let lastError;
    for (const waitMs of [0, 1000, 5000]) {
      if (waitMs) {
        await retryDelay(waitMs);
      }
      try {
        const message = await channel.messages.edit(
          activity.messageId,
          discordEmbedOptions(embed, { clearContent: true }),
        );
        return message;
      } catch (error) {
        lastError = error;
      }
    }
    logger.warn('Không cập nhật được embed session phụ cũ; sẽ tạo embed thay thế.', {
      jobId,
      name: lastError?.name,
    });
  }

  let lastError;
  for (const waitMs of [0, 1000, 5000]) {
    if (waitMs) {
      await retryDelay(waitMs);
    }
    try {
      const sent = await channel.send(discordEmbedOptions(embed));
      await jobStore.setSessionActivityMessageId(jobId, sessionKey, sent.id);
      return sent;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function ensureSessionActivityMessage(jobId, sessionKey) {
  const key = sessionActivityUpdateKey(jobId, sessionKey);
  const previous = sessionActivityUpdatePromises.get(key) || Promise.resolve();
  const operation = previous.catch(() => {}).then(() => (
    updateSessionActivityMessage(jobId, sessionKey)
  ));
  sessionActivityUpdatePromises.set(key, operation);
  try {
    return await operation;
  } finally {
    sessionActivityUpdatePromises.delete(key);
  }
}

function scheduleSessionActivityUpdates(job, options = {}) {
  if (!job) {
    return;
  }
  const immediate = options.immediate === true || TERMINAL_JOB_STATUSES.has(job.status);
  for (const sessionKey of Object.keys(job.sessionActivities || {})) {
    const key = sessionActivityUpdateKey(job.id, sessionKey);
    if (sessionActivityUpdateTimers.has(key)) {
      if (!immediate) {
        continue;
      }
      clearTimeout(sessionActivityUpdateTimers.get(key));
      sessionActivityUpdateTimers.delete(key);
    }
    const timer = setTimeout(() => {
      sessionActivityUpdateTimers.delete(key);
      void ensureSessionActivityMessage(job.id, sessionKey).catch((error) => {
        logger.warn('Không thể cập nhật embed session phụ trên Discord.', {
          jobId: job.id,
          name: error.name,
        });
      });
    }, immediate ? 0 : config.statusUpdateDebounceMs);
    timer.unref?.();
    sessionActivityUpdateTimers.set(key, timer);
  }
}

async function finalizeStatusPresentation(job, statusMessage, embed, options = {}) {
  let latest = jobStore.getJob(job.id) || job;
  const previousThreadId = latest.detailThreadId;
  const thread = await ensureJobDetailThread(latest, statusMessage).catch(() => null);
  latest = jobStore.getJob(job.id) || latest;

  if (thread && latest.detailThreadId !== previousThreadId) {
    try {
      statusMessage = await statusMessage.edit(discordEmbedOptions(embed, {
        clearContent: true,
        components: buildJobActionRows(latest),
      }));
    } catch (error) {
      logger.warn('Không gắn được nút mở thread chi tiết vào status.', {
        jobId: latest.id,
        name: error.name,
      });
    }
  }

  await ensureJobDetailMessage(latest, {
    statusMessage,
    contextUsage: options.contextUsage,
    streamPreview: options.streamPreview,
  }).catch((error) => {
    logger.warn('Không cập nhật được nội dung thread chi tiết.', {
      jobId: latest.id,
      name: error.name,
    });
  });
  return statusMessage;
}

async function updateStatusMessage(job) {
  const current = jobStore.getJob(job.id);
  if (!current) {
    return null;
  }
  const streamPreview = streamPreviews.get(current.id) || '';
  const queue = requestQueue.getDetailedStatus();
  const queueIndex = queue.pendingMetadata.findIndex((item) => item.jobId === current.id);
  const queueItem = queueIndex >= 0 ? queue.pendingMetadata[queueIndex] : null;
  const sessionKey = queueItem?.sessionKey || current.rootSessionKey;
  const sessionPending = queue.pendingMetadata
    .filter((item) => (item.sessionKey || item.channelId) === sessionKey);
  const sessionQueueIndex = sessionPending.findIndex((item) => item.jobId === current.id);
  const contextUsage = await readSessionContextUsage(
    OPENCLAW_SESSIONS_DIR,
    current.rootSessionKey,
  );
  const embed = buildJobStatusEmbed(current, {
    counts: artifactCounts(current),
    contextUsage,
    queuePosition: sessionQueueIndex >= 0 ? sessionQueueIndex + 1 : null,
    queuePending: sessionPending.length,
    activeSessions: queue.activeCount,
    maxConcurrentSessions: queue.maxConcurrent,
    prefix: config.prefix,
    botName: 'OPENCLAW // JOB MONITOR',
    botIconUrl: botIconUrl(),
    heartbeatMs: config.jobHeartbeatMs,
    updateDebounceMs: streamPreview ? config.streamUpdateMs : config.statusUpdateDebounceMs,
    streamPreview,
  });
  const statusOptions = {
    components: buildJobActionRows(current),
  };
  const channel = await resolveDiscordChannel(current.channelId);
  if (current.statusMessageId) {
    try {
      let lastMessageIsBot = false;
      if (channel.lastMessageId && channel.lastMessageId !== current.statusMessageId) {
        try {
          const lastMessage = channel.messages.cache.get(channel.lastMessageId)
            || await channel.messages.fetch(channel.lastMessageId);
          lastMessageIsBot = lastMessage.author.id === client.user.id;
        } catch {
          // Giữ hành vi cũ nếu không xác định được tác giả tin cuối kênh.
        }
      }
      const shouldMoveToBottom = shouldMoveStatusToBottom({
        job: current,
        statusMessageId: current.statusMessageId,
        lastMessageId: channel.lastMessageId,
        lastMessageIsBot,
      });
      if (shouldMoveToBottom) {
        const source = sourceMessages.get(current.id);
        let replacement;
        if (source) {
          try {
            replacement = await source.reply(discordEmbedOptions(embed, statusOptions));
          } catch {
            replacement = await channel.send(discordEmbedOptions(embed, statusOptions));
          }
        } else {
          replacement = await channel.send(discordEmbedOptions(embed, statusOptions));
        }
        await jobStore.updateJob(current.id, { statusMessageId: replacement.id });
        await channel.messages.delete(current.statusMessageId).catch((error) => {
          logger.warn('Không xóa được status message cũ sau khi đưa tiến độ xuống cuối kênh.', {
            jobId: current.id,
            name: error.name,
          });
        });
        statusUpdatedAt.set(current.id, Date.now());
        return finalizeStatusPresentation(current, replacement, embed, {
          contextUsage,
          streamPreview,
        });
      }
      const statusMessage = await channel.messages.edit(
        current.statusMessageId,
        discordEmbedOptions(embed, { ...statusOptions, clearContent: true }),
      );
      statusUpdatedAt.set(current.id, Date.now());
      return finalizeStatusPresentation(current, statusMessage, embed, {
        contextUsage,
        streamPreview,
      });
    } catch (error) {
      logger.warn('Không cập nhật được status message cũ; sẽ tạo tin mới.', {
        jobId: current.id,
        name: error.name,
      });
    }
  }

  const source = sourceMessages.get(current.id);
  let statusMessage;
  if (source) {
    try {
      statusMessage = await source.reply(discordEmbedOptions(embed, statusOptions));
    } catch {
      statusMessage = await channel.send(discordEmbedOptions(embed, statusOptions));
    }
  } else {
    statusMessage = await channel.send(discordEmbedOptions(embed, statusOptions));
  }
  await jobStore.updateJob(current.id, { statusMessageId: statusMessage.id });
  statusUpdatedAt.set(current.id, Date.now());
  const createdAt = Date.parse(current.createdAt);
  const statusAckMs = Number.isFinite(createdAt) ? Math.max(0, Date.now() - createdAt) : null;
  if (statusAckMs !== null && statusAckMs <= 60000) {
    logger.info('Đã gửi status tiếp nhận job lên Discord.', {
      jobId: current.id,
      statusAckMs,
    });
  }
  return finalizeStatusPresentation(current, statusMessage, embed, {
    contextUsage,
    streamPreview,
  });
}

async function ensureStatusMessage(job) {
  if (statusUpdatePromises.has(job.id)) {
    return statusUpdatePromises.get(job.id);
  }
  const operation = updateStatusMessage(job);
  statusUpdatePromises.set(job.id, operation);
  try {
    return await operation;
  } finally {
    statusUpdatePromises.delete(job.id);
  }
}

function scheduleStatusUpdate(job, options = {}) {
  if (!job) {
    return;
  }
  const immediate = options.immediate === true || TERMINAL_JOB_STATUSES.has(job.status);
  if (statusUpdateTimers.has(job.id)) {
    if (!immediate) {
      return;
    }
    clearTimeout(statusUpdateTimers.get(job.id));
    statusUpdateTimers.delete(job.id);
  }
  const waitMs = statusUpdateDelay({
    immediate,
    lastUpdatedAt: statusUpdatedAt.get(job.id),
    debounceMs: options.debounceMs || config.statusUpdateDebounceMs,
  });
  const timer = setTimeout(() => {
    statusUpdateTimers.delete(job.id);
    void ensureStatusMessage(jobStore.getJob(job.id)).catch((error) => {
      logger.warn('Không thể cập nhật tiến độ job trên Discord.', {
        jobId: job.id,
        name: error.name,
      });
    });
  }, waitMs);
  timer.unref?.();
  statusUpdateTimers.set(job.id, timer);
}

async function sendArtifactToDiscord(job, artifact) {
  const channel = await resolveDiscordChannel(job.channelId);
  const prefix = artifact.resend ? '🔁 Gửi lại' : '🖼️';
  const label = artifactCaption(artifact);
  const attachment = new AttachmentBuilder(artifact.stagedPath, {
    name: `openclaw-${job.id}-${artifact.order}${artifact.extension}`,
  });
  const sent = await channel.send(discordMessageOptions(`${prefix} ${label}`, [attachment]));
  return sent.id;
}

supervisor = new JobSupervisor({
  store: jobStore,
  taskClient,
  openclaw,
  sessionsDir: OPENCLAW_SESSIONS_DIR,
  openclawHome: OPENCLAW_HOME,
  allowedRoots: OPENCLAW_MEDIA_ROOTS,
  outboxRoot: OPENCLAW_OUTBOX_ROOT,
  pollMs: config.jobPollMs,
  idleTimeoutMs: config.requestIdleTimeoutMs,
  maxRuntimeMs: config.requestMaxRuntimeMs,
  taskContinuationGraceMs: config.taskContinuationGraceMs,
  cancelGraceMs: config.cancelWarningMs,
  logger,
  onJobChanged: async (job) => {
    scheduleStatusUpdate(job);
    scheduleSessionActivityUpdates(job);
    if (TERMINAL_JOB_STATUSES.has(job.status)) {
      await finalizeScreenshotGallery(job).catch((error) => {
        logger.warn('Không chốt được gallery ảnh theo trạng thái cuối.', {
          jobId: job.id,
          name: error.name,
        });
      });
    }
    // Job kết thúc mà vẫn còn phản hồi hoãn (agent không gửi response cuối sau
    // worker nền) → gửi nốt để user không mất thông tin cuối.
    if (TERMINAL_JOB_STATUSES.has(job.status) && deferredResponses.has(job.id)) {
      const responseText = deferredResponses.get(job.id);
      deferredResponses.delete(job.id);
      await sendOpenClawResponse(job.id, responseText, { force: true }).catch((error) => {
        logger.warn('Không gửi được phản hồi đã hoãn khi job kết thúc.', {
          jobId: job.id,
          name: error.name,
        });
      });
    }
  },
  sendActivity: sendActivityToDiscord,
  sendArtifact: sendArtifactToDiscord,
  onScreenshot: sendScreenshotToDiscord,
});

function clearScheduledStatusUpdate(jobId) {
  if (!statusUpdateTimers.has(jobId)) {
    return;
  }
  clearTimeout(statusUpdateTimers.get(jobId));
  statusUpdateTimers.delete(jobId);
}

async function flushStatusBeforeResponse(jobId) {
  clearScheduledStatusUpdate(jobId);
  const job = jobStore.getJob(jobId);
  if (job) {
    await ensureStatusMessage(job);
  }
}

async function runOpenClawResponseDelivery(jobId, responseText) {
  streamPreviews.delete(jobId);
  const parsed = extractMediaReferences(responseText);
  const artifacts = [];
  for (const item of parsed.items) {
    const artifact = await supervisor.registerArtifact(
      jobId,
      item.reference,
      item.label || 'Ảnh thành phẩm từ OpenClaw',
      { deliver: false },
    );
    if (artifact) {
      artifacts.push(artifact);
    }
  }
  const allMediaRegistered = artifacts.length === parsed.items.length;
  const visibleText = (allMediaRegistered ? parsed.standaloneText : parsed.text)
    || (!artifacts.length ? responseText || 'OpenClaw không trả về nội dung.' : '');
  await flushStatusBeforeResponse(jobId);
  if (visibleText) {
    await sendJobResponse(jobStore.getJob(jobId), visibleText);
  }
  for (const artifact of artifacts) {
    await supervisor.deliverArtifact(jobId, artifact.id);
  }
  const responseSentAt = new Date();
  await jobStore.updateJob(jobId, {
    responseSent: true,
    responseSentAt: responseSentAt.toISOString(),
    responseText: normalizeResponseDedupKey(visibleText || responseText || ''),
  });
  const completedJob = jobStore.getJob(jobId);
  const createdAt = Date.parse(completedJob.createdAt);
  const startedAt = completedJob.startedAt == null ? Number.NaN : Number(completedJob.startedAt);
  const requestSubmittedAt = completedJob.requestSubmittedAt == null
    ? Number.NaN
    : Number(completedJob.requestSubmittedAt);
  const firstDeltaAt = completedJob.firstDeltaAt == null
    ? Number.NaN
    : Number(completedJob.firstDeltaAt);
  const responseSentAtMs = responseSentAt.getTime();
  logger.info('Đã gửi phản hồi OpenClaw lên Discord.', {
    jobId,
    queueWaitMs: Number.isFinite(startedAt) && Number.isFinite(createdAt)
      ? Math.max(0, startedAt - createdAt)
      : null,
    firstDeltaMs: Number.isFinite(firstDeltaAt) && Number.isFinite(requestSubmittedAt)
      ? Math.max(0, firstDeltaAt - requestSubmittedAt)
      : null,
    responseDeliveryMs: Number.isFinite(requestSubmittedAt)
      ? Math.max(0, responseSentAtMs - requestSubmittedAt)
      : null,
  });
  return true;
}

function normalizeResponseDedupKey(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => !/^MEDIA:/i.test(line))
    .join('\n')
    .trim();
}

async function sendOpenClawResponse(jobId, responseText, options = {}) {
  const current = jobStore.getJob(jobId);
  const dedupeKey = normalizeResponseDedupKey(responseText);
  if (current?.responseSent) {
    if (dedupeKey && dedupeKey === current.responseText) {
      return false;
    }
    // Text trung gian (foreground) có thể đã được gửi; chỉ phản hồi cuối thật
    // từ transcript (options.final) hoặc phản hồi hoãn khi job kết thúc
    // (options.force) được phép gửi thêm, tránh trùng lặp.
    if (options.final !== true && !options.force) {
      return false;
    }
  }
  // Transcript-final đến trong khi worker nền vẫn đang chạy → agent còn tiếp
  // tục công việc; hoãn gửi cho tới khi worker xong hoặc job kết thúc để không
  // gửi lời tự thuật giữa chừng như phản hồi cuối.
  if (
    !options.force
    && options.deferWhileTasksActive
    && current
    && !TERMINAL_JOB_STATUSES.has(current.status)
    && Object.values(current.tasks || {}).some((task) => ACTIVE_TASK_STATUSES.has(task.status))
  ) {
    deferredResponses.set(jobId, responseText);
    return false;
  }
  if (responseDeliveryPromises.has(jobId)) {
    return responseDeliveryPromises.get(jobId);
  }
  const operation = enqueueDiscordDelivery(jobId, async () => {
    const latest = jobStore.getJob(jobId);
    const latestKey = normalizeResponseDedupKey(responseText);
    if (latest?.responseSent) {
      if (latestKey && latestKey === latest.responseText) {
        return false;
      }
      if (options.final !== true && !options.force) {
        return false;
      }
    }
    const delivered = await runOpenClawResponseDelivery(jobId, responseText);
    if (delivered) {
      deferredResponses.delete(jobId);
    }
    return delivered;
  });
  responseDeliveryPromises.set(jobId, operation);
  try {
    return await operation;
  } finally {
    if (responseDeliveryPromises.get(jobId) === operation) {
      responseDeliveryPromises.delete(jobId);
    }
  }
}

async function responseAlreadyOnDiscord(job, channel) {
  try {
    const messages = await channel.messages.fetch({ after: job.requestMessageId, limit: 100 });
    const footerPrefix = `Job ${job.id} •`;
    return messages.some((message) => (
      message.author.id === client.user.id
      && message.embeds.some((embed) => embed.footer?.text?.startsWith(footerPrefix))
    ));
  } catch {
    return false;
  }
}

async function recoverUnsentResponse(job) {
  if (job.responseSent) {
    return false;
  }
  const channel = await resolveDiscordChannel(job.channelId);
  if (await responseAlreadyOnDiscord(job, channel)) {
    await jobStore.updateJob(job.id, {
      responseSent: true,
      responseSentAt: job.responseSentAt || new Date().toISOString(),
    });
    return true;
  }

  let source = null;
  try {
    source = await channel.messages.fetch(job.requestMessageId);
  } catch {
    // Recovery can still send to the channel when the source message was deleted.
  }
  const requestFingerprint = job.requestFingerprint || fingerprintText(source?.content);
  if (!requestFingerprint) {
    return false;
  }
  const responseText = await findSessionResponse(OPENCLAW_SESSIONS_DIR, job.rootSessionKey, {
    requestFingerprint,
    afterTimestampMs: Number(job.requestSubmittedAt) || Date.parse(job.createdAt) - 1000,
  });
  if (!responseText) {
    return false;
  }

  if (source) {
    sourceMessages.set(job.id, source);
  }
  try {
    await sendOpenClawResponse(job.id, responseText);
  } finally {
    sourceMessages.delete(job.id);
  }
  logger.info('Đã khôi phục phản hồi OpenClaw chưa gửi từ transcript.', { jobId: job.id });
  return true;
}

function publicErrorMessage(error) {
  if (
    error instanceof AttachmentError
    || error instanceof AudioTranscriptionError
    || error instanceof QueueFullError
  ) {
    return error.message;
  }
  if (error instanceof OpenClawError) {
    switch (error.code) {
      case 'auth':
        return 'OpenClaw từ chối token Gateway. Hãy kiểm tra cấu hình trên máy chủ.';
      case 'rate_limited':
        return 'OpenClaw đang giới hạn tần suất. Hãy thử lại sau.';
      case 'payload_too_large':
        return 'Nội dung hoặc ảnh vượt giới hạn của OpenClaw.';
      case 'network':
        return `Không thể kết nối tới OpenClaw cục bộ. Hãy dùng \`${config.prefix} openclaw status\` để kiểm tra.`;
      case 'stream_interrupted':
        return 'Kết nối của lượt xử lý này bị gián đoạn. OpenClaw có thể vẫn đang chạy; hãy gửi lại yêu cầu nếu chưa nhận được phản hồi.';
      case 'stream_error':
        return `Model đang chọn lỗi liên tục sau khi đã thử lại nhiều lần. Hãy dùng \`${config.prefix} o m\` để đổi model hoặc kiểm tra tài khoản backend của profile.`;
      case 'unavailable':
        return 'Gateway OpenClaw đã phản hồi nhưng tạm thời không xử lý được yêu cầu. Hãy thử lại sau.';
      default:
        return 'OpenClaw không xử lý được yêu cầu này.';
    }
  }
  if (error?.code === 'idle_timeout') {
    return 'OpenClaw không có hoạt động mới trong 30 phút nên bot đã dừng chờ. Durable task còn chạy vẫn tiếp tục được theo dõi.';
  }
  if (error?.code === 'max_runtime') {
    return `Lượt OpenClaw đã đạt giới hạn an toàn 12 giờ. Hãy dùng \`${config.prefix} openclaw resume\` để khôi phục từ checkpoint.`;
  }
  return 'Bot gặp lỗi khi xử lý yêu cầu. Chi tiết đã được ghi vào log cục bộ.';
}

function activeJobsForChannel(channelId) {
  return jobStore.listJobs({ channelId, activeOnly: true });
}

async function stopJobs(jobs) {
  const selectedIds = new Set(jobs.map((job) => job.id));
  const stoppedQueueItems = requestQueue.stopWhere((metadata) => selectedIds.has(metadata.jobId));
  for (const job of jobs) {
    if (job.status === 'queued') {
      await jobStore.updateJob(job.id, {
        status: 'stopped',
        terminalReason: 'Đã xóa khỏi hàng đợi theo yêu cầu người dùng.',
      });
      scheduleStatusUpdate(jobStore.getJob(job.id));
    } else {
      await supervisor.cancelJob(job.id);
    }
  }
  return stoppedQueueItems;
}

function parseResendTarget(channelId, args = []) {
  if (!args.length) {
    return { job: jobStore.latestJob(channelId), selector: 'all', force: false };
  }
  if (args.length === 1 && (args[0].toLowerCase() === 'all' || /^\d{1,3}$/.test(args[0]))) {
    return { job: jobStore.latestJob(channelId), selector: args[0].toLowerCase(), force: true };
  }
  return {
    job: jobStore.getJob(args[0]),
    selector: String(args[1] || 'all').toLowerCase(),
    force: true,
  };
}

async function handleCommand(message, command) {
  if (!isAllowed(message.author.id)) {
    await sendChunks(message, 'Bạn không có quyền sử dụng OpenClaw trên bot này.');
    return;
  }

  let current = stateStore.getChannel(config.guildId, message.channel.id);
  if (command.action === 'system') {
    await message.channel.sendTyping().catch(() => {});
    const gatewayPromise = (async () => {
      const startedAt = Date.now();
      const health = await openclaw.health();
      return { ...health, latencyMs: Date.now() - startedAt };
    })();
    const [metrics, gateway] = await Promise.all([
      collectSystemMetrics(),
      gatewayPromise,
    ]);
    const embed = buildSystemStatusEmbed(metrics, {
      gateway,
      botIconUrl: botIconUrl(),
    });
    try {
      await message.reply(discordEmbedOptions(embed));
    } catch {
      await message.channel.send(discordEmbedOptions(embed));
    }
    return;
  }

  if (command.action === 'bind') {
    if (message.channel.type !== ChannelType.GuildText) {
      await sendChunks(message, 'Chỉ cho phép bật OpenClaw trong text channel thông thường của server.');
      return;
    }
    const bound = await stateStore.bindChannel(config.guildId, message.channel.id);
    const everyoneCanView = message.channel
      .permissionsFor(message.guild.roles.everyone)
      ?.has(PermissionFlagsBits.ViewChannel);
    const displayModel = bound.customModel || config.openclawBackendModels[bound.modelProfile];
    const lines = [
      `Đã bật OpenClaw cho <#${message.channel.id}>.`,
      bound.changed
        ? `Phiên riêng của kênh đã sẵn sàng (phiên ${bound.sessionGeneration}).`
        : `Kênh này đang giữ nguyên phiên ${bound.sessionGeneration}.`,
      bound.customModel
        ? `Model: **${displayModel}** (tùy chọn) · Provider: ${config.openclawBackendModels[bound.modelProfile]}.`
        : `Model profile: ${bound.modelProfile} (\`${displayModel}\`).`,
    ];
    if (everyoneCanView) {
      lines.push('Cảnh báo: kênh này đang hiển thị với @everyone; nội dung phản hồi có thể chứa dữ liệu nhạy cảm.');
    }
    await sendChunks(message, lines.join('\n'));
    logger.info('Đã chọn kênh OpenClaw.', {
      guildId: config.guildId,
      channelId: message.channel.id,
      sessionGeneration: bound.sessionGeneration,
      publicChannel: Boolean(everyoneCanView),
    });
    return;
  }

  if (command.action === 'status') {
    await message.channel.sendTyping().catch(() => {});
    const healthStartedAt = Date.now();
    const health = await openclaw.health();
    const gateway = { ...health, latencyMs: Date.now() - healthStartedAt };
    const activeChannels = stateStore.getActiveChannels(config.guildId);
    const queue = requestQueue.getDetailedStatus();
    const activeJobs = jobStore.listJobs({ activeOnly: true });
    const botIsAdmin = message.guild.members.me?.permissions.has(PermissionFlagsBits.Administrator);
    const everyoneCanView = message.channel
      .permissionsFor(message.guild.roles.everyone)
      ?.has(PermissionFlagsBits.ViewChannel);
    const currentChannel = current
      ? {
        ...current,
        backendModel: current.customModel || config.openclawBackendModels[current.modelProfile],
        customModel: current.customModel || null,
      }
      : null;
    const embed = buildOpenClawStatusEmbed({
      gateway,
      currentChannel,
      currentJob: jobStore.latestJob(message.channel.id),
      activeChannels,
      activeJobs,
      queue: { ...queue, maxPending: config.maxPending },
      media: {
        sourceRoots: OPENCLAW_MEDIA_ROOTS.length,
        retentionHours: config.mediaOutboxRetentionHours,
      },
      security: {
        publicChannel: typeof everyoneCanView === 'boolean' ? everyoneCanView : null,
        botIsAdmin: Boolean(botIsAdmin),
        allowedUsers: config.allowedUserIds.size,
      },
      prefix: config.prefix,
      botIconUrl: botIconUrl(),
    });
    try {
      await message.reply(discordEmbedOptions(embed));
    } catch {
      await message.channel.send(discordEmbedOptions(embed));
    }
    return;
  }

  if (command.action === 'model') {
    if (!current?.enabled) {
      await sendChunks(message, 'Kênh hiện tại chưa bật OpenClaw.');
      return;
    }

    // Gộp toàn bộ args để nhận được tên profile app có dấu cách (vd "H&T Store").
    const modelArg = (command.args || []).join(' ').toLowerCase().trim();

    // Không có args → mở bảng chọn model
    if (!modelArg) {
      await message.channel.sendTyping().catch(() => {});
      try {
        const syncResult = await syncModelFromApp(message.channelId);
        if (syncResult.changed) {
          current = syncResult.current;
        }
        // Quét lại profile app mỗi lần mở bảng chọn: profile mới thêm trong app
        // xuất hiện ngay, không cần restart bot.
        await ensureAppProfileProviders({ force: true, openclawClient: openclaw });
        await ensureHardcodedModelRoutes();
        await fetchModelCatalogCached(openclaw);
        const nav = { level: 1, group: null, profileKey: null, page: 0 };
        const view = buildPickerView(nav, current);
        const picker = paginateOptions(view.options, 0);
        const active = activeAppProfile();

        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('🎛️ BẢNG CHỌN MODEL')
          .setDescription(
            `Model hiện tại: **${describeChannelModel(current)}**\n` +
            (active ? `App desktop đang bật: **${active.name}**\n` : '') +
            '\n' +
            (syncResult.changed
              ? `🔄 Đã tự đồng bộ từ Claude Profile Switcher: **${syncResult.label}**\n`
              : '') +
            `Chọn nhóm (**Claude** / **9router** / **local** / **opus**), rồi chọn profile và model bên dưới. Model chọn được áp dụng cho **toàn bộ session** đang bật.\n` +
            `Muốn chọn model bất kỳ: \`${config.prefix} o m <model-id>\` · Làm mới cache: \`${config.prefix} o m refresh\``
          )
          .setFooter({ text: modelPickerFooterText(view.footer, picker) })
          .setTimestamp();

        const payload = {
          embeds: [embed],
          components: buildModelPickerComponents(nav, picker),
          allowedMentions: { repliedUser: false },
        };
        let pickMessage;
        try {
          pickMessage = await message.reply(payload);
        } catch {
          pickMessage = await message.channel.send(payload);
        }
        modelPickNav.set(pickMessage.id, {
          ...nav,
          page: picker.page,
          baseDescription: embed.data.description,
        });
      } catch (error) {
        await sendChunks(message, `Không thể lấy danh sách model: ${publicErrorMessage(error)}`);
      }
      return;
    }

    // refresh cache
    if (modelArg === 'refresh') {
      modelsCache = null;
      modelsCacheExpiresAt = 0;
      invalidateCatalogCache();
      invalidateAppProfilesCache();
      await sendChunks(message, `Đã xóa cache model và profile app. Dùng \`${config.prefix} o m\` để tải lại danh sách.`);
      return;
    }

    // Profile của Claude Profile Switcher: cho gõ theo tên, slug hoặc model id.
    // Tên profile có thể chứa dấu cách ("Tuat 1 ngay") nên thử cả chuỗi đầy đủ.
    {
      await ensureAppProfileProviders({ force: true, openclawClient: openclaw });
      const matchedProfile = findAppProfileByArg(modelArg);
      if (matchedProfile) {
        const channelIds = await applyModelToAllChannels({
          customModel: matchedProfile.modelId,
        });
        await sendChunks(message, [
          `Đã chuyển model **${matchedProfile.modelId}** (profile app **${matchedProfile.name}**) cho toàn bộ **${channelIds.length}** session đang bật.`,
          'Job đang chạy vẫn dùng model cũ; lựa chọn mới áp dụng từ yêu cầu tiếp theo.',
        ].join('\n'));
        return;
      }
    }

    // Profile cứng (local / 9router): gõ tên profile hoặc model thật của nó.
    {
      const hardProfile = Object.hasOwn(config.openclawBackendModels, modelArg)
        ? modelArg
        : Object.entries(config.openclawBackendModels)
          .find(([, model]) => model.toLowerCase() === modelArg)?.[0];
      if (hardProfile) {
        const channelIds = await applyModelToAllChannels({
          customModel: null,
          modelProfile: hardProfile,
        });
        await sendChunks(message, [
          `Đã chuyển model của toàn bộ **${channelIds.length}** session sang **${hardProfile}** (\`${config.openclawBackendModels[hardProfile]}\`).`,
          'Job đang chạy vẫn dùng model cũ; lựa chọn mới áp dụng từ yêu cầu tiếp theo.',
        ].join('\n'));
        return;
      }
    }

    // Model bất kỳ trong danh mục tổng hợp: gõ ID model là chọn được dù model
    // đó thuộc backend/profile chưa kích hoạt (vd "claude-opus-4-6").
    {
      await fetchModelCatalogCached(openclaw);
      const pickerCatalog = modelPickerCatalog(current);
      const matched = findModelInCatalog(pickerCatalog.options, modelArg);
      if (matched) {
        const modelId = matched.value.slice('model:'.length);
        const profile = appProfilesCached().find((item) => item.modelId === modelId);
        const channelIds = await applyModelToAllChannels({ customModel: modelId });
        await sendChunks(message, [
          profile
            ? `Đã chọn model **${modelId}** (profile app **${profile.name}**) cho toàn bộ **${channelIds.length}** session đang bật.`
            : `Đã chọn model **${modelId}** cho toàn bộ **${channelIds.length}** session đang bật.`,
          'Job đang chạy vẫn dùng model cũ; lựa chọn mới áp dụng từ yêu cầu tiếp theo.',
        ].join('\n'));
        return;
      }
    }

    // Thử chọn model từ danh sách API
    try {
      const models = await fetchModelsCached(openclaw);
      const matched = models.find((m) => m.id.toLowerCase() === modelArg);
      if (!matched) {
        await sendChunks(message, [
          `Không tìm thấy model \`${modelArg}\`.`,
          `Dùng \`${config.prefix} o m\` để xem danh sách model khả dụng.`,
        ].join('\n'));
        return;
      }
      const channelIds = await applyModelToAllChannels({ customModel: matched.id });
      await sendChunks(message, [
        `Đã chọn model **${matched.id}** cho toàn bộ **${channelIds.length}** session đang bật.`,
        'Job đang chạy vẫn dùng model cũ; lựa chọn mới áp dụng từ yêu cầu tiếp theo.',
      ].join('\n'));
    } catch (error) {
      await sendChunks(message, `Không thể xác minh model: ${publicErrorMessage(error)}`);
    }
    return;
  }

  if (command.action === 'jobs') {
    const jobs = jobStore.listJobs({ limit: 10 });
    const lines = jobs.length
      ? jobs.map((job) => {
        const counts = artifactCounts(job);
        return `\`${job.id}\` · <#${job.channelId}> · ${job.status} · ${counts.delivered}/${counts.total} file`;
      })
      : ['Chưa có job OpenClaw nào được lưu.'];
    await sendChunks(message, ['**10 job OpenClaw gần nhất**', ...lines].join('\n'));
    return;
  }

  if (command.action === 'restartoc' || command.action === 'resetbot') {
    if (!isAllowed(message.author.id)) {
      await sendChunks(message, 'Bạn không có quyền restart bot.');
      return;
    }
    const isReset = command.action === 'resetbot';
    await sendChunks(
      message,
      isReset ? '🔄 Đang reset Bot Discord...' : '🔄 Đang restart Bot OpenClaw...',
    );
    // Gửi phản hồi trước rồi mới restart để user biết
    await message.channel.send('Bot sẽ khởi động lại trong giây lát...').catch(() => {});
    logger.info('Người dùng yêu cầu restart bot qua Discord.', {
      userId: message.author.id,
      channelId: message.channel.id,
      action: command.action,
    });
    // Spawn script restart bên ngoài, bot này sẽ bị kill bởi script
    const { spawn } = require('node:child_process');
    const scriptPath = path.join(BOT_ROOT, 'scripts', 'restart-bot.ps1');
    const ps = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      '-ForceKill',
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    ps.unref();
    // Để script kịp chạy trước khi process này bị kill
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return;
  }

  if (command.action === 'resend') {
    const target = parseResendTarget(message.channel.id, command.args);
    if (!target.job) {
      await sendChunks(message, 'Không tìm thấy job để gửi lại.');
      return;
    }
    const sent = await supervisor.resend(target.job.id, target.selector, target.force);
    await sendChunks(
      message,
      sent.length
        ? `Đã gửi lại ${sent.length} file của job \`${target.job.id}\`.`
        : 'Không có file phù hợp để gửi lại.',
    );
    return;
  }

  if (command.action === 'resume') {
    const job = command.args?.[0]
      ? jobStore.getJob(command.args[0])
      : jobStore.latestJob(message.channel.id);
    if (!job) {
      await sendChunks(message, 'Không tìm thấy job để khôi phục.');
      return;
    }
    if (!TERMINAL_JOB_STATUSES.has(job.status) || job.status === 'completed') {
      await sendChunks(message, 'Chỉ có thể resume job đã dừng, thất bại hoặc hoàn tất có blocker.');
      return;
    }
    void requestQueue.enqueue(
      (signal) => supervisor.recoverJob(job.id, signal, { force: true }),
      {
        jobId: job.id,
        channelId: job.channelId,
        sessionKey: job.rootSessionKey,
        recovery: true,
      },
    ).catch(async (error) => {
      logger.error('Không khôi phục được job OpenClaw.', { jobId: job.id, name: error.name });
      await sendChunks(message, publicErrorMessage(error)).catch(() => {});
    });
    await sendChunks(message, `Đã xếp job \`${job.id}\` vào hàng đợi của session để khôi phục an toàn.`);
    return;
  }

  if (command.action === 'stop') {
    const selector = command.args?.[0];
    const jobs = selector === 'all'
      ? jobStore.listJobs({ activeOnly: true })
      : selector
        ? [jobStore.getJob(selector)].filter(Boolean)
        : activeJobsForChannel(message.channel.id);
    if (!jobs.length) {
      await sendChunks(message, 'Không có job đang hoạt động phù hợp để dừng.');
      return;
    }
    await stopJobs(jobs);
    await sendChunks(
      message,
      `Đã gửi yêu cầu dừng ${jobs.length} job. Bot sẽ chỉ báo “đã dừng” sau khi OpenClaw xác nhận toàn bộ worker đã kết thúc.`,
    );
    return;
  }

  if (command.action === 'reset' || command.action === 'off') {
    if (!current?.enabled) {
      await sendChunks(message, 'Kênh hiện tại chưa bật OpenClaw.');
      return;
    }
    await stopJobs(activeJobsForChannel(message.channel.id));
    if (command.action === 'reset') {
      const reset = await stateStore.resetSession(config.guildId, message.channel.id);
      await sendChunks(message, `Đã tạo phiên OpenClaw mới (phiên ${reset.sessionGeneration}) sau khi yêu cầu dừng job cũ.`);
    } else {
      await stateStore.unbind(config.guildId, message.channel.id);
      await sendChunks(message, 'Đã tắt OpenClaw riêng cho kênh hiện tại và yêu cầu dừng job đang chạy.');
    }
    return;
  }

  await sendChunks(message, [
    `Lệnh hợp lệ: \`${config.prefix} openclaw\``,
    `Tài nguyên máy: \`${config.prefix} s\``,
    `Xem nhanh trạng thái: \`${config.prefix} o\` hoặc \`${config.prefix} o status\``,
    `\`${config.prefix} openclaw status\``,
    `\`${config.prefix} openclaw model\` · nhanh: \`${config.prefix} o m\` — xem & chọn model`,
    `\`${config.prefix} openclaw resetbot\` · nhanh: \`${config.prefix} o rb\` — reset bot`,
    `\`${config.prefix} openclaw restartoc\` · nhanh: \`${config.prefix} o rsoc\` — restart bot (tương đương)`,
    `\`${config.prefix} openclaw jobs\``,
    `\`${config.prefix} openclaw resend [job-id] [all|số]\``,
    `\`${config.prefix} openclaw resume [job-id]\``,
    `\`${config.prefix} openclaw stop [job-id|all]\` · nhanh: \`${config.prefix} o stop [job-id|all]\``,
    `\`${config.prefix} openclaw reset\``,
    `\`${config.prefix} openclaw off\``,
  ].join('\n'));
}

// Retry các lỗi xảy ra TRƯỚC khi Gateway tiêu thụ lượt chat (request bị từ chối
// hoặc mạng đứt) — retry lúc này không tạo bản sao tin nhắn trong session.
// stream_error là Gateway đã kết thúc stream với payload error → lượt run đã chết
// và OpenClaw rollback turn thất bại (transcript chỉ ghi "[assistant turn failed
// before producing content]" — chuỗi transcript watcher lọc bỏ), nên retry cùng
// session không tạo bản sao và là cách duy nhất hồi phục vì Gateway không fallback
// cho model bị ghim bằng header x-openclaw-model. stream_interrupted KHÔNG retry:
// OpenClaw có thể vẫn đang chạy lượt đó, transcript watcher sẽ tự bù phản hồi.
function isRetryableOpenClawErrorCode(code) {
  return code === 'rate_limited'
    || code === 'unavailable'
    || code === 'network'
    || code === 'stream_error';
}

// Gọi OpenClaw, tự thử lại nhiều lần khi provider lỗi tạm thời. Gateway KHÔNG
// fallback cho model bị ghim bằng header (x-openclaw-model) — đã kiểm chứng —
// nên bot phải tự retry: chờ giữa các lần để provider kịp hồi phục. Nếu hết
// lượt thử, kèm chú thích model lỗi vào phản hồi thay vì để chuỗi lỗi trần.
//
// Lượt "non-deliverable" được xử lý khác: model đã chạy (có thể đã gọi tool
// xong) nhưng kết thúc mà không sinh text, nên gửi lại nguyên văn yêu cầu sẽ
// chạy lại tool lần nữa. Thay vào đó bot gửi một lời nhắc ngắn trong cùng
// session để model chốt lại câu trả lời từ ngữ cảnh đã có, và không chờ lâu
// vì provider không hề lỗi.
const OPENCLAW_NUDGE_TEXT = 'Lượt vừa rồi bạn kết thúc mà chưa gửi câu trả lời nào cho người dùng. KHÔNG chạy lại bất kỳ lệnh hay tool nào. Chỉ viết lại kết quả bạn vừa có thành câu trả lời ngắn gọn bằng tiếng Việt.';
const OPENCLAW_NUDGE_ATTEMPTS = 2;
const OPENCLAW_NUDGE_DELAY_MS = 2000;

// Nhắc model chốt câu trả lời sau một lượt non-deliverable. Dùng lại đúng
// session (cùng guild/channel/sessionGeneration) nên model vẫn thấy toàn bộ
// ngữ cảnh và kết quả tool của lượt trước; không gửi lại ảnh hay yêu cầu gốc
// để tránh chạy lại tool. Trả về null nếu vẫn không lấy được text.
async function nudgeNonDeliverableTurn(params, jobId) {
  const nudgeParams = {
    guildId: params.guildId,
    channelId: params.channelId,
    sessionGeneration: params.sessionGeneration,
    modelProfile: params.modelProfile,
    backendModel: params.backendModel,
    text: OPENCLAW_NUDGE_TEXT,
    signal: params.signal,
  };
  for (let attempt = 1; attempt <= OPENCLAW_NUDGE_ATTEMPTS; attempt += 1) {
    if (params.signal?.aborted) {
      return null;
    }
    logger.warn('Lượt OpenClaw không sinh text; nhắc model chốt câu trả lời.', {
      jobId,
      attempt,
      attempts: OPENCLAW_NUDGE_ATTEMPTS,
      backendModel: params.backendModel,
    });
    try {
      const text = await openclaw.chat(nudgeParams);
      if (text && !isGatewayNonDeliverableText(text) && !isGatewayFailureText(text)) {
        return text;
      }
    } catch (error) {
      logger.warn('Nhắc lại lượt non-deliverable thất bại.', {
        jobId,
        attempt,
        code: error instanceof OpenClawError ? error.code : null,
      });
      if (!(error instanceof OpenClawError) || !isRetryableOpenClawErrorCode(error.code)) {
        return null;
      }
    }
    if (attempt < OPENCLAW_NUDGE_ATTEMPTS) {
      await retryDelay(OPENCLAW_NUDGE_DELAY_MS);
    }
  }
  return null;
}

async function chatOpenClawWithRetry(params, jobId, responseGate) {
  const attempts = 1 + OPENCLAW_CHAT_RETRY_DELAYS_MS.length;
  let lastError = null;
  let lastText = '';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (params.signal?.aborted) {
      throw params.signal.reason || new Error('Hết thời gian chờ yêu cầu.');
    }
    try {
      const text = await openclaw.chat(params);
      lastText = text;
      if (isGatewayNonDeliverableText(text)) {
        const nudged = await nudgeNonDeliverableTurn(params, jobId);
        if (nudged) {
          return nudged;
        }
        return text;
      }
      if (!isGatewayFailureText(text)) {
        return text;
      }
      logger.warn('OpenClaw trả về chuỗi lỗi model; sẽ thử lại sau khi chờ.', {
        jobId,
        attempt,
        attempts,
        preview: text.slice(0, 160),
      });
    } catch (error) {
      lastError = error;
      if (responseGate?.delivered) {
        throw error;
      }
      if (!(error instanceof OpenClawError) || !isRetryableOpenClawErrorCode(error.code)) {
        throw error;
      }
      logger.warn('Lỗi tạm thời khi gọi OpenClaw; sẽ thử lại sau khi chờ.', {
        jobId,
        attempt,
        attempts,
        code: error.code,
        status: error.status,
      });
    }
    if (attempt < attempts) {
      await retryDelay(OPENCLAW_CHAT_RETRY_DELAYS_MS[attempt - 1]);
    }
  }
  if (lastError) {
    throw lastError;
  }
  if (isGatewayFailureText(lastText)) {
    const model = String(params.backendModel || 'theo cấu hình').trim();
    return `⚠️ Model \`${model}\` vẫn lỗi sau ${attempts} lần thử:\n${lastText}`;
  }
  return lastText;
}

async function processOpenClawMessage(message, state, jobId, signal) {
  const startedAt = Date.now();
  sourceMessages.set(jobId, message);
  await supervisor.watchJob(jobId, { rootStartAtEnd: true });
  await jobStore.updateJob(jobId, { status: 'running', startedAt });
  scheduleStatusUpdate(jobStore.getJob(jobId), { immediate: true });

  const deadline = new RequestDeadline({
    signal,
    idleTimeoutMs: config.requestIdleTimeoutMs,
    maxRuntimeMs: config.requestMaxRuntimeMs,
  });
  supervisor.setActivityTouch(jobId, () => deadline.touch());
  const typing = () => message.channel.sendTyping().catch(() => {});
  await typing();
  let typingTimer = setInterval(typing, 8000);
  typingTimer.unref?.();
  const stopTyping = () => {
    if (typingTimer) {
      clearInterval(typingTimer);
      typingTimer = null;
    }
  };
  let responseText = '';
  let foregroundError = null;
  let responseWatcherController = null;
  let responseWatcherPromise = Promise.resolve(false);
  let firstDeltaRecorded = Boolean(jobStore.getJob(jobId)?.firstDeltaAt);

  const responseGate = new ResponseDeliveryGate(async (text, options = {}) => {
    const latest = stateStore.getChannel(config.guildId, message.channelId);
    if (!latest?.enabled || latest.sessionGeneration !== state.sessionGeneration) {
      throw new QueueStoppedError();
    }
    await sendOpenClawResponse(jobId, text, options);
    stopTyping();
  });

  const handleStreamDelta = async ({ text }) => {
    deadline.touch();
    if (responseGate.pending || responseGate.delivered) {
      return;
    }
    streamPreviews.set(jobId, sanitizeActivityText(text, 1000));
    scheduleStatusUpdate({ id: jobId, status: 'running' }, {
      debounceMs: config.streamUpdateMs,
    });
    if (!firstDeltaRecorded) {
      firstDeltaRecorded = true;
      await jobStore.updateJob(jobId, { firstDeltaAt: Date.now() });
    }
  };

  try {
    const attachments = await prepareMessageAttachments(message.attachments.values(), {
      signal: deadline.signal,
      audioTranscriber,
      onAudioStart: () => {
        deadline.touch();
        return supervisor.handleEvent(jobId, {
          kind: 'tool_call',
          origin: 'audio',
          isRoot: true,
          text: '▶ `audio.transcribe` — phiên âm file âm thanh',
          mediaReferences: [],
        });
      },
      onAudioComplete: () => {
        deadline.touch();
        return supervisor.handleEvent(jobId, {
          kind: 'tool_result',
          origin: 'audio',
          isRoot: true,
          text: '✓ `audio.transcribe` hoàn tất',
          mediaReferences: [],
        });
      },
    });
    const requestText = appendAudioTranscripts(message.content, attachments.audioTranscripts);
    const requestFingerprint = fingerprintText(requestText);
    const requestSubmittedAt = Date.now();
    await jobStore.updateJob(jobId, {
      requestFingerprint,
      requestSubmittedAt,
    });
    responseWatcherController = new AbortController();
    responseWatcherPromise = waitForSessionResponse(
      OPENCLAW_SESSIONS_DIR,
      jobStore.getJob(jobId).rootSessionKey,
      {
        requestFingerprint,
        afterTimestampMs: requestSubmittedAt - 1000,
        maxWaitMs: config.requestMaxRuntimeMs,
        signal: responseWatcherController.signal,
      },
    ).then(async (transcriptResponse) => {
      if (!transcriptResponse) {
        return false;
      }
      await responseGate.deliverOnce(transcriptResponse, { deferWhileTasksActive: true });
      logger.info('Đã gửi phản hồi Discord sớm từ transcript OpenClaw.', { jobId });
      return true;
    }).catch((error) => {
      if (!responseWatcherController.signal.aborted) {
        logger.warn('Không gửi được phản hồi sớm từ transcript OpenClaw.', {
          jobId,
          name: error.name,
        });
      }
      return false;
    });
    responseText = await chatOpenClawWithRetry({
      guildId: message.guildId,
      channelId: message.channelId,
      sessionGeneration: state.sessionGeneration,
      modelProfile: state.modelProfile,
      backendModel: state.customModel || config.openclawBackendModels[state.modelProfile],
      text: requestText,
      imageParts: attachments.imageParts,
      signal: deadline.signal,
      onDelta: handleStreamDelta,
    }, jobId, responseGate);
    if (isNoResponsePlaceholder(responseText)) {
      logger.info('Bỏ qua placeholder của OpenClaw và tiếp tục chờ tác vụ nền.', { jobId });
    } else {
      await responseGate.deliverOnce(responseText);
    }
  } catch (error) {
    if (responseGate.delivered) {
      logger.warn('OpenClaw kết thúc HTTP với lỗi sau khi Discord đã nhận phản hồi.', {
        jobId,
        name: error.name,
      });
    } else {
      foregroundError = error;
    }
  } finally {
    streamPreviews.delete(jobId);
    stopTyping();
    deadline.stop();
    supervisor.setActivityTouch(jobId, null);
    await supervisor.markForegroundDone(jobId, { error: foregroundError });
  }

  // Chờ job settle: nếu session gốc vẫn hoạt động (vd task con báo failed nhưng
  // agent đang phục hồi), supervisor sẽ hoãn settle tới khi có phản hồi cuối
  // hoặc session im lặng. Giữ watcher transcript sống trong khoảng chờ đó để
  // vẫn bắt được phản hồi cuối nếu cần.
  const settled = await supervisor.waitForSettled(jobId);
  responseWatcherController?.abort();
  await responseWatcherPromise;
  sourceMessages.delete(jobId);
  if (foregroundError && settled?.status === 'failed') {
    throw foregroundError;
  }
  return settled;
}

async function handleDiscordMessage(message, options = {}) {
  if (
    !message.guild
    || message.guildId !== config.guildId
    || message.author.bot
    || message.webhookId
  ) {
    return true;
  }

  try {
    const command = parseCommand(message.content, config.prefix);
    if (command) {
      if (options.recovered) {
        logger.info('Bỏ qua lệnh Discord cũ khi quét bù sau restart.', {
          channelId: message.channelId,
          messageId: message.id,
        });
        return true;
      }
      await handleCommand(message, command);
      return true;
    }

    let state = stateStore.getChannel(config.guildId, message.channelId);
    if (
      !isAllowed(message.author.id)
      || !state?.enabled
      || (!String(message.content || '').trim() && message.attachments.size === 0)
    ) {
      return true;
    }

    // Tự đồng bộ model theo profile vừa kích hoạt trong Claude Profile Switcher.
    const syncResult = await syncModelFromApp(message.channelId);
    if (syncResult.changed) {
      state = syncResult.current;
    }

    if (jobStore.getJob(message.id)) {
      return true;
    }

    const sessionArgs = {
      guildId: message.guildId,
      channelId: message.channelId,
      sessionGeneration: state.sessionGeneration,
      modelProfile: state.modelProfile,
    };
    const backendModel = state.customModel || config.openclawBackendModels[state.modelProfile];
    const job = await supervisor.createJob({
      id: message.id,
      guildId: message.guildId,
      channelId: message.channelId,
      userId: message.author.id,
      requestMessageId: message.id,
      sessionGeneration: state.sessionGeneration,
      backendModel,
      rootSessionKey: openclaw.sessionKey(sessionArgs),
    }, { watch: false });
    sourceMessages.set(job.id, message);
    scheduleStatusUpdate(job, { immediate: true });

    void requestQueue.enqueue(
      (signal) => processOpenClawMessage(message, state, job.id, signal),
      {
        jobId: job.id,
        channelId: message.channelId,
        sessionKey: job.rootSessionKey,
      },
    ).catch(async (error) => {
      if (error instanceof QueueStoppedError) {
        const latestJob = jobStore.getJob(job.id);
        if (latestJob && !TERMINAL_JOB_STATUSES.has(latestJob.status)) {
          await jobStore.updateJob(job.id, {
            status: 'stopped',
            terminalReason: 'Đã dừng khi đang chờ hoặc đang chạy trong queue.',
          });
          scheduleStatusUpdate(jobStore.getJob(job.id));
        }
        return;
      }
      logger.error('Không xử lý được tin nhắn Discord.', {
        name: error.name,
        code: error.code,
        status: error.status,
        messageId: message.id,
        jobId: job.id,
      });
      await sendChunks(message, publicErrorMessage(error)).catch(() => {});
    });
    return true;
  } catch (error) {
    logger.error('Lỗi khi xử lý sự kiện messageCreate.', {
      name: error.name,
      messageId: message.id,
    });
    await sendChunks(message, publicErrorMessage(error)).catch(() => {});
    return false;
  }
}

function rememberHandledMessage(messageId) {
  handledMessageIds.add(messageId);
  if (handledMessageIds.size > 2000) {
    handledMessageIds.delete(handledMessageIds.values().next().value);
  }
}

async function dispatchDiscordMessage(message, options = {}) {
  if (handledMessageIds.has(message.id)) {
    return true;
  }
  if (messageDispatches.has(message.id)) {
    return messageDispatches.get(message.id);
  }

  const dispatch = (async () => {
    const handled = await handleDiscordMessage(message, options);
    if (!handled) {
      return false;
    }
    if (message.guildId === config.guildId) {
      await messageCursorStore.advance(message.channelId, message.id);
    }
    rememberHandledMessage(message.id);
    return true;
  })().catch((error) => {
    logger.error('Không thể cập nhật cursor tin nhắn Discord.', {
      name: error.name,
      channelId: message.channelId,
      messageId: message.id,
    });
    return false;
  }).finally(() => {
    messageDispatches.delete(message.id);
  });
  messageDispatches.set(message.id, dispatch);
  return dispatch;
}

client.on('messageCreate', (message) => {
  if (
    !message.guild
    || message.guildId !== config.guildId
    || message.author.bot
    || message.webhookId
  ) {
    return;
  }
  if (!acceptingGatewayMessages) {
    bufferedGatewayMessages.push(message);
    return;
  }
  void dispatchDiscordMessage(message);
});

client.on('interactionCreate', async (interaction) => {
  // Select menu 3 cấp: nhóm → (profile) → model; nút: hủy, quay lại, lật trang.
  const isModelGroup = interaction.isStringSelectMenu() && interaction.customId === 'oc-model-group';
  const isModelProfile = interaction.isStringSelectMenu() && interaction.customId === 'oc-model-profile';
  const isModelPick = interaction.isStringSelectMenu() && interaction.customId === 'oc-model-pick';
  const isModelCancel = interaction.isButton() && interaction.customId === 'oc-model-pick-cancel';
  const isModelBack = interaction.isButton() && interaction.customId === 'oc-model-back';
  const isModelPrev = interaction.isButton() && interaction.customId === 'oc-model-page-prev';
  const isModelNext = interaction.isButton() && interaction.customId === 'oc-model-page-next';
  const isModelNavigation = isModelBack || isModelPrev || isModelNext;
  if (!isModelGroup && !isModelProfile && !isModelPick && !isModelCancel && !isModelNavigation) {
    return;
  }
  if (!interaction.inGuild() || interaction.guildId !== config.guildId) {
    return;
  }
  if (!isAllowed(interaction.user.id)) {
    await interaction.reply({
      content: 'Bạn không được phép thay đổi model của kênh này.',
      ephemeral: true,
    }).catch(() => {});
    return;
  }

  const channelId = interaction.channelId;
  const channelState = stateStore.getChannel(config.guildId, channelId);
  if (!channelState?.enabled) {
    await interaction.reply({
      content: 'Kênh này chưa bật OpenClaw, không thể chọn model.',
      ephemeral: true,
    }).catch(() => {});
    return;
  }

  try {
    const baseEmbed = interaction.message.embeds[0]
      ? EmbedBuilder.from(interaction.message.embeds[0])
      : new EmbedBuilder().setColor(0x5865F2).setTitle('🎛️ BẢNG CHỌN MODEL');

    // Trạng thái điều hướng của bảng chọn này; bot restart → quay về cấp 1.
    // baseDescription giữ mô tả gốc khi mở bảng chọn để nút "Quay lại" khôi
    // phục đúng mô tả ban đầu.
    const nav = modelPickNav.get(interaction.message.id)
      || { level: 1, group: null, profileKey: null, page: 0 };

    // Cập nhật bảng chọn tại chỗ theo trạng thái điều hướng mới.
    async function renderPicker(nextNav) {
      const mergedNav = {
        ...nextNav,
        baseDescription: nextNav.baseDescription ?? nav.baseDescription,
      };
      const view = buildPickerView(mergedNav, channelState);
      if (!view || view.options.length === 0) {
        await interaction.update({
          embeds: [baseEmbed.setDescription('Không có lựa chọn khả dụng cho mục này.')],
          components: [],
        });
        return null;
      }
      const picker = paginateOptions(view.options, mergedNav.page);
      const description = view.heading
        ? `${view.heading}\nModel hiện tại: **${describeChannelModel(channelState)}**`
        : (mergedNav.baseDescription || undefined);
      modelPickNav.set(interaction.message.id, { ...mergedNav, page: picker.page });
      await interaction.update({
        embeds: [baseEmbed
          .setDescription(description)
          .setFooter({ text: modelPickerFooterText(view.footer, picker) })],
        components: buildModelPickerComponents(mergedNav, picker),
      });
      return picker;
    }

    if (isModelCancel) {
      modelPickNav.delete(interaction.message.id);
      await interaction.update({
        embeds: [baseEmbed.setDescription('Đã hủy chọn model.')],
        components: [],
      });
      return;
    }

    // Nút điều hướng: quay lại cấp trước hoặc lật trang của cấp đang xem.
    if (isModelNavigation) {
      let nextNav = null;
      if (isModelBack) {
        if (nav.level === 3) {
          nextNav = { level: 2, group: GROUP_APP_PROFILES, profileKey: null, page: 0 };
        } else if (nav.level === 2) {
          nextNav = { level: 1, group: null, profileKey: null, page: 0 };
        }
      } else {
        nextNav = {
          ...nav,
          page: nav.page + (isModelNext ? 1 : -1),
        };
      }
      if (nextNav) {
        const picker = await renderPicker(nextNav);
        if (picker) {
          logger.info('Đã điều hướng bảng chọn model.', {
            channelId,
            level: nextNav.level,
            group: nextNav.group,
            page: picker.page,
            pageCount: picker.pageCount,
            userId: interaction.user.id,
          });
        }
      }
      return;
    }

    const value = String(interaction.values?.[0] || '');

    // Cấp 1: chọn nhóm → cấp 2 (profile app với nhóm Claude, model với nhóm cứng).
    if (isModelGroup && value.startsWith('group:')) {
      const picker = await renderPicker({
        level: 2,
        group: value.slice('group:'.length),
        profileKey: null,
        page: 0,
      });
      if (picker) {
        logger.info('Đã chọn nhóm model.', {
          channelId,
          group: value.slice('group:'.length),
          userId: interaction.user.id,
        });
      }
      return;
    }

    // Cấp 2 (nhóm Claude): chọn profile app → cấp 3 (model của profile).
    if (isModelProfile && value.startsWith('profile:')) {
      const picker = await renderPicker({
        level: 3,
        group: GROUP_APP_PROFILES,
        profileKey: value.slice('profile:'.length),
        page: 0,
      });
      if (picker) {
        logger.info('Đã chọn profile app để xem model.', {
          channelId,
          profileKey: value.slice('profile:'.length),
          userId: interaction.user.id,
        });
      }
      return;
    }

    // Cấp cuối: chọn model → chuyển model cho toàn bộ session và đóng bảng chọn.
    if (isModelPick && value.startsWith('model:')) {
      const modelId = value.slice('model:'.length);
      const channelIds = await applyModelToAllChannels({ customModel: modelId });
      const appProfile = appProfilesCached().find(
        (profile) => String(modelId).startsWith(`${profile.providerName}/`),
      );
      const hardGroup = hardcodedGroups().find(
        (group) => String(modelId).startsWith(`${group.name}/`)
          || String(modelId).startsWith(`${String(group.model).split('/')[0]}/`),
      );
      const summary = appProfile
        ? `Profile app **${appProfile.name}** (\`${modelId}\`)`
        : hardGroup
          ? `Nhóm **${hardGroup.name}** (\`${modelId}\`)`
          : `Model **${modelId}**`;
      modelPickNav.delete(interaction.message.id);

      await interaction.update({
        embeds: [baseEmbed.setDescription(
          `✅ Đã chuyển model của **${channelIds.length}** session đang bật sang ${summary}.\nJob đang chạy vẫn dùng model cũ; lựa chọn mới áp dụng từ yêu cầu tiếp theo.`,
        )],
        components: [],
      });
      logger.info('Đã chọn model qua bảng chọn Discord.', {
        channelId,
        value,
        userId: interaction.user.id,
      });
      return;
    }

    throw new Error('Lựa chọn model không hợp lệ.');
  } catch (error) {
    logger.error('Không thể chọn model qua bảng chọn.', {
      name: error.name,
      message: error.message,
    });
    await interaction.reply({
      content: `Không thể chuyển model: ${publicErrorMessage(error)}`,
      ephemeral: true,
    }).catch(() => {});
  }
});

function latestKnownRequestMessageId(channelId) {
  return jobStore.listJobs({ channelId })
    .map((job) => job.requestMessageId)
    .filter((messageId) => /^\d{17,20}$/.test(String(messageId || '')))
    .sort(compareSnowflakes)
    .at(-1) || null;
}

async function initializeMessageCursor(channel) {
  const knownRequestId = latestKnownRequestMessageId(channel.id);
  if (knownRequestId) {
    await messageCursorStore.advance(channel.id, knownRequestId);
    return knownRequestId;
  }

  let latestMessageId = channel.lastMessageId;
  if (!latestMessageId) {
    const latest = await channel.messages.fetch({ limit: 1, cache: false });
    latestMessageId = latest.first()?.id || null;
  }
  if (latestMessageId) {
    await messageCursorStore.advance(channel.id, latestMessageId);
  }
  return null;
}

async function recoverMissedChannelMessages(channelState) {
  const channel = await resolveDiscordChannel(channelState.channelId);
  if (!channel.isTextBased() || !channel.messages) {
    return;
  }

  let afterMessageId = messageCursorStore.getChannel(channel.id)?.lastMessageId || null;
  if (!afterMessageId) {
    afterMessageId = await initializeMessageCursor(channel);
    if (!afterMessageId) {
      return;
    }
  }

  let recoveredJobs = 0;
  while (true) {
    const messages = await channel.messages.fetch({
      after: afterMessageId,
      limit: 100,
      cache: false,
    });
    const ordered = [...messages.values()]
      .sort((left, right) => compareSnowflakes(left.id, right.id));
    if (ordered.length === 0) {
      break;
    }

    for (const message of ordered) {
      const existed = Boolean(jobStore.getJob(message.id));
      const handled = await dispatchDiscordMessage(message, { recovered: true });
      if (!handled) {
        logger.warn('Dừng quét bù để không bỏ qua tin nhắn Discord chưa xử lý được.', {
          channelId: channel.id,
          messageId: message.id,
        });
        return;
      }
      if (!existed && jobStore.getJob(message.id)) {
        recoveredJobs += 1;
      }
      afterMessageId = message.id;
    }
    if (ordered.length < 100) {
      break;
    }
  }

  if (recoveredJobs > 0) {
    logger.info('Đã xếp lại chat Discord bị lỡ trong lúc bot offline.', {
      channelId: channel.id,
      recoveredJobs,
    });
  }
}

async function recoverMissedMessages() {
  for (const channelState of stateStore.getActiveChannels(config.guildId)) {
    await recoverMissedChannelMessages(channelState).catch((error) => {
      logger.warn('Không thể quét bù chat Discord sau restart.', {
        name: error.name,
        channelId: channelState.channelId,
      });
    });
  }
}

async function drainBufferedGatewayMessages() {
  while (bufferedGatewayMessages.length > 0) {
    const messages = bufferedGatewayMessages.splice(0)
      .sort((left, right) => compareSnowflakes(left.id, right.id));
    for (const message of messages) {
      await dispatchDiscordMessage(message);
    }
  }
  acceptingGatewayMessages = true;
}

async function enqueueRecoveredJobs() {
  const unsentFailedJobs = jobStore.listJobs().filter((job) => (
    job.status === 'failed'
    && !job.responseSent
    && job.requestFingerprint
  ));
  for (const job of unsentFailedJobs) {
    await recoverUnsentResponse(job).catch((error) => {
      logger.warn('Không thể dò phản hồi của job thất bại chưa gửi trong transcript.', {
        jobId: job.id,
        name: error.name,
      });
    });
  }

  const jobs = jobStore.listJobs({ activeOnly: true })
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (const job of jobs) {
    let task;
    if (job.status === 'queued') {
      try {
        const channel = await resolveDiscordChannel(job.channelId);
        const message = await channel.messages.fetch(job.requestMessageId);
        const state = stateStore.getChannel(config.guildId, job.channelId);
        if (
          !state?.enabled
          || state.sessionGeneration !== job.sessionGeneration
          || !isAllowed(message.author.id)
        ) {
          throw new Error('Kênh hoặc session của yêu cầu xếp hàng không còn hợp lệ.');
        }
        task = (signal) => processOpenClawMessage(message, state, job.id, signal);
      } catch (error) {
        await jobStore.updateJob(job.id, {
          status: 'completed_with_blocker',
          terminalReason: 'Không thể nạp lại tin nhắn Discord gốc của job đang chờ; không gửi lại prompt mù quáng.',
        });
        scheduleStatusUpdate(jobStore.getJob(job.id), { immediate: true });
        logger.warn('Không thể khôi phục job đang chờ từ Discord.', {
          jobId: job.id,
          name: error.name,
        });
        continue;
      }
    } else {
      await recoverUnsentResponse(job).catch((error) => {
        logger.warn('Không thể dò phản hồi OpenClaw chưa gửi trong transcript.', {
          jobId: job.id,
          name: error.name,
        });
      });
      task = (signal) => supervisor.recoverJob(job.id, signal);
    }
    void requestQueue.enqueue(
      task,
      {
        jobId: job.id,
        channelId: job.channelId,
        sessionKey: job.rootSessionKey,
        recovery: true,
      },
    ).catch((error) => {
      logger.error('Không tự khôi phục được job OpenClaw.', {
        jobId: job.id,
        name: error.name,
      });
    });
  }
}

client.once('ready', async () => {
  if (client.user.id !== config.applicationId) {
    logger.error('Discord token không khớp DISCORD_APPLICATION_ID.', {
      actualApplicationId: client.user.id,
      configuredApplicationId: config.applicationId,
    });
    await client.destroy();
    process.exitCode = 1;
    return;
  }

  const health = await openclaw.health();
  logger.info('Bot Discord đã đăng nhập.', {
    username: client.user.username,
    applicationId: client.user.id,
    openclawReady: health.ok,
    openclawStatus: health.status,
  });
  client.user.setPresence({ activities: [{ name: `${config.prefix} openclaw` }] });
  // Đăng ký provider cho mọi profile của Claude Profile Switcher ngay khi bot lên,
  // để bảng chọn model và auto-sync dùng được từ yêu cầu đầu tiên.
  const providerSync = await ensureAppProfileProviders({ force: true, openclawClient: openclaw });
  logger.info('Đã quét profile Claude Profile Switcher.', {
    profiles: providerSync.profiles.map((profile) => profile.name),
    changed: Boolean(providerSync.changed),
  });
  await enqueueRecoveredJobs();
  await recoverMissedMessages();
  await drainBufferedGatewayMessages();
  statusHeartbeat = startStatusHeartbeat({
    intervalMs: config.jobHeartbeatMs,
    listActiveJobs: () => jobStore.listJobs({ activeOnly: true }),
    refreshJob: async (job) => {
      if (statusUpdateTimers.has(job.id) || statusUpdatePromises.has(job.id)) {
        return;
      }
      await ensureStatusMessage(jobStore.getJob(job.id));
    },
    onError: (error) => logger.warn('Heartbeat status Discord gặp lỗi.', {
      name: error.name,
    }),
  });
});

client.on('error', (error) => {
  logger.error('Discord client phát sinh lỗi.', { name: error.name });
});

async function shutdown(signalName) {
  logger.info('Đang dừng bot Discord.', { signal: signalName });
  requestQueue.stop();
  statusHeartbeat?.stop();
  for (const timer of statusUpdateTimers.values()) {
    clearTimeout(timer);
  }
  for (const timer of sessionActivityUpdateTimers.values()) {
    clearTimeout(timer);
  }
  client.destroy();
  await supervisor?.close();
  await openclaw.close();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (error) => {
  logger.error('Unhandled rejection.', { name: error?.name });
});

// Tự sửa thư mục/file bị lỗi mã hóa ký tự (mojibake — "HĂ¬nh áº¢nh" thay vì
// "Hình Ảnh") do pipeline PowerShell đọc chuỗi UTF-8 bằng ANSI. Quét ổ chứa
// media ở cấp 1 + đệ quy trong cây media; chỉ gộp/đổi tên khi chắc chắn.
async function runMediaMojibakeFix() {
  const scanRoots = [];
  const seen = new Set();
  for (const root of OPENCLAW_MEDIA_ROOTS) {
    const drive = path.parse(root).root;
    if (drive && !seen.has(drive)) {
      seen.add(drive);
      scanRoots.push(drive);
    }
    if (!seen.has(root)) {
      seen.add(root);
      scanRoots.push(root);
    }
  }
  try {
    const report = await fixMediaFolderMojibake({ scanRoots });
    const touched = report.merged.length + report.moved.length + report.renamed.length;
    if (touched > 0 || report.conflicts.length > 0) {
      logger.info('Đã tự sửa thư mục bị lỗi mã hóa ký tự (mojibake).', {
        merged: report.merged.length,
        moved: report.moved.length,
        renamed: report.renamed.length,
        conflicts: report.conflicts.length,
        errors: report.errors.length,
      });
    }
  } catch (error) {
    logger.warn('Không quét được thư mục mojibake.', { name: error.name });
  }
}

async function main() {
  await Promise.all([stateStore.load(), jobStore.load(), messageCursorStore.load()]);
  await cleanupOutbox(
    OPENCLAW_OUTBOX_ROOT,
    config.mediaOutboxRetentionHours * 60 * 60 * 1000,
  ).catch((error) => logger.warn('Không dọn được media outbox cũ.', { name: error.name }));
  await runMediaMojibakeFix();
  // Tự quét định kỳ: skill tạo ảnh có thể ghi nhầm vào thư mục tên lỗi ký tự
  // (vd "HĂ¬nh áº¢nh" thay vì "Hình Ảnh") giữa lúc bot chạy — dọn dẹp sau.
  const mojibakeTimer = setInterval(() => void runMediaMojibakeFix(), 15 * 60 * 1000);
  mojibakeTimer.unref?.();
  await client.login(config.discordToken);
}

main().catch((error) => {
  const stateError = error instanceof StateStoreError
    || error instanceof JobStoreError
    || error instanceof MessageCursorStoreError;
  logger.error(stateError ? error.message : 'Không thể khởi động bot.', {
    name: error.name,
  });
  process.exitCode = 1;
});

'use strict';

const os = require('node:os');
const path = require('node:path');
const dotenv = require('dotenv');
const {
  AttachmentBuilder,
  ChannelType,
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
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
const { OpenClawClient, OpenClawError } = require('./openclaw-client');
const { OpenClawTaskClient } = require('./openclaw-task-client');
const { JobSupervisor, TERMINAL_JOB_STATUSES, artifactCounts } = require('./job-supervisor');
const { RequestDeadline } = require('./request-deadline');
const { ResponseDeliveryGate } = require('./response-delivery-gate');
const { splitDiscordText } = require('./message-utils');
const {
  buildJobStatusEmbed,
  buildOpenClawStatusEmbed,
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
} = require('./response-media');
const { startStatusHeartbeat, statusUpdateDelay } = require('./status-heartbeat');
const { collectSystemMetrics } = require('./system-metrics');
const {
  shouldMoveStatusToBottom,
} = require('./discord-ordering');

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
const taskClient = new OpenClawTaskClient({ listCacheMs: config.jobPollMs });
const audioTranscriber = new AudioTranscriber({ timeoutMs: config.requestIdleTimeoutMs });
const requestQueue = new SessionRequestQueue(
  config.maxPending,
  config.maxConcurrentSessions,
);
const sourceMessages = new Map();
const statusUpdateTimers = new Map();
const statusUpdatePromises = new Map();
const statusUpdatedAt = new Map();
const sessionActivityUpdateTimers = new Map();
const sessionActivityUpdatePromises = new Map();
const activityDeliveryChains = new Map();
const responseDeliveryPromises = new Map();
const streamPreviews = new Map();
const messageDispatches = new Map();
const handledMessageIds = new Set();
const bufferedGatewayMessages = [];
let acceptingGatewayMessages = false;
let statusHeartbeat = null;
let supervisor;

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

async function sendJobResponse(job, text) {
  const chunks = splitDiscordText(text);
  const source = sourceMessages.get(job.id);
  const channel = source?.channel || await resolveDiscordChannel(job.channelId);
  if (source) {
    try {
      await source.reply(discordMessageOptions(chunks[0]));
    } catch {
      await channel.send(discordMessageOptions(chunks[0]));
    }
  } else {
    await channel.send(discordMessageOptions(chunks[0]));
  }
  for (const chunk of chunks.slice(1)) {
    await channel.send(discordMessageOptions(chunk));
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
    );
  }
  return [];
}

function sessionActivityUpdateKey(jobId, sessionKey) {
  return `${jobId}\u0000${sessionKey}`;
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
  const channel = await resolveDiscordChannel(current.channelId);

  if (activity.messageId) {
    let lastError;
    for (const waitMs of [0, 1000, 5000]) {
      if (waitMs) {
        await retryDelay(waitMs);
      }
      try {
        const message = await channel.messages.fetch(activity.messageId);
        await message.edit(discordEmbedOptions(embed, { clearContent: true }));
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
  const channel = await resolveDiscordChannel(current.channelId);
  if (current.statusMessageId) {
    try {
      const statusMessage = await channel.messages.fetch(current.statusMessageId);
      let lastMessageIsBot = false;
      if (channel.lastMessageId && channel.lastMessageId !== statusMessage.id) {
        try {
          const lastMessage = await channel.messages.fetch(channel.lastMessageId);
          lastMessageIsBot = lastMessage.author.id === client.user.id;
        } catch {
          // Giữ hành vi cũ nếu không xác định được tác giả tin cuối kênh.
        }
      }
      const shouldMoveToBottom = shouldMoveStatusToBottom({
        job: current,
        statusMessageId: statusMessage.id,
        lastMessageId: channel.lastMessageId,
        lastMessageIsBot,
      });
      if (shouldMoveToBottom) {
        const source = sourceMessages.get(current.id);
        let replacement;
        if (source) {
          try {
            replacement = await source.reply(discordEmbedOptions(embed));
          } catch {
            replacement = await channel.send(discordEmbedOptions(embed));
          }
        } else {
          replacement = await channel.send(discordEmbedOptions(embed));
        }
        await jobStore.updateJob(current.id, { statusMessageId: replacement.id });
        await statusMessage.delete().catch((error) => {
          logger.warn('Không xóa được status message cũ sau khi đưa tiến độ xuống cuối kênh.', {
            jobId: current.id,
            name: error.name,
          });
        });
        statusUpdatedAt.set(current.id, Date.now());
        return replacement;
      }
      await statusMessage.edit(discordEmbedOptions(embed, { clearContent: true }));
      statusUpdatedAt.set(current.id, Date.now());
      return statusMessage;
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
      statusMessage = await source.reply(discordEmbedOptions(embed));
    } catch {
      statusMessage = await channel.send(discordEmbedOptions(embed));
    }
  } else {
    statusMessage = await channel.send(discordEmbedOptions(embed));
  }
  await jobStore.updateJob(current.id, { statusMessageId: statusMessage.id });
  statusUpdatedAt.set(current.id, Date.now());
  return statusMessage;
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
  logger,
  onJobChanged: async (job) => {
    scheduleStatusUpdate(job);
    scheduleSessionActivityUpdates(job);
  },
  sendActivity: sendActivityToDiscord,
  sendArtifact: sendArtifactToDiscord,
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

async function sendOpenClawResponse(jobId, responseText) {
  if (jobStore.getJob(jobId)?.responseSent) {
    return false;
  }
  if (responseDeliveryPromises.has(jobId)) {
    return responseDeliveryPromises.get(jobId);
  }
  const operation = enqueueDiscordDelivery(jobId, async () => {
    if (jobStore.getJob(jobId)?.responseSent) {
      return false;
    }
    return runOpenClawResponseDelivery(jobId, responseText);
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
      case 'unavailable':
        return 'Không thể kết nối tới OpenClaw cục bộ. Hãy dùng `> openclaw status` để kiểm tra.';
      default:
        return 'OpenClaw không xử lý được yêu cầu này.';
    }
  }
  if (error?.code === 'idle_timeout') {
    return 'OpenClaw không có hoạt động mới trong 30 phút nên bot đã dừng chờ. Durable task còn chạy vẫn tiếp tục được theo dõi.';
  }
  if (error?.code === 'max_runtime') {
    return 'Lượt OpenClaw đã đạt giới hạn an toàn 12 giờ. Hãy dùng `> openclaw resume` để khôi phục từ checkpoint.';
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

  const current = stateStore.getChannel(config.guildId, message.channel.id);
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
    const lines = [
      `Đã bật OpenClaw cho <#${message.channel.id}>.`,
      bound.changed
        ? `Phiên riêng của kênh đã sẵn sàng (phiên ${bound.sessionGeneration}).`
        : `Kênh này đang giữ nguyên phiên ${bound.sessionGeneration}.`,
      `Model hiện tại: ${bound.modelProfile} (\`${config.openclawBackendModels[bound.modelProfile]}\`).`,
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
        backendModel: config.openclawBackendModels[current.modelProfile],
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
    const modelProfile = String(command.args?.[0] || '').toLowerCase();
    if (!Object.hasOwn(config.openclawBackendModels, modelProfile)) {
      await sendChunks(message, [
        `Model hiện tại: ${current.modelProfile} (\`${config.openclawBackendModels[current.modelProfile]}\`).`,
        `Dùng \`${config.prefix} openclaw model local\` hoặc \`${config.prefix} openclaw model 9router\`.`,
      ].join('\n'));
      return;
    }
    const selected = await stateStore.setModelProfile(
      config.guildId,
      message.channel.id,
      modelProfile,
    );
    await sendChunks(message, [
      `Đã chuyển model của kênh sang ${selected.modelProfile} (\`${config.openclawBackendModels[selected.modelProfile]}\`).`,
      'Job đang chạy vẫn dùng model cũ; lựa chọn mới áp dụng từ yêu cầu tiếp theo.',
    ].join('\n'));
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
    await sendChunks(message, `Đã yêu cầu dừng ${jobs.length} job và hủy các durable task liên quan.`);
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
    `\`${config.prefix} openclaw model local|9router\` · nhanh: \`${config.prefix} o m local|9router\``,
    `\`${config.prefix} openclaw jobs\``,
    `\`${config.prefix} openclaw resend [job-id] [all|số]\``,
    `\`${config.prefix} openclaw resume [job-id]\``,
    `\`${config.prefix} openclaw stop [job-id|all]\` · nhanh: \`${config.prefix} o stop [job-id|all]\``,
    `\`${config.prefix} openclaw reset\``,
    `\`${config.prefix} openclaw off\``,
  ].join('\n'));
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

  const responseGate = new ResponseDeliveryGate(async (text) => {
    const latest = stateStore.getChannel(config.guildId, message.channelId);
    if (!latest?.enabled || latest.sessionGeneration !== state.sessionGeneration) {
      throw new QueueStoppedError();
    }
    await sendOpenClawResponse(jobId, text);
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
      await responseGate.deliverOnce(transcriptResponse);
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
    responseText = await openclaw.chat({
      guildId: message.guildId,
      channelId: message.channelId,
      sessionGeneration: state.sessionGeneration,
      backendModel: config.openclawBackendModels[state.modelProfile],
      text: requestText,
      imageParts: attachments.imageParts,
      signal: deadline.signal,
      onDelta: handleStreamDelta,
    });
    await responseGate.deliverOnce(responseText);
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
    responseWatcherController?.abort();
    await responseWatcherPromise;
    streamPreviews.delete(jobId);
    stopTyping();
    deadline.stop();
    supervisor.setActivityTouch(jobId, null);
    await supervisor.markForegroundDone(jobId, { error: foregroundError });
  }

  const settled = await supervisor.waitForSettled(jobId);
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

    const state = stateStore.getChannel(config.guildId, message.channelId);
    if (
      !isAllowed(message.author.id)
      || !state?.enabled
      || (!String(message.content || '').trim() && message.attachments.size === 0)
    ) {
      return true;
    }

    if (jobStore.getJob(message.id)) {
      return true;
    }

    const sessionArgs = {
      guildId: message.guildId,
      channelId: message.channelId,
      sessionGeneration: state.sessionGeneration,
    };
    const backendModel = config.openclawBackendModels[state.modelProfile];
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
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (error) => {
  logger.error('Unhandled rejection.', { name: error?.name });
});

async function main() {
  await Promise.all([stateStore.load(), jobStore.load(), messageCursorStore.load()]);
  await cleanupOutbox(
    OPENCLAW_OUTBOX_ROOT,
    config.mediaOutboxRetentionHours * 60 * 60 * 1000,
  ).catch((error) => logger.warn('Không dọn được media outbox cũ.', { name: error.name }));
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

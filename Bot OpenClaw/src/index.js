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
const { splitDiscordText } = require('./message-utils');
const { buildJobStatusEmbed, buildResponseEmbeds } = require('./discord-embeds');
const { createLogger } = require('./logger');
const { cleanupOutbox, extractMediaReferences } = require('./response-media');
const { startStatusHeartbeat } = require('./status-heartbeat');

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
const openclaw = new OpenClawClient(config);
const taskClient = new OpenClawTaskClient();
const audioTranscriber = new AudioTranscriber({ timeoutMs: config.requestIdleTimeoutMs });
const requestQueue = new SessionRequestQueue(
  config.maxPending,
  config.maxConcurrentSessions,
);
const sourceMessages = new Map();
const statusUpdateTimers = new Map();
const statusUpdatePromises = new Map();
const statusUpdatedAt = new Map();
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
  const embeds = buildResponseEmbeds(text, {
    jobId: job.id,
    botName: 'OPENCLAW // ASSISTANT',
    botIconUrl: botIconUrl(),
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

function elapsedLabel(startedAt) {
  const elapsedMs = Math.max(0, Date.now() - Date.parse(startedAt));
  const totalMinutes = Math.floor(elapsedMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
}

async function updateStatusMessage(job) {
  const current = jobStore.getJob(job.id);
  const queue = requestQueue.getDetailedStatus();
  const queueIndex = queue.pendingMetadata.findIndex((item) => item.jobId === current.id);
  const queueItem = queueIndex >= 0 ? queue.pendingMetadata[queueIndex] : null;
  const sessionKey = queueItem?.sessionKey || current.rootSessionKey;
  const sessionPending = queue.pendingMetadata
    .filter((item) => (item.sessionKey || item.channelId) === sessionKey);
  const sessionQueueIndex = sessionPending.findIndex((item) => item.jobId === current.id);
  const embed = buildJobStatusEmbed(current, {
    counts: artifactCounts(current),
    queuePosition: sessionQueueIndex >= 0 ? sessionQueueIndex + 1 : null,
    queuePending: sessionPending.length,
    activeSessions: queue.activeCount,
    maxConcurrentSessions: queue.maxConcurrent,
    prefix: config.prefix,
    botName: 'OPENCLAW // JOB MONITOR',
    botIconUrl: botIconUrl(),
    heartbeatMs: config.jobHeartbeatMs,
  });
  const channel = await resolveDiscordChannel(current.channelId);
  if (current.statusMessageId) {
    try {
      const statusMessage = await channel.messages.fetch(current.statusMessageId);
      if (current.status !== 'queued' && channel.lastMessageId !== statusMessage.id) {
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
  const elapsed = Date.now() - (statusUpdatedAt.get(job.id) || 0);
  const waitMs = immediate ? 100 : Math.max(100, config.jobHeartbeatMs - elapsed);
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
  const label = artifact.label || `Ảnh ${artifact.order}`;
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
  onJobChanged: async (job) => scheduleStatusUpdate(job),
  sendArtifact: sendArtifactToDiscord,
});

async function sendOpenClawResponse(jobId, responseText) {
  const parsed = extractMediaReferences(responseText);
  for (const reference of parsed.references) {
    await supervisor.registerArtifact(jobId, reference, 'Ảnh thành phẩm từ OpenClaw');
  }
  const visibleText = parsed.text || (parsed.references.length
    ? 'OpenClaw đã hoàn tất bước hiện tại; file đang được gửi riêng.'
    : responseText);
  await sendJobResponse(jobStore.getJob(jobId), visibleText);
  await jobStore.updateJob(jobId, { responseSent: true });
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
    const health = await openclaw.health();
    const activeChannels = stateStore.getActiveChannels(config.guildId);
    const queue = requestQueue.getDetailedStatus();
    const activeJobs = jobStore.listJobs({ activeOnly: true });
    const botIsAdmin = message.guild.members.me?.permissions.has(PermissionFlagsBits.Administrator);
    const lines = [
      `Kênh hiện tại: <#${message.channel.id}> (${current?.enabled ? 'đang bật' : 'chưa bật'})`,
      `OpenClaw Gateway: ${health.ok ? 'đang hoạt động' : `không sẵn sàng${health.status ? ` (HTTP ${health.status})` : ''}`}`,
      `Luồng session: ${queue.activeCount}/${queue.maxConcurrent} đang chạy · ${queue.pending} yêu cầu chờ`,
      `Job bền vững đang hoạt động: ${activeJobs.length}`,
      `Phiên kênh: ${current?.sessionGeneration || 0}`,
      `Model kênh: ${current?.enabled ? `${current.modelProfile} (\`${config.openclawBackendModels[current.modelProfile]}\`)` : 'chưa chọn'}`,
      `Các kênh đang bật (${activeChannels.length}): ${activeChannels.length ? activeChannels.map((entry) => `<#${entry.channelId}>`).join(', ') : 'không có'}`,
      `Nguồn file được phép: ${OPENCLAW_MEDIA_ROOTS.length} thư mục · outbox giữ ${config.mediaOutboxRetentionHours} giờ`,
    ];
    for (const job of activeJobs.slice(0, 3)) {
      const counts = artifactCounts(job);
      const latestStep = job.lastEvent ? ` · bước gần nhất: ${job.lastEvent}` : '';
      lines.push(`• \`${job.id}\` <#${job.channelId}>: ${job.status} · ${elapsedLabel(job.createdAt)} · ${counts.delivered}/${counts.total} file${latestStep}`);
    }
    if (botIsAdmin) {
      lines.push('Cảnh báo: bot vẫn đang có quyền Administrator; nên hạ xuống quyền tối thiểu sau khi kiểm tra.');
    }
    await sendChunks(message, lines.join('\n'));
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
    `Lệnh tắt: \`${config.prefix} o\``,
    `\`${config.prefix} openclaw status\``,
    `\`${config.prefix} openclaw model local|9router\` · tắt: \`${config.prefix} o m local|9router\``,
    `\`${config.prefix} openclaw jobs\``,
    `\`${config.prefix} openclaw resend [job-id] [all|số]\``,
    `\`${config.prefix} openclaw resume [job-id]\``,
    `\`${config.prefix} openclaw stop [job-id|all]\` · tắt: \`${config.prefix} o s [job-id|all]\``,
    `\`${config.prefix} openclaw reset\``,
    `\`${config.prefix} openclaw off\``,
  ].join('\n'));
}

async function processOpenClawMessage(message, state, jobId, signal) {
  sourceMessages.set(jobId, message);
  await supervisor.watchJob(jobId, { rootStartAtEnd: true });
  await jobStore.updateJob(jobId, { status: 'running' });
  await ensureStatusMessage(jobStore.getJob(jobId));

  const deadline = new RequestDeadline({
    signal,
    idleTimeoutMs: config.requestIdleTimeoutMs,
    maxRuntimeMs: config.requestMaxRuntimeMs,
  });
  supervisor.setActivityTouch(jobId, () => deadline.touch());
  const typing = () => message.channel.sendTyping().catch(() => {});
  await typing();
  const typingTimer = setInterval(typing, 8000);
  typingTimer.unref?.();
  let responseText = '';
  let foregroundError = null;

  try {
    const attachments = await prepareMessageAttachments(message.attachments.values(), {
      signal: deadline.signal,
      audioTranscriber,
      onAudioStart: () => {
        deadline.touch();
        return supervisor.handleEvent(jobId, {
          text: '▶ `audio.transcribe` — phiên âm file âm thanh',
          mediaReferences: [],
        });
      },
      onAudioComplete: () => {
        deadline.touch();
        return supervisor.handleEvent(jobId, {
          text: '✓ `audio.transcribe` hoàn tất',
          mediaReferences: [],
        });
      },
    });
    responseText = await openclaw.chat({
      guildId: message.guildId,
      channelId: message.channelId,
      sessionGeneration: state.sessionGeneration,
      backendModel: config.openclawBackendModels[state.modelProfile],
      text: appendAudioTranscripts(message.content, attachments.audioTranscripts),
      imageParts: attachments.imageParts,
      signal: deadline.signal,
    });

    const latest = stateStore.getChannel(config.guildId, message.channelId);
    if (!latest?.enabled || latest.sessionGeneration !== state.sessionGeneration) {
      foregroundError = new QueueStoppedError();
    } else {
      await sendOpenClawResponse(jobId, responseText);
    }
  } catch (error) {
    foregroundError = error;
  } finally {
    clearInterval(typingTimer);
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

client.on('messageCreate', async (message) => {
  if (
    !message.guild
    || message.guildId !== config.guildId
    || message.author.bot
    || message.webhookId
  ) {
    return;
  }

  try {
    const command = parseCommand(message.content, config.prefix);
    if (command) {
      await handleCommand(message, command);
      return;
    }

    const state = stateStore.getChannel(config.guildId, message.channelId);
    if (
      !isAllowed(message.author.id)
      || !state?.enabled
      || (!String(message.content || '').trim() && message.attachments.size === 0)
    ) {
      return;
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
  } catch (error) {
    logger.error('Lỗi khi xử lý sự kiện messageCreate.', {
      name: error.name,
      messageId: message.id,
    });
    await sendChunks(message, publicErrorMessage(error)).catch(() => {});
  }
});

async function enqueueRecoveredJobs() {
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
  client.destroy();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (error) => {
  logger.error('Unhandled rejection.', { name: error?.name });
});

async function main() {
  await Promise.all([stateStore.load(), jobStore.load()]);
  await cleanupOutbox(
    OPENCLAW_OUTBOX_ROOT,
    config.mediaOutboxRetentionHours * 60 * 60 * 1000,
  ).catch((error) => logger.warn('Không dọn được media outbox cũ.', { name: error.name }));
  await client.login(config.discordToken);
}

main().catch((error) => {
  const stateError = error instanceof StateStoreError || error instanceof JobStoreError;
  logger.error(stateError ? error.message : 'Không thể khởi động bot.', {
    name: error.name,
  });
  process.exitCode = 1;
});

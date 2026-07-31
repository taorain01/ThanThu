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
const {
  QueueFullError,
  QueueStoppedError,
  SerialRequestQueue,
} = require('./request-queue');
const {
  AttachmentError,
  appendAudioTranscripts,
  prepareMessageAttachments,
} = require('./image-payload');
const { AudioTranscriber, AudioTranscriptionError } = require('./audio-transcriber');
const { OpenClawClient, OpenClawError } = require('./openclaw-client');
const { splitDiscordText } = require('./message-utils');
const { createLogger } = require('./logger');
const { extractMediaReferences, resolveMediaReferences } = require('./response-media');
const {
  OpenClawSessionMonitor,
  formatFinishedActivity,
  formatLiveActivity,
} = require('./session-activity');

const BOT_ROOT = path.resolve(__dirname, '..');
const OPENCLAW_HOME = path.join(os.homedir(), '.openclaw');
const OPENCLAW_MEDIA_ROOTS = [
  path.join(OPENCLAW_HOME, 'workspace'),
  path.join(OPENCLAW_HOME, 'media'),
];
dotenv.config({ path: path.join(BOT_ROOT, '.env'), quiet: true });

const config = loadConfig();
const OPENCLAW_SESSIONS_DIR = path.join(
  OPENCLAW_HOME,
  'agents',
  config.openclawAgentId,
  'sessions',
);
const logger = createLogger(path.join(BOT_ROOT, 'logs', 'bot.log'));
const stateStore = new StateStore(path.join(BOT_ROOT, 'data', 'state.json'));
const openclaw = new OpenClawClient(config);
const audioTranscriber = new AudioTranscriber({ timeoutMs: config.requestTimeoutMs });
const queues = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function queueKey(guildId, channelId) {
  return `${guildId}:${channelId}`;
}

function getQueue(guildId, channelId) {
  const key = queueKey(guildId, channelId);
  if (!queues.has(key)) {
    queues.set(key, new SerialRequestQueue(config.maxPending));
  }
  return queues.get(key);
}

function stopQueue(guildId, channelId) {
  if (!channelId) {
    return;
  }
  queues.get(queueKey(guildId, channelId))?.stop();
}

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

async function sendMediaReferences(message, references, sentPaths) {
  const resolved = await resolveMediaReferences(references, {
    openclawHome: OPENCLAW_HOME,
    allowedRoots: OPENCLAW_MEDIA_ROOTS,
  });
  if (resolved.rejectedCount) {
    logger.warn('Bỏ qua media OpenClaw không hợp lệ hoặc vượt giới hạn.', {
      rejectedCount: resolved.rejectedCount,
      messageId: message.id,
    });
  }

  for (const file of resolved.files) {
    const key = process.platform === 'win32' ? file.path.toLowerCase() : file.path;
    if (sentPaths.has(key)) {
      continue;
    }
    try {
      const attachment = new AttachmentBuilder(file.path, {
        name: `openclaw-image-${sentPaths.size + 1}${file.extension}`,
      });
      await message.channel.send(discordMessageOptions('🖼️ Ảnh trong phiên làm việc:', [attachment]));
      sentPaths.add(key);
    } catch (error) {
      logger.warn('Không gửi được ảnh OpenClaw lên Discord.', {
        name: error.name,
        messageId: message.id,
      });
    }
  }
}

function createActivityReporter(message) {
  const startedAt = Date.now();
  const events = [];
  const sentMediaPaths = new Set();
  let statusMessage = null;
  let updateTimer = null;
  let heartbeatTimer = null;
  let finished = false;
  let lastContent = '';
  let updateChain = Promise.resolve();
  let mediaChain = Promise.resolve();

  const enqueueEdit = (content) => {
    if (!statusMessage || content === lastContent) {
      return updateChain;
    }
    lastContent = content;
    updateChain = updateChain
      .then(() => statusMessage.edit(discordMessageOptions(content)))
      .catch((error) => {
        logger.warn('Không cập nhật được tiến độ phiên trên Discord.', {
          name: error.name,
          messageId: message.id,
        });
      });
    return updateChain;
  };

  const updateLive = () => enqueueEdit(formatLiveActivity(events, Date.now() - startedAt));
  const scheduleUpdate = () => {
    if (finished || updateTimer) {
      return;
    }
    updateTimer = setTimeout(() => {
      updateTimer = null;
      void updateLive();
    }, 1200);
    updateTimer.unref?.();
  };

  return {
    sentMediaPaths,
    async start() {
      const content = formatLiveActivity(events, 0);
      lastContent = content;
      try {
        statusMessage = await message.reply(discordMessageOptions(content));
      } catch {
        statusMessage = await message.channel.send(discordMessageOptions(content));
      }
      heartbeatTimer = setInterval(() => void updateLive(), 10000);
      heartbeatTimer.unref?.();
    },
    async add(event) {
      if (finished) {
        return;
      }
      if (event.text) {
        events.push(event.text);
        scheduleUpdate();
      }
      if (event.mediaReferences?.length) {
        mediaChain = mediaChain.then(() => (
          sendMediaReferences(message, event.mediaReferences, sentMediaPaths)
        ));
      }
    },
    async finish(status) {
      if (finished) {
        return;
      }
      finished = true;
      if (updateTimer) {
        clearTimeout(updateTimer);
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      const formatted = formatFinishedActivity(events, Date.now() - startedAt, status);
      await enqueueEdit(formatted.panel);
      await mediaChain;
      if (formatted.overflow) {
        for (const chunk of splitDiscordText(formatted.overflow)) {
          await message.channel.send(discordMessageOptions(chunk));
        }
      }
    },
  };
}

async function sendOpenClawResponse(message, responseText, sentMediaPaths) {
  const parsed = extractMediaReferences(responseText);
  const fallback = parsed.references.length
    ? 'OpenClaw đã hoàn tất; ảnh được gửi trong phiên làm việc.'
    : responseText;
  await sendChunks(message, parsed.text || fallback);
  await sendMediaReferences(message, parsed.references, sentMediaPaths);
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
      case 'timeout':
        return 'OpenClaw xử lý quá thời gian. Bot không tự gửi lại để tránh lặp thao tác trên PC.';
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
  return 'Bot gặp lỗi khi xử lý yêu cầu. Chi tiết đã được ghi vào log cục bộ.';
}

async function handleCommand(message, command) {
  if (!isAllowed(message.author.id)) {
    await sendChunks(message, 'Bạn không có quyền sử dụng OpenClaw trên bot này.');
    return;
  }

  const current = stateStore.getChannel(config.guildId, message.channel.id);
  if (command.action === 'bind') {
    if (message.channel.type !== ChannelType.GuildText) {
      await sendChunks(message, 'V1 chỉ cho phép chọn một text channel thông thường trong server.');
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
    const queueStatus = current?.enabled
      ? getQueue(config.guildId, message.channel.id).getStatus()
      : { active: false, pending: 0 };
    const botIsAdmin = message.guild.members.me?.permissions.has(PermissionFlagsBits.Administrator);
    const lines = [
      `Kênh hiện tại: <#${message.channel.id}> (${current?.enabled ? 'đang bật' : 'chưa bật'})`,
      `OpenClaw Gateway: ${health.ok ? 'đang hoạt động' : `không sẵn sàng${health.status ? ` (HTTP ${health.status})` : ''}`}`,
      `Yêu cầu đang chạy: ${queueStatus.active ? 'có' : 'không'}`,
      `Yêu cầu đang chờ: ${queueStatus.pending}`,
      `Phiên: ${current?.sessionGeneration || 0}`,
      `Các kênh đang bật (${activeChannels.length}): ${activeChannels.length ? activeChannels.map((entry) => `<#${entry.channelId}> (phiên ${entry.sessionGeneration})`).join(', ') : 'không có'}`,
      'Nhật ký phiên: bật (đã lọc dữ liệu nhạy cảm)',
      'Prompt đính kèm: ảnh và audio đang bật',
      'Gửi ảnh kết quả: bật (workspace/media, tối đa 8 MB mỗi ảnh)',
    ];
    if (botIsAdmin) {
      lines.push('Cảnh báo: bot vẫn đang có quyền Administrator; nên hạ xuống quyền tối thiểu sau khi kiểm tra.');
    }
    await sendChunks(message, lines.join('\n'));
    return;
  }

  if (command.action === 'reset') {
    if (!current?.enabled) {
      await sendChunks(message, 'Kênh hiện tại chưa bật OpenClaw.');
      return;
    }
    stopQueue(config.guildId, message.channel.id);
    const reset = await stateStore.resetSession(config.guildId, message.channel.id);
    await sendChunks(
      message,
      `Đã tạo phiên OpenClaw mới (phiên ${reset.sessionGeneration}). Yêu cầu cũ đã bị ngắt ở phía bot.`,
    );
    return;
  }

  if (command.action === 'stop') {
    if (!current?.enabled) {
      await sendChunks(message, 'Kênh hiện tại chưa bật OpenClaw.');
      return;
    }
    stopQueue(config.guildId, message.channel.id);
    await sendChunks(
      message,
      'Đã ngắt chờ và xóa hàng đợi. Một tool đã bắt đầu phía OpenClaw có thể vẫn hoàn tất.',
    );
    return;
  }

  if (command.action === 'off') {
    if (!current?.enabled) {
      await sendChunks(message, 'Kênh hiện tại chưa bật OpenClaw.');
      return;
    }
    stopQueue(config.guildId, message.channel.id);
    await stateStore.unbind(config.guildId, message.channel.id);
    await sendChunks(message, 'Đã tắt OpenClaw riêng cho kênh hiện tại. Các kênh khác không bị ảnh hưởng.');
    return;
  }

  await sendChunks(
    message,
    [
      `Lệnh hợp lệ: \`${config.prefix} openclaw\``,
      `\`${config.prefix} openclaw status\``,
      `\`${config.prefix} openclaw reset\``,
      `\`${config.prefix} openclaw stop\``,
      `\`${config.prefix} openclaw off\``,
    ].join('\n'),
  );
}

async function processOpenClawMessage(message, state, signal) {
  const typing = () => message.channel.sendTyping().catch(() => {});
  await typing();
  const typingTimer = setInterval(typing, 8000);
  typingTimer.unref?.();
  const activity = createActivityReporter(message);
  const sessionArgs = {
    guildId: message.guildId,
    channelId: message.channelId,
    sessionGeneration: state.sessionGeneration,
  };
  const monitor = new OpenClawSessionMonitor({
    sessionsDir: OPENCLAW_SESSIONS_DIR,
    sessionKey: openclaw.sessionKey(sessionArgs),
    onEvent: (event) => activity.add(event),
  });
  let monitorStopped = false;

  try {
    await activity.start();
    await monitor.start();
    const attachments = await prepareMessageAttachments(message.attachments.values(), {
      signal,
      audioTranscriber,
      onAudioStart: () => activity.add({
        text: '▶ `audio.transcribe` — phiên âm file âm thanh',
        mediaReferences: [],
      }),
      onAudioComplete: () => activity.add({
        text: '✓ `audio.transcribe` hoàn tất',
        mediaReferences: [],
      }),
    });
    const responseText = await openclaw.chat({
      ...sessionArgs,
      text: appendAudioTranscripts(message.content, attachments.audioTranscripts),
      imageParts: attachments.imageParts,
      signal,
    });
    await monitor.stop();
    monitorStopped = true;

    const latest = stateStore.getChannel(config.guildId, message.channelId);
    if (
      !latest?.enabled
      || latest.sessionGeneration !== state.sessionGeneration
    ) {
      logger.warn('Bỏ phản hồi từ phiên OpenClaw đã cũ.', {
        channelId: message.channelId,
        sessionGeneration: state.sessionGeneration,
      });
      await activity.finish('stopped');
      return;
    }
    await activity.finish('completed');
    await sendOpenClawResponse(message, responseText, activity.sentMediaPaths);
  } catch (error) {
    if (!monitorStopped) {
      await monitor.stop();
      monitorStopped = true;
    }
    await activity.finish(signal.aborted ? 'stopped' : 'failed');
    throw error;
  } finally {
    clearInterval(typingTimer);
    if (!monitorStopped) {
      await monitor.stop();
    }
  }
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

    const queue = getQueue(config.guildId, message.channelId);
    void queue
      .enqueue((signal) => processOpenClawMessage(message, state, signal))
      .catch(async (error) => {
        if (error instanceof QueueStoppedError) {
          return;
        }
        logger.error('Không xử lý được tin nhắn Discord.', {
          name: error.name,
          code: error.code,
          status: error.status,
          messageId: message.id,
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
});

client.on('error', (error) => {
  logger.error('Discord client phát sinh lỗi.', { name: error.name });
});

async function shutdown(signalName) {
  logger.info('Đang dừng bot Discord.', { signal: signalName });
  for (const queue of queues.values()) {
    queue.stop();
  }
  client.destroy();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (error) => {
  logger.error('Unhandled rejection.', { name: error?.name });
});

async function main() {
  await stateStore.load();
  await client.login(config.discordToken);
}

main().catch((error) => {
  const stateError = error instanceof StateStoreError;
  logger.error(stateError ? error.message : 'Không thể khởi động bot.', {
    name: error.name,
  });
  process.exitCode = 1;
});

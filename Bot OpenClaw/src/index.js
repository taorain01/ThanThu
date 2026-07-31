'use strict';

const path = require('node:path');
const dotenv = require('dotenv');
const {
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
const { AttachmentError, prepareImageParts } = require('./image-payload');
const { OpenClawClient, OpenClawError } = require('./openclaw-client');
const { splitDiscordText } = require('./message-utils');
const { createLogger } = require('./logger');

const BOT_ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(BOT_ROOT, '.env'), quiet: true });

const config = loadConfig();
const logger = createLogger(path.join(BOT_ROOT, 'logs', 'bot.log'));
const stateStore = new StateStore(path.join(BOT_ROOT, 'data', 'state.json'));
const openclaw = new OpenClawClient(config);
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

async function sendChunks(message, text) {
  const chunks = splitDiscordText(text);
  const messageOptions = (content) => ({
    content,
    allowedMentions: { parse: [], repliedUser: false },
  });

  try {
    await message.reply(messageOptions(chunks[0]));
  } catch {
    await message.channel.send(messageOptions(chunks[0]));
  }
  for (const chunk of chunks.slice(1)) {
    await message.channel.send(messageOptions(chunk));
  }
}

function publicErrorMessage(error) {
  if (error instanceof AttachmentError || error instanceof QueueFullError) {
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

  const current = stateStore.getGuild(config.guildId);
  if (command.action === 'bind') {
    if (message.channel.type !== ChannelType.GuildText) {
      await sendChunks(message, 'V1 chỉ cho phép chọn một text channel thông thường trong server.');
      return;
    }

    if (current?.channelId && current.channelId !== message.channel.id) {
      stopQueue(config.guildId, current.channelId);
    }
    const bound = await stateStore.bindChannel(config.guildId, message.channel.id);
    const everyoneCanView = message.channel
      .permissionsFor(message.guild.roles.everyone)
      ?.has(PermissionFlagsBits.ViewChannel);
    const lines = [
      `Đã chọn <#${message.channel.id}> làm kênh OpenClaw.`,
      bound.changed ? 'Một phiên hội thoại mới đã được tạo.' : 'Kênh này đã được chọn từ trước.',
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
    const queueStatus = current?.channelId
      ? getQueue(config.guildId, current.channelId).getStatus()
      : { active: false, pending: 0 };
    const botIsAdmin = message.guild.members.me?.permissions.has(PermissionFlagsBits.Administrator);
    const lines = [
      `Kênh: ${current?.channelId ? `<#${current.channelId}>` : 'chưa chọn'}`,
      `OpenClaw Gateway: ${health.ok ? 'đang hoạt động' : `không sẵn sàng${health.status ? ` (HTTP ${health.status})` : ''}`}`,
      `Yêu cầu đang chạy: ${queueStatus.active ? 'có' : 'không'}`,
      `Yêu cầu đang chờ: ${queueStatus.pending}`,
      `Phiên: ${current?.sessionGeneration || 0}`,
    ];
    if (botIsAdmin) {
      lines.push('Cảnh báo: bot vẫn đang có quyền Administrator; nên hạ xuống quyền tối thiểu sau khi kiểm tra.');
    }
    await sendChunks(message, lines.join('\n'));
    return;
  }

  if (command.action === 'reset') {
    if (!current?.channelId) {
      await sendChunks(message, 'Server chưa chọn kênh OpenClaw.');
      return;
    }
    stopQueue(config.guildId, current.channelId);
    const reset = await stateStore.resetSession(config.guildId);
    await sendChunks(
      message,
      `Đã tạo phiên OpenClaw mới (phiên ${reset.sessionGeneration}). Yêu cầu cũ đã bị ngắt ở phía bot.`,
    );
    return;
  }

  if (command.action === 'stop') {
    if (!current?.channelId) {
      await sendChunks(message, 'Server chưa chọn kênh OpenClaw.');
      return;
    }
    stopQueue(config.guildId, current.channelId);
    await sendChunks(
      message,
      'Đã ngắt chờ và xóa hàng đợi. Một tool đã bắt đầu phía OpenClaw có thể vẫn hoàn tất.',
    );
    return;
  }

  if (command.action === 'off') {
    stopQueue(config.guildId, current?.channelId);
    await stateStore.unbind(config.guildId);
    await sendChunks(message, 'Đã tắt tương tác OpenClaw và bỏ chọn kênh.');
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

  try {
    const imageParts = await prepareImageParts(message.attachments.values(), { signal });
    const responseText = await openclaw.chat({
      guildId: message.guildId,
      channelId: message.channelId,
      sessionGeneration: state.sessionGeneration,
      text: message.content,
      imageParts,
      signal,
    });

    const latest = stateStore.getGuild(config.guildId);
    if (
      latest?.channelId !== message.channelId
      || latest.sessionGeneration !== state.sessionGeneration
    ) {
      logger.warn('Bỏ phản hồi từ phiên OpenClaw đã cũ.', {
        channelId: message.channelId,
        sessionGeneration: state.sessionGeneration,
      });
      return;
    }
    await sendChunks(message, responseText);
  } finally {
    clearInterval(typingTimer);
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

    const state = stateStore.getGuild(config.guildId);
    if (
      !isAllowed(message.author.id)
      || !state?.channelId
      || state.channelId !== message.channelId
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

'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { ChannelType, Routes } = require('discord.js');

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_FILES = 10;
const ALLOWED_EXTENSIONS = new Set([
  '.gif',
  '.jpeg',
  '.jpg',
  '.json',
  '.m4a',
  '.md',
  '.mov',
  '.mp3',
  '.mp4',
  '.ogg',
  '.pdf',
  '.png',
  '.txt',
  '.wav',
  '.webm',
  '.webp',
  '.zip',
]);
const SENDABLE_CHANNEL_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.AnnouncementThread,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
]);

class DiscordChannelSenderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DiscordChannelSenderError';
    this.code = code;
  }
}

function parseSnowflake(value, name) {
  const normalized = String(value || '').trim();
  if (!/^\d{17,20}$/.test(normalized)) {
    throw new DiscordChannelSenderError('invalid_snowflake', `${name} phải là Discord ID hợp lệ.`);
  }
  return normalized;
}

function normalizeChannelReference(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new DiscordChannelSenderError(
      'missing_channel',
      'Thiếu tên hoặc ID Discord channel đích.',
    );
  }

  const mention = normalized.match(/^<#(\d{17,20})>$/);
  if (mention) {
    return { type: 'id', value: mention[1] };
  }
  if (/^\d{17,20}$/.test(normalized)) {
    return { type: 'id', value: normalized };
  }

  const name = normalized.replace(/^#/, '').trim();
  if (!name || name.length > 100) {
    throw new DiscordChannelSenderError(
      'invalid_channel_name',
      'Tên Discord channel phải dài từ 1 đến 100 ký tự.',
    );
  }
  return { type: 'name', value: name };
}

function normalizeContent(value) {
  const content = String(value || '').trim();
  if (content.length > 2000) {
    throw new DiscordChannelSenderError(
      'content_too_long',
      'Nội dung Discord không được vượt quá 2000 ký tự.',
    );
  }
  return content;
}

function isInsideRoot(filePath, rootPath) {
  const relative = path.relative(rootPath, filePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function canonicalizeRoots(roots) {
  const canonicalRoots = [];
  for (const root of roots || []) {
    if (!path.isAbsolute(root) || path.parse(root).root === path.resolve(root)) {
      continue;
    }
    try {
      canonicalRoots.push(await fs.realpath(root));
    } catch {
      // Thư mục nguồn tùy chọn có thể chưa tồn tại.
    }
  }
  return canonicalRoots;
}

async function resolveDeliveryFiles(filePaths, options = {}) {
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  const maxFiles = options.maxFiles || DEFAULT_MAX_FILES;
  const values = Array.from(filePaths || []).map((value) => String(value || '').trim()).filter(Boolean);
  if (values.length > maxFiles) {
    throw new DiscordChannelSenderError(
      'too_many_files',
      `Chỉ được gửi tối đa ${maxFiles} file trong một tin nhắn.`,
    );
  }

  const roots = await canonicalizeRoots(options.allowedRoots || []);
  if (values.length && roots.length === 0) {
    throw new DiscordChannelSenderError(
      'missing_allowed_roots',
      'Không có thư mục nguồn file hợp lệ để gửi lên Discord.',
    );
  }

  const files = [];
  const seen = new Set();
  let totalBytes = 0;
  for (const value of values) {
    if (!path.isAbsolute(value)) {
      throw new DiscordChannelSenderError('relative_file', 'File gửi Discord phải dùng đường dẫn tuyệt đối.');
    }

    let realPath;
    try {
      realPath = await fs.realpath(value);
    } catch {
      throw new DiscordChannelSenderError('file_not_found', `Không tìm thấy file: ${value}`);
    }
    if (!roots.some((root) => isInsideRoot(realPath, root))) {
      throw new DiscordChannelSenderError(
        'file_outside_allowed_roots',
        `File nằm ngoài thư mục được phép gửi: ${value}`,
      );
    }

    const dedupeKey = process.platform === 'win32' ? realPath.toLowerCase() : realPath;
    if (seen.has(dedupeKey)) {
      continue;
    }

    const extension = path.extname(realPath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      throw new DiscordChannelSenderError(
        'unsupported_file',
        `Định dạng file ${extension || '(không có phần mở rộng)'} chưa được phép gửi.`,
      );
    }

    const stat = await fs.stat(realPath);
    if (!stat.isFile()) {
      throw new DiscordChannelSenderError('not_a_file', `Đường dẫn không phải file: ${value}`);
    }
    totalBytes += stat.size;
    if (stat.size > maxBytes || totalBytes > maxBytes) {
      throw new DiscordChannelSenderError(
        'files_too_large',
        `Tổng dung lượng file trong một tin nhắn phải nhỏ hơn hoặc bằng ${maxBytes} byte.`,
      );
    }

    seen.add(dedupeKey);
    files.push({
      path: realPath,
      name: path.basename(realPath),
      size: stat.size,
    });
  }
  return files;
}

function assertSendableChannel(channel) {
  if (!SENDABLE_CHANNEL_TYPES.has(channel.type)) {
    throw new DiscordChannelSenderError(
      'unsupported_channel',
      'Channel đích không phải text channel hoặc thread có thể nhận tin nhắn.',
    );
  }
}

async function resolveTargetChannel(rest, channelReference, guildId) {
  const reference = normalizeChannelReference(channelReference);
  if (reference.type === 'id') {
    const channel = await rest.get(Routes.channel(reference.value));
    if (String(channel.guild_id || '') !== guildId) {
      throw new DiscordChannelSenderError(
        'wrong_guild',
        'Channel đích không thuộc Discord server đã cấu hình cho bot.',
      );
    }
    assertSendableChannel(channel);
    return channel;
  }

  const channels = await rest.get(Routes.guildChannels(guildId));
  const expectedName = reference.value.toLocaleLowerCase('vi');
  const matches = channels.filter((channel) => (
    SENDABLE_CHANNEL_TYPES.has(channel.type)
    && String(channel.name || '').toLocaleLowerCase('vi') === expectedName
  ));
  if (matches.length === 0) {
    throw new DiscordChannelSenderError(
      'channel_not_found',
      `Không tìm thấy text channel có tên #${reference.value} trong server đã cấu hình.`,
    );
  }
  if (matches.length > 1) {
    throw new DiscordChannelSenderError(
      'ambiguous_channel',
      `Có nhiều channel cùng tên #${reference.value}; hãy dùng Channel ID để chọn chính xác.`,
    );
  }

  const channel = matches[0];
  assertSendableChannel(channel);
  return channel;
}

async function sendDiscordChannelMessage(options = {}) {
  const rest = options.rest;
  if (!rest || typeof rest.get !== 'function' || typeof rest.post !== 'function') {
    throw new TypeError('Thiếu Discord REST client hợp lệ.');
  }

  const guildId = parseSnowflake(options.guildId, 'guildId');
  const channelReference = options.channel ?? options.channelName ?? options.channelId;
  const content = normalizeContent(options.content);
  const files = await resolveDeliveryFiles(options.filePaths, options);
  if (!content && files.length === 0) {
    throw new DiscordChannelSenderError(
      'empty_message',
      'Tin nhắn phải có nội dung hoặc ít nhất một file.',
    );
  }

  const channel = await resolveTargetChannel(rest, channelReference, guildId);
  const channelId = parseSnowflake(channel.id, 'channelId');
  if (options.dryRun) {
    return {
      dryRun: true,
      channelId,
      channelName: channel.name || null,
      files: files.map(({ path: filePath, name, size }) => ({ path: filePath, name, size })),
    };
  }

  const uploadFiles = await Promise.all(files.map(async (file) => ({
    data: await fs.readFile(file.path),
    name: file.name,
  })));
  const body = {
    allowed_mentions: { parse: [] },
    ...(content ? { content } : {}),
  };
  const message = await rest.post(Routes.channelMessages(channelId), {
    body,
    files: uploadFiles,
  });
  return {
    dryRun: false,
    channelId,
    channelName: channel.name || null,
    messageId: String(message.id),
    files: files.map(({ name, size }) => ({ name, size })),
  };
}

module.exports = {
  ALLOWED_EXTENSIONS,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_FILES,
  DiscordChannelSenderError,
  normalizeChannelReference,
  normalizeContent,
  parseSnowflake,
  resolveDeliveryFiles,
  resolveTargetChannel,
  sendDiscordChannelMessage,
};

'use strict';

const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  TextDisplayBuilder,
} = require('discord.js');

const SCREENSHOT_GALLERY_LIMIT = 4;

const STATUS_COLORS = Object.freeze({
  queued: 0x38bdf8,
  running: 0x22d3ee,
  background: 0x6366f1,
  recovering: 0x3b82f6,
  stopping: 0xf59e0b,
  completed: 0x22c55e,
  completed_with_blocker: 0xf59e0b,
  failed: 0xef4444,
  stopped: 0x64748b,
});

const TERMINAL_STATUSES = new Set([
  'completed',
  'completed_with_blocker',
  'failed',
  'stopped',
]);

function shortJobId(value) {
  const text = String(value || 'unknown');
  return text.length > 8 ? text.slice(-8) : text;
}

function channelUrl(guildId, channelId) {
  if (!guildId || !channelId) {
    return '';
  }
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

function buildJobActionRows(job) {
  const detailUrl = channelUrl(job?.guildId, job?.detailThreadId);
  if (!detailUrl) {
    return [];
  }
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Xem chi tiết')
      .setEmoji('🧵')
      .setStyle(ButtonStyle.Link)
      .setURL(detailUrl),
  )];
}

function screenshotAttachmentName(job, screenshot, index) {
  const extension = String(screenshot.extension || '.png').toLowerCase();
  const safeExtension = /^\.[a-z0-9]{2,5}$/.test(extension) ? extension : '.png';
  return `openclaw-preview-${shortJobId(job.id)}-${index + 1}${safeExtension}`;
}

function screenshotTimestamp(screenshot) {
  const timestamp = Date.parse(screenshot?.capturedAt || '');
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null;
}

function buildScreenshotGalleryPayload(job) {
  const screenshots = Array.isArray(job?.screenshots)
    ? job.screenshots.slice(-SCREENSHOT_GALLERY_LIMIT)
    : [];
  if (!screenshots.length) {
    return null;
  }

  const files = [];
  const items = screenshots.map((screenshot, index) => {
    const name = screenshotAttachmentName(job, screenshot, index);
    const capturedAt = screenshotTimestamp(screenshot);
    const latestLabel = index === screenshots.length - 1 ? ' · mới nhất' : '';
    files.push(new AttachmentBuilder(screenshot.stagedPath, { name }));
    return new MediaGalleryItemBuilder()
      .setURL(`attachment://${name}`)
      .setDescription(
        `Ảnh OpenClaw ${index + 1}/${screenshots.length}${latestLabel}`
        + (capturedAt ? ` · ${new Date(capturedAt * 1000).toISOString()}` : ''),
      );
  });

  const latest = screenshots.at(-1);
  const latestTimestamp = screenshotTimestamp(latest);
  const terminal = TERMINAL_STATUSES.has(job.status);
  const header = [
    '### 👁️ OPENCLAW // LIVE VIEW',
    `**${screenshots.length} ảnh gần nhất**`
      + (latestTimestamp ? ` · ảnh cuối <t:${latestTimestamp}:R>` : ''),
    `Job \`#${shortJobId(job.id)}\``,
  ].join('\n');
  const footer = terminal
    ? '✅ Gallery đã chốt khi job kết thúc. Bấm vào ảnh để xem kích thước đầy đủ.'
    : 'Ảnh mới sẽ tự thay ảnh cũ; bấm vào ảnh để xem kích thước đầy đủ.';
  const container = new ContainerBuilder()
    .setAccentColor(STATUS_COLORS[job.status] || STATUS_COLORS.running)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(header))
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(items))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(footer));

  return {
    attachments: [],
    components: [container],
    files,
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [], repliedUser: false },
  };
}

module.exports = {
  SCREENSHOT_GALLERY_LIMIT,
  buildJobActionRows,
  buildScreenshotGalleryPayload,
  channelUrl,
  shortJobId,
};

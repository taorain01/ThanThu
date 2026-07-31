'use strict';

const { EmbedBuilder } = require('discord.js');
const { sanitizeInline } = require('./session-activity');
const { summarizeWorkers } = require('./task-summary');

const EMBED_LIMITS = Object.freeze({
  total: 6000,
  title: 256,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
  fields: 25,
  footer: 2048,
});
const RESPONSE_DESCRIPTION_LIMIT = 3800;
const FENCE_OVERHEAD = 64;
const DEFAULT_RESPONSE = 'OpenClaw không trả về nội dung.';

const COLORS = Object.freeze({
  response: 0x22d3ee,
  queued: 0x38bdf8,
  running: 0x22d3ee,
  background: 0x6366f1,
  recovering: 0x3b82f6,
  completed: 0x22c55e,
  completed_with_blocker: 0xf59e0b,
  failed: 0xef4444,
  stopped: 0x64748b,
});

const STATUS_META = Object.freeze({
  queued: { icon: '🕓', label: 'Đang chờ hàng đợi' },
  running: { icon: '⏳', label: 'Đang xử lý' },
  background: { icon: '⚙️', label: 'Worker nền đang chạy' },
  recovering: { icon: '♻️', label: 'Đang khôi phục an toàn' },
  completed: { icon: '✅', label: 'Đã hoàn tất' },
  completed_with_blocker: { icon: '⚠️', label: 'Hoàn tất có blocker' },
  failed: { icon: '❌', label: 'Gặp lỗi' },
  stopped: { icon: '⏹️', label: 'Đã dừng' },
});

const TERMINAL_STATUSES = new Set([
  'completed',
  'completed_with_blocker',
  'failed',
  'stopped',
]);

function truncate(value, maxLength, suffix = '…') {
  const text = String(value || '');
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - suffix.length)).trimEnd()}${suffix}`;
}

function validHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

function chooseSplitAt(text, maxLength) {
  const minimumPreferred = Math.floor(maxLength * 0.45);
  const candidates = [
    text.lastIndexOf('\n\n', maxLength),
    text.lastIndexOf('\n', maxLength),
    text.lastIndexOf(' ', maxLength),
  ];
  return candidates.find((position) => position >= minimumPreferred) || maxLength;
}

function splitRawText(text, maxLength) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    const splitAt = chooseSplitAt(remaining, maxLength);
    const chunk = remaining.slice(0, splitAt).trimEnd();
    if (chunk) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}

function updateFenceState(text, activeFence) {
  const fencePattern = /```[^\n]*/g;
  let state = activeFence;
  for (const match of text.matchAll(fencePattern)) {
    if (state) {
      state = null;
    } else {
      state = truncate(match[0].trimEnd(), 40, '');
    }
  }
  return state;
}

function splitEmbedDescription(value, maxLength = RESPONSE_DESCRIPTION_LIMIT) {
  const limit = Math.min(
    Math.max(128, Number(maxLength) || RESPONSE_DESCRIPTION_LIMIT),
    EMBED_LIMITS.description,
  );
  const text = String(value || '').trim() || DEFAULT_RESPONSE;
  if (text.length <= limit && updateFenceState(text, null) === null) {
    return [text];
  }

  const rawLimit = Math.max(64, limit - FENCE_OVERHEAD);
  const rawChunks = splitRawText(text, rawLimit);
  const chunks = [];
  let activeFence = null;

  for (const rawChunk of rawChunks) {
    const prefix = activeFence ? `${activeFence}\n` : '';
    const nextFence = updateFenceState(rawChunk, activeFence);
    const suffix = nextFence ? '\n```' : '';
    chunks.push(truncate(`${prefix}${rawChunk}${suffix}`, limit, ''));
    activeFence = nextFence;
  }

  return chunks.length ? chunks : [DEFAULT_RESPONSE];
}

function safeTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function identityOptions(options, fallbackName) {
  const name = truncate(options.botName || fallbackName, EMBED_LIMITS.title);
  const author = { name };
  if (validHttpUrl(options.botIconUrl)) {
    author.iconURL = options.botIconUrl;
  }
  return author;
}

function buildResponseEmbeds(value, options = {}) {
  const descriptions = splitEmbedDescription(value, options.maxDescriptionLength);
  const totalParts = descriptions.length;
  const jobId = truncate(options.jobId || 'không-xác-định', 80);
  const timestamp = safeTimestamp(options.timestamp);

  return descriptions.map((description, index) => {
    const part = index + 1;
    const title = totalParts === 1
      ? '✦ Phản hồi từ OpenClaw'
      : `✦ Phản hồi từ OpenClaw · ${part}/${totalParts}`;
    return new EmbedBuilder()
      .setColor(COLORS.response)
      .setAuthor(identityOptions(options, 'OPENCLAW // ASSISTANT'))
      .setTitle(truncate(title, EMBED_LIMITS.title))
      .setDescription(description)
      .setFooter({
        text: truncate(`Job ${jobId} • Phần ${part}/${totalParts}`, EMBED_LIMITS.footer),
      })
      .setTimestamp(timestamp);
  });
}

function elapsedLabel(startedAt, now = Date.now()) {
  const startedMs = Date.parse(startedAt);
  const elapsedMs = Math.max(0, now - (Number.isNaN(startedMs) ? now : startedMs));
  const totalMinutes = Math.floor(elapsedMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
}

function activityAgeLabel(value, now = Date.now()) {
  const timestamp = Number(value) || Date.parse(value || '');
  if (!Number.isFinite(timestamp)) {
    return 'chưa có hoạt động';
  }
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) {
    return `${seconds}s trước`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} phút trước`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} giờ trước`;
}

function workerCountsValue(summary) {
  return `${summary.counts.active} đang chạy • ${summary.counts.succeeded} xong • ${summary.counts.problem} lỗi`;
}

function tokenLabel(value) {
  return Math.max(0, Math.floor(Number(value) || 0)).toLocaleString('en-US');
}

function contextUsageValue(usage) {
  const contextTokens = Number(usage?.contextTokens);
  const usedTokens = Number(usage?.usedTokens);
  if (!Number.isFinite(contextTokens) || contextTokens <= 0) {
    return 'OpenClaw chưa báo giới hạn context của session này.';
  }
  if (!Number.isFinite(usedTokens) || usedTokens < 0) {
    return `Chưa có usage chính xác • giới hạn **${tokenLabel(contextTokens)} token**`;
  }
  const percentage = ((usedTokens / contextTokens) * 100)
    .toFixed(1)
    .replace(/\.0$/, '');
  const sourceLabel = usage.source === 'session'
    ? 'Snapshot session mới nhất'
    : 'Usage chính xác của lần gọi model gần nhất';
  return `**${tokenLabel(usedTokens)} / ${tokenLabel(contextTokens)} token (${percentage}%)**\n${sourceLabel}`;
}

function currentTaskValue(job, summary, now) {
  const worker = summary.current;
  if (!worker) {
    if (job.status === 'queued') {
      return 'Chưa khởi chạy; yêu cầu đang chờ lượt xử lý của session này.';
    }
    if (job.status === 'background') {
      return 'Đang tổng hợp kết quả và chốt trạng thái worker.';
    }
    if (TERMINAL_STATUSES.has(job.status)) {
      return 'Job không tạo worker nền.';
    }
    return 'Agent chính đang xử lý; chưa chuyển sang worker nền.';
  }

  const labels = {
    queued: '🕓 Đang chờ',
    running: '⚙️ Đang chạy',
    succeeded: '✅ Đã hoàn tất',
    problem: '⚠️ Gặp vấn đề',
    unknown: '• Chưa xác định',
  };
  const title = worker.label
    ? `**Worker ${worker.number} · ${worker.displayLabel}**`
    : `**Worker ${worker.number}**`;
  const lines = [
    title,
    `${job.stopRequested ? '⏹️ Đang yêu cầu dừng' : labels[worker.status] || labels.unknown} • cập nhật ${activityAgeLabel(worker.lastActivityAt, now)}`,
  ];
  if (worker.progress) {
    lines.push(truncate(worker.progress, 560));
  }
  return truncate(lines.join('\n'), EMBED_LIMITS.fieldValue);
}

function recentActivityValue(events, terminal) {
  const recent = (events || [])
    .slice(-8)
    .map((event) => truncate(sanitizeInline(event), 220));
  while (recent.length) {
    const value = recent.map((event) => `• ${event}`).join('\n');
    if (value.length <= EMBED_LIMITS.fieldValue) {
      return value;
    }
    recent.shift();
  }
  return terminal
    ? 'Không có hoạt động chi tiết được ghi lại.'
    : 'Đang chuẩn bị phiên và chờ hoạt động đầu tiên…';
}

function jobFooter(job, counts, prefix, terminal, heartbeatMs) {
  if (!terminal) {
    const seconds = Math.max(1, Math.round((Number(heartbeatMs) || 60000) / 1000));
    return `Heartbeat ${seconds}s • Dừng: ${prefix} o stop (hoặc ${prefix} openclaw stop)`;
  }
  if (counts.ready) {
    return `Còn ${counts.ready} file chờ gửi • ${prefix} openclaw resend ${job.id}`;
  }
  return 'Phiên đã khép lại • Cập nhật cuối';
}

function buildJobStatusEmbed(job, options = {}) {
  const status = STATUS_META[job.status] || { icon: '•', label: String(job.status || 'Không xác định') };
  const terminal = TERMINAL_STATUSES.has(job.status);
  const counts = {
    delivered: Number(options.counts?.delivered) || 0,
    total: Number(options.counts?.total) || 0,
    ready: Number(options.counts?.ready) || 0,
  };
  const queuePosition = Number(options.queuePosition) > 0 ? Number(options.queuePosition) : null;
  const queuePending = Math.max(0, Number(options.queuePending) || 0);
  const activeSessions = Math.max(0, Number(options.activeSessions) || 0);
  const maxConcurrentSessions = Math.max(1, Number(options.maxConcurrentSessions) || 1);
  const prefix = truncate(options.prefix || '>', 12, '');
  const now = Number(options.now) || Date.now();
  const jobId = truncate(job.id || 'không-xác-định', 100);
  const channelId = truncate(job.channelId || 'không-xác-định', 100);
  const workerSummary = summarizeWorkers(job);
  const embed = new EmbedBuilder()
    .setColor(COLORS[job.status] || COLORS.response)
    .setAuthor(identityOptions(options, 'OPENCLAW // JOB MONITOR'))
    .setTitle(truncate(`${status.icon} ${status.label}`, EMBED_LIMITS.title))
    .setDescription(`**Job** \`${jobId}\`\n**Kênh** <#${channelId}>`)
    .addFields(
      {
        name: '⏱️ Thời gian',
        value: elapsedLabel(job.createdAt, options.now),
        inline: true,
      },
      {
        name: '📦 File',
        value: truncate(
          `${counts.delivered}/${counts.total} đã gửi${counts.ready ? ` • ${counts.ready} chờ` : ''}`,
          EMBED_LIMITS.fieldValue,
        ),
        inline: true,
      },
      {
        name: '🤖 Worker',
        value: workerCountsValue(workerSummary),
        inline: true,
      },
    );

  embed.addFields({
    name: '🧠 Context session',
    value: contextUsageValue(options.contextUsage),
    inline: false,
  });

  if (queuePosition) {
    embed.addFields({
      name: '🛰️ Hàng đợi của session',
      value: `Lượt chờ **${queuePosition}/${Math.max(queuePending, queuePosition)}** • ${activeSessions}/${maxConcurrentSessions} session đang chạy`,
      inline: false,
    });
  }

  embed.addFields({
    name: '🛠️ Task hiện tại',
    value: currentTaskValue(job, workerSummary, now),
    inline: false,
  });

  embed.addFields({
    name: terminal ? '📋 Hoạt động gần nhất' : '📡 Luồng hoạt động',
    value: recentActivityValue(job.events, terminal),
    inline: false,
  });

  if (job.terminalReason) {
    embed.addFields({
      name: terminal && job.status === 'failed' ? '🚨 Chi tiết lỗi' : '🎯 Kết quả',
      value: truncate(sanitizeInline(job.terminalReason), EMBED_LIMITS.fieldValue),
      inline: false,
    });
  }

  embed
    .setFooter({
      text: truncate(
        jobFooter(job, counts, prefix, terminal, options.heartbeatMs),
        EMBED_LIMITS.footer,
      ),
    })
    .setTimestamp(safeTimestamp(terminal ? job.updatedAt || options.timestamp : now));

  if (validHttpUrl(options.botIconUrl)) {
    embed.setThumbnail(options.botIconUrl);
  }
  return embed;
}

module.exports = {
  COLORS,
  EMBED_LIMITS,
  RESPONSE_DESCRIPTION_LIMIT,
  buildJobStatusEmbed,
  buildResponseEmbeds,
  splitEmbedDescription,
};

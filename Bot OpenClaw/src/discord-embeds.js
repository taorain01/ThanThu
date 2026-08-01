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
  statusOnline: 0x22c55e,
  statusWarning: 0xf59e0b,
  statusOffline: 0xef4444,
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

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  const gibibytes = bytes / (1024 ** 3);
  return `${gibibytes.toFixed(gibibytes >= 10 ? 1 : 2)} GB`;
}

function percentText(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric.toFixed(1).replace(/\.0$/, '')}%` : 'N/A';
}

function usageBar(value) {
  const percent = Math.min(100, Math.max(0, Number(value) || 0));
  const filled = Math.round(percent / 10);
  return `\`${'█'.repeat(filled)}${'░'.repeat(10 - filled)}\``;
}

function uptimeLabel(secondsValue) {
  const totalMinutes = Math.floor(Math.max(0, Number(secondsValue) || 0) / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) {
    return `${days}d ${hours}h`;
  }
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function systemStatusColor(metrics) {
  const values = [
    metrics.cpu?.utilizationPercent,
    metrics.memory?.usedPercent,
    metrics.disk?.usedPercent,
    ...(metrics.gpus || []).map((gpu) => gpu.utilizationPercent),
  ].filter(Number.isFinite);
  const highest = values.length ? Math.max(...values) : 0;
  if (highest >= 90) {
    return 0xef4444;
  }
  if (highest >= 75) {
    return 0xf59e0b;
  }
  return 0x22c55e;
}

function buildSystemStatusEmbed(metrics, options = {}) {
  const cpuPercent = metrics.cpu?.utilizationPercent;
  const memory = metrics.memory || {};
  const disk = metrics.disk;
  const cpuTemperature = Number(metrics.cpuTemperature?.celsius);
  const cpuTemperatureText = Number.isFinite(cpuTemperature)
    ? `**${cpuTemperature.toFixed(0)}°C** (${metrics.cpuTemperature.name})`
    : 'Không khả dụng — Windows chưa có nguồn cảm biến CPU tin cậy.';
  const gpuText = (metrics.gpus || []).length
    ? metrics.gpus.map((gpu) => {
      const memoryPercent = Number(gpu.memoryTotalBytes) > 0
        ? (Number(gpu.memoryUsedBytes) / Number(gpu.memoryTotalBytes)) * 100
        : null;
      const temperature = Number.isFinite(Number(gpu.temperatureC))
        ? ` • **${Number(gpu.temperatureC).toFixed(0)}°C**`
        : '';
      return [
        `**${truncate(gpu.name, 80)}**${temperature}`,
        `${usageBar(gpu.utilizationPercent)} tải **${percentText(gpu.utilizationPercent)}**`,
        `VRAM **${formatBytes(gpu.memoryUsedBytes)} / ${formatBytes(gpu.memoryTotalBytes)}** (${percentText(memoryPercent)})`,
      ].join('\n');
    }).join('\n\n')
    : 'Không tìm thấy NVIDIA GPU hoặc `nvidia-smi` không khả dụng.';

  const gatewayText = options.gateway?.ok
    ? `✅ Online • phản hồi **${Math.max(0, Number(options.gateway.latencyMs) || 0)} ms**`
    : '❌ Không kết nối được Gateway';
  const embed = new EmbedBuilder()
    .setColor(systemStatusColor(metrics))
    .setAuthor(identityOptions(options, 'OPENCLAW // SYSTEM MONITOR'))
    .setTitle('🖥️ Tài nguyên máy tính')
    .addFields(
      {
        name: '🧠 CPU',
        value: [
          `${usageBar(cpuPercent)} tải **${percentText(cpuPercent)}**`,
          `${truncate(metrics.cpu?.model || 'CPU', 90)} • ${metrics.cpu?.logicalCores || 0} luồng`,
          `Nhiệt độ: ${cpuTemperatureText}`,
        ].join('\n'),
      },
      {
        name: '💾 RAM',
        value: [
          `${usageBar(memory.usedPercent)} dùng **${percentText(memory.usedPercent)}**`,
          `**${formatBytes(memory.usedBytes)} / ${formatBytes(memory.totalBytes)}** • còn ${formatBytes(memory.freeBytes)}`,
        ].join('\n'),
        inline: true,
      },
      {
        name: `🗄️ Ổ đĩa ${disk?.root || ''}`.trim(),
        value: disk
          ? [
            `${usageBar(disk.usedPercent)} dùng **${percentText(disk.usedPercent)}**`,
            `**${formatBytes(disk.usedBytes)} / ${formatBytes(disk.totalBytes)}** • còn ${formatBytes(disk.freeBytes)}`,
          ].join('\n')
          : 'Không đọc được dung lượng ổ đĩa.',
        inline: true,
      },
      { name: '🎮 GPU', value: truncate(gpuText, EMBED_LIMITS.fieldValue, '') },
      {
        name: '🦞 OpenClaw',
        value: `${gatewayText}\nUptime máy: **${uptimeLabel(metrics.uptimeSeconds)}**`,
      },
    )
    .setFooter({ text: 'Đo trực tiếp • CPU lấy mẫu 500 ms • GPU từ NVIDIA SMI' })
    .setTimestamp(safeTimestamp(metrics.timestamp));

  if (validHttpUrl(options.botIconUrl)) {
    embed.setThumbnail(options.botIconUrl);
  }
  return embed;
}

function inlineCode(value, maxLength = 160) {
  return truncate(String(value || '').replace(/`/g, "'"), maxLength);
}

function jobArtifactCounts(job) {
  const artifacts = Object.values(job?.artifacts || {});
  return {
    total: artifacts.length,
    delivered: artifacts.filter((artifact) => artifact.status === 'delivered').length,
    ready: artifacts.filter((artifact) => artifact.status === 'ready').length,
  };
}

function jobStatusMeta(job) {
  return STATUS_META[job?.status] || {
    icon: '•',
    label: String(job?.status || 'Không xác định'),
  };
}

function currentChannelValue(channel, now) {
  if (!channel) {
    return '⚪ **Chưa bật**\nKênh này chưa có phiên OpenClaw.';
  }
  const state = channel.enabled ? '🟢 **Đang bật**' : '⚪ **Đang tắt**';
  return [
    `${state} • <#${channel.channelId}>`,
    `Phiên **${Math.max(0, Number(channel.sessionGeneration) || 0)}** • cập nhật ${activityAgeLabel(channel.updatedAt, now)}`,
  ].join('\n');
}

function modelStatusValue(channel) {
  if (!channel?.modelProfile) {
    return 'Chưa có model được chọn cho kênh này.';
  }
  const state = channel.enabled ? 'đang dùng' : 'đã lưu';
  const backendModel = channel.backendModel
    ? `\n\`${inlineCode(channel.backendModel, 140)}\``
    : '';
  return `**${inlineCode(channel.modelProfile, 40)}** • ${state}${backendModel}`;
}

function gatewayStatusValue(gateway) {
  const latency = Math.max(0, Number(gateway?.latencyMs) || 0);
  if (gateway?.ok) {
    return `🟢 **Online**\nHTTP ${gateway.status || 200} • **${latency} ms**`;
  }
  const response = gateway?.status ? `HTTP ${gateway.status}` : 'Không nhận được phản hồi';
  return `🔴 **Ngoại tuyến**\n${response} • ${latency} ms`;
}

function schedulerStatusValue(queue) {
  const active = Math.max(0, Number(queue?.activeCount) || 0);
  const maxConcurrent = Math.max(1, Number(queue?.maxConcurrent) || 1);
  const pending = Math.max(0, Number(queue?.pending) || 0);
  const maxPending = Math.max(1, Number(queue?.maxPending) || pending || 1);
  const lines = [
    `${usageBar((active / maxConcurrent) * 100)} **${active}/${maxConcurrent} session đang chạy**`,
    `Hàng chờ: **${pending}/${maxPending} yêu cầu**`,
  ];
  const activeChannelIds = [...new Set((queue?.activeMetadataList || [])
    .map((item) => item.channelId)
    .filter(Boolean))];
  if (activeChannelIds.length) {
    lines.push(`Đang xử lý: ${activeChannelIds.slice(0, 8).map((id) => `<#${id}>`).join(', ')}`);
  }
  return truncate(lines.join('\n'), EMBED_LIMITS.fieldValue);
}

function currentJobValue(job, now) {
  if (!job) {
    return 'Không có lịch sử job trong kênh này.';
  }
  const status = jobStatusMeta(job);
  const counts = jobArtifactCounts(job);
  const activity = activityAgeLabel(job.lastActivityAt || job.updatedAt, now);
  const lines = [
    `${status.icon} **${status.label}** • \`${inlineCode(job.id, 80)}\``,
    `⏱️ ${elapsedLabel(job.createdAt, now)} • 📦 ${counts.delivered}/${counts.total} file${counts.ready ? ` • ${counts.ready} chờ gửi` : ''} • cập nhật ${activity}`,
  ];
  if (job.stopRequested) {
    lines.push('⏹️ Đang chờ OpenClaw xác nhận dừng toàn bộ task.');
  }
  if (job.lastEvent) {
    lines.push(`↳ ${truncate(sanitizeInline(job.lastEvent), 420)}`);
  } else if (job.terminalReason) {
    lines.push(`↳ ${truncate(sanitizeInline(job.terminalReason), 420)}`);
  }
  return truncate(lines.join('\n'), EMBED_LIMITS.fieldValue);
}

function activeJobsValue(jobs, now) {
  if (!jobs.length) {
    return '✅ Không có job nào đang chạy hoặc chờ xử lý.';
  }
  const lines = jobs.slice(0, 4).map((job) => {
    const status = jobStatusMeta(job);
    const counts = jobArtifactCounts(job);
    return `${status.icon} \`${inlineCode(job.id, 60)}\` • <#${job.channelId}> • **${status.label}** • ${elapsedLabel(job.createdAt, now)} • ${counts.delivered}/${counts.total} file`;
  });
  if (jobs.length > lines.length) {
    lines.push(`… và **${jobs.length - lines.length} job** khác.`);
  }
  return truncate(lines.join('\n'), EMBED_LIMITS.fieldValue);
}

function activeChannelsValue(channels) {
  if (!channels.length) {
    return 'Không có channel nào đang bật OpenClaw.';
  }
  const visible = channels.slice(0, 12)
    .map((channel) => `<#${channel.channelId}> · ${inlineCode(channel.modelProfile || 'chưa chọn', 30)}`);
  if (channels.length > visible.length) {
    visible.push(`… và **${channels.length - visible.length} channel** khác.`);
  }
  return truncate(visible.join('\n'), EMBED_LIMITS.fieldValue);
}

function mediaStatusValue(media) {
  const roots = Math.max(0, Number(media?.sourceRoots) || 0);
  const retentionHours = Math.max(0, Number(media?.retentionHours) || 0);
  const retentionDays = retentionHours >= 24
    ? ` (${(retentionHours / 24).toFixed(retentionHours % 24 ? 1 : 0)} ngày)`
    : '';
  return `**${roots}** thư mục nguồn được phép\nOutbox giữ **${retentionHours} giờ**${retentionDays}`;
}

function securityStatusValue(security) {
  const lines = [];
  if (security?.publicChannel === true) {
    lines.push('⚠️ `@everyone` có thể xem kênh hiện tại; phản hồi có thể chứa dữ liệu nhạy cảm.');
  } else if (security?.publicChannel === false) {
    lines.push('✅ `@everyone` không xem được kênh hiện tại.');
  } else {
    lines.push('• Chưa xác định được phạm vi xem của kênh hiện tại.');
  }
  lines.push(security?.botIsAdmin
    ? '⚠️ Bot đang có quyền Administrator; nên dùng bộ quyền tối thiểu.'
    : '✅ Bot không dùng quyền Administrator.');
  lines.push(`👤 **${Math.max(0, Number(security?.allowedUsers) || 0)}** Discord user được phép điều khiển.`);
  return truncate(lines.join('\n'), EMBED_LIMITS.fieldValue);
}

function buildOpenClawStatusEmbed(options = {}) {
  const now = Number(options.now) || Date.now();
  const gateway = options.gateway || {};
  const currentChannel = options.currentChannel || null;
  const activeJobs = options.activeJobs || [];
  const activeChannels = options.activeChannels || [];
  const ready = Boolean(gateway.ok && currentChannel?.enabled);
  const headline = !gateway.ok
    ? '🔴 **Gateway không sẵn sàng**'
    : currentChannel?.enabled
      ? '🟢 **Sẵn sàng nhận yêu cầu trong kênh này**'
      : '🟡 **Gateway online, kênh hiện tại chưa bật**';
  const color = !gateway.ok
    ? COLORS.statusOffline
    : ready
      ? COLORS.statusOnline
      : COLORS.statusWarning;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor(identityOptions(options, 'OPENCLAW // STATUS CONSOLE'))
    .setTitle('🦞 Trung tâm điều khiển OpenClaw')
    .setDescription([
      headline,
      `**${activeJobs.length} job** đang hoạt động • **${activeChannels.length} channel** đã bật`,
    ].join('\n'))
    .addFields(
      {
        name: '📍 Kênh hiện tại',
        value: currentChannelValue(currentChannel, now),
        inline: true,
      },
      {
        name: '🧠 Model',
        value: modelStatusValue(currentChannel),
        inline: true,
      },
      {
        name: '🌐 Gateway',
        value: gatewayStatusValue(gateway),
        inline: true,
      },
      {
        name: '🛰️ Scheduler',
        value: schedulerStatusValue(options.queue),
      },
      {
        name: '📌 Job gần nhất của kênh',
        value: currentJobValue(options.currentJob, now),
      },
      {
        name: `⚙️ Job đang hoạt động toàn bot (${activeJobs.length})`,
        value: activeJobsValue(activeJobs, now),
      },
      {
        name: `🔗 Channel đang bật (${activeChannels.length})`,
        value: activeChannelsValue(activeChannels),
        inline: true,
      },
      {
        name: '📦 Media & lưu trữ',
        value: mediaStatusValue(options.media),
        inline: true,
      },
      {
        name: '🛡️ An toàn & quyền',
        value: securityStatusValue(options.security),
      },
    )
    .setFooter({
      text: truncate(
        `Cập nhật trực tiếp • Dừng: ${options.prefix || '>'} o stop • Model: ${options.prefix || '>'} o m`,
        EMBED_LIMITS.footer,
      ),
    })
    .setTimestamp(safeTimestamp(now));

  if (validHttpUrl(options.botIconUrl)) {
    embed.setThumbnail(options.botIconUrl);
  }
  return embed;
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

function jobFooter(job, counts, prefix, terminal, heartbeatMs, updateDebounceMs) {
  if (!terminal) {
    const heartbeatSeconds = Math.max(1, Math.round((Number(heartbeatMs) || 60000) / 1000));
    const updateSeconds = Math.max(0.25, (Number(updateDebounceMs) || 1000) / 1000)
      .toFixed(2)
      .replace(/0+$/, '')
      .replace(/\.$/, '');
    return `Realtime ~${updateSeconds}s • dự phòng ${heartbeatSeconds}s • Dừng: ${prefix} o stop`;
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
        jobFooter(
          job,
          counts,
          prefix,
          terminal,
          options.heartbeatMs,
          options.updateDebounceMs,
        ),
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
  buildOpenClawStatusEmbed,
  buildResponseEmbeds,
  buildSystemStatusEmbed,
  splitEmbedDescription,
};

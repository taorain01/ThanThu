'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { extractMediaReferences } = require('./response-media');

function truncate(value, maxLength) {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function sanitizeActivityText(value, maxLength = 24000) {
  const home = os.homedir();
  let text = String(value || '')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
    .replace(/\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\b/g, '[REDACTED]')
    .replace(/[A-Za-z0-9+/=_-]{180,}/g, '[dữ liệu dài đã ẩn]');

  if (home) {
    text = text.replaceAll(home, '%USERPROFILE%');
  }

  text = text
    .replace(/%USERPROFILE%\\[^\s"'`;|]*/gi, '<đường dẫn>')
    .replace(/[A-Za-z]:\\[^"'`;|\r\n]*?\.[A-Za-z0-9]{1,10}\b/g, '<đường dẫn>')
    .replace(/[A-Za-z]:\\[^"'`;|\r\n]+$/gm, '<đường dẫn>')
    .replace(/[A-Za-z]:\\(?:[^\s"'`;|]+\\)*[^\s"'`;|]*/g, '<đường dẫn>')
    .replace(/\\\\[^\s"'`;|]+\\[^\s"'`;|]+/g, '<đường dẫn mạng>')
    .replace(/\[\[[^\]]+\]\]/g, '')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return truncate(text, maxLength);
}

function sanitizeInline(value) {
  return truncate(sanitizeActivityText(value).replace(/\s+/g, ' '), 180);
}

function toolLabel(toolName) {
  return String(toolName || 'tool').replace(/[^A-Za-z0-9_.-]/g, '');
}

function isScreenshotCommand(value) {
  const command = String(value || '');
  return /screen\.snapshot/i.test(command)
    || /(?:^|\s)(?:node(?:\.exe)?\s+)?["']?[^\s"']*shot\.js\b/i.test(command);
}

function summarizeToolCall(call) {
  const name = toolLabel(call?.name);
  const args = call?.arguments && typeof call.arguments === 'object' ? call.arguments : {};

  if (name === 'exec') {
    const command = String(args.command || '');
    if (/nodes\s+status/i.test(command)) {
      return `▶ \`${name}\` — kiểm tra Windows Node`;
    }
    if (isScreenshotCommand(command)) {
      return `▶ \`${name}\` — chụp màn hình Windows`;
    }
    if (/base64|FromBase64String|WriteAllBytes/i.test(command)) {
      return `▶ \`${name}\` — xử lý ảnh chụp màn hình`;
    }
    return `▶ \`${name}\` — ${sanitizeInline(command) || 'chạy lệnh trên máy'}`;
  }

  if (name === 'image') {
    return `▶ \`${name}\` — phân tích ảnh`;
  }

  const action = sanitizeInline(args.action || args.command || args.path || args.file_path || '');
  return `▶ \`${name}\`${action ? ` — ${action}` : ''}`;
}

function mediaFromAssistantText(value) {
  return extractMediaReferences(value).references;
}

function extractActivityEvents(record) {
  if (!record || record.type !== 'message' || !record.message) {
    return [];
  }

  const message = record.message;
  const events = [];
  if (message.role === 'assistant') {
    const content = Array.isArray(message.content)
      ? message.content
      : [{ type: 'text', text: message.content }];
    const responseText = content
      .filter((part) => part?.type === 'text')
      .map((part) => String(part.text || ''))
      .join('\n');
    if (responseText) {
      const parsedMedia = extractMediaReferences(responseText);
      const mediaReferences = parsedMedia.references;
      const mediaLabels = parsedMedia.items.map((item) => sanitizeInline(item.label));
      const visibleText = parsedMedia.text.replace(/\[\[[^\]]+\]\]/g, '');
      const label = sanitizeInline(visibleText);
      const notificationText = sanitizeActivityText(visibleText);
      const text = label ? `💬 ${label}` : '';
      if (text || mediaReferences.length) {
        events.push({
          kind: 'assistant',
          text,
          notificationText,
          responseText,
          final: message.stopReason !== 'toolUse',
          stopReason: message.stopReason || '',
          mediaReferences,
          mediaLabels,
          mediaLabel: label,
        });
      }
    }
    for (const part of content) {
      if (part?.type === 'toolCall') {
        const callName = toolLabel(part.name);
        const callArgs = part.arguments && typeof part.arguments === 'object'
          ? part.arguments
          : {};
        // Đánh dấu lệnh chụp màn hình để supervisor gửi ảnh xem trước cho user;
        // tool image kế tiếp mang đường dẫn ảnh thật (vd windows-current.png).
        const screenSnapshot = callName === 'exec'
          && isScreenshotCommand(callArgs.command);
        let imageFile = '';
        if (callName === 'image') {
          imageFile = String(callArgs.image
            || callArgs.file_path
            || callArgs.path
            || callArgs.file
            || '');
        }
        events.push({
          kind: 'tool_call',
          text: summarizeToolCall(part),
          mediaReferences: [],
          screenSnapshot,
          imageFile: imageFile || null,
        });
      }
    }
  }

  if (message.role === 'toolResult') {
    const name = toolLabel(message.toolName);
    events.push({
      kind: 'tool_result',
      text: `${message.isError ? '✗' : '✓'} \`${name}\` ${message.isError ? 'gặp lỗi' : 'hoàn tất'}`,
      mediaReferences: [],
    });
  }
  return events;
}

function elapsedLabel(elapsedMs) {
  const totalSeconds = Math.max(0, Math.round(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

function numberedEvents(events) {
  return events.map((event, index) => `${index + 1}. ${event}`);
}

function fitRecentLines(header, lines, footer, maxLength = 1900) {
  const selected = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const candidate = [header, ...[lines[index], ...selected], footer].filter(Boolean).join('\n');
    if (candidate.length > maxLength) {
      break;
    }
    selected.unshift(lines[index]);
  }
  return [header, ...selected, footer].filter(Boolean).join('\n');
}

function formatLiveActivity(events, elapsedMs, maxLength = 1900) {
  const header = `⏳ **OpenClaw đang làm việc** · ${elapsedLabel(elapsedMs)}`;
  const lines = numberedEvents(events);
  if (lines.length === 0) {
    lines.push('Đang chuẩn bị phiên và chờ tool đầu tiên…');
  }
  return fitRecentLines(header, lines, 'Dùng lệnh stop để ngắt chờ.', maxLength);
}

function formatFinishedActivity(events, elapsedMs, status = 'completed', maxLength = 1900) {
  const statusText = status === 'stopped'
    ? '⏹️ **Phiên đã dừng**'
    : status === 'failed'
      ? '❌ **Phiên gặp lỗi**'
      : '✅ **Phiên đã hoàn tất**';
  const header = `${statusText} · ${elapsedLabel(elapsedMs)} · ${events.length} sự kiện`;
  const note = '_Nhật ký đã lọc: không hiển thị token, nội dung file hoặc dữ liệu ảnh base64._';
  const lines = numberedEvents(events);
  const fullText = [header, ...lines, note].join('\n');
  if (fullText.length <= maxLength) {
    return { panel: fullText, overflow: '' };
  }

  return {
    panel: fitRecentLines(header, lines, `${note}\nNhật ký đầy đủ được gửi ở tin nhắn tiếp theo.`, maxLength),
    overflow: [`**Nhật ký phiên đầy đủ (${events.length} sự kiện)**`, ...lines, note].join('\n'),
  };
}

class OpenClawSessionMonitor {
  constructor(options) {
    this.sessionsDir = options.sessionsDir;
    this.sessionKey = options.sessionKey;
    this.onEvent = options.onEvent || (() => {});
    this.onOffset = options.onOffset || (() => {});
    this.onRecord = options.onRecord || (() => {});
    this.pollIntervalMs = options.pollIntervalMs || 750;
    this.initialOffset = Number.isSafeInteger(options.initialOffset) ? options.initialOffset : null;
    this.startAtEnd = options.startAtEnd !== false;
    this.afterTimestampMs = Number.isFinite(options.afterTimestampMs)
      ? options.afterTimestampMs
      : null;
    this.transcriptPath = null;
    this.offset = 0;
    this.offsetInitialized = false;
    this.timer = null;
    this.pollPromise = Promise.resolve();
  }

  async resolveTranscript() {
    try {
      const index = JSON.parse(await fs.readFile(path.join(this.sessionsDir, 'sessions.json'), 'utf8'));
      const entry = index?.[this.sessionKey];
      const sessionId = entry?.sessionId;
      if (!sessionId) {
        return false;
      }
      this.transcriptPath = entry.sessionFile || path.join(this.sessionsDir, `${sessionId}.jsonl`);
      if (!this.offsetInitialized) {
        try {
          const size = (await fs.stat(this.transcriptPath)).size;
          this.offset = this.initialOffset === null
            ? (this.startAtEnd ? size : 0)
            : Math.min(this.initialOffset, size);
        } catch {
          this.offset = 0;
        }
        this.offsetInitialized = true;
        await this.onOffset(this.offset);
      }
      return true;
    } catch {
      return false;
    }
  }

  async pollOnce() {
    if (!this.transcriptPath && !(await this.resolveTranscript())) {
      return;
    }

    let buffer;
    try {
      const handle = await fs.open(this.transcriptPath, 'r');
      try {
        const stat = await handle.stat();
        if (stat.size < this.offset) {
          this.offset = 0;
          await this.onOffset(this.offset);
        }
        if (stat.size === this.offset) {
          return;
        }
        buffer = Buffer.alloc(stat.size - this.offset);
        await handle.read(buffer, 0, buffer.length, this.offset);
      } finally {
        await handle.close();
      }
    } catch {
      return;
    }

    let cursor = 0;
    while (cursor < buffer.length) {
      const newlineIndex = buffer.indexOf(0x0a, cursor);
      if (newlineIndex === -1) {
        break;
      }
      const line = buffer.subarray(cursor, newlineIndex).toString('utf8').replace(/\r$/, '');
      if (!line.trim()) {
        cursor = newlineIndex + 1;
        this.offset += cursor;
        buffer = buffer.subarray(cursor);
        cursor = 0;
        await this.onOffset(this.offset);
        continue;
      }
      let record = null;
      try {
        record = JSON.parse(line);
      } catch {
        // Commit malformed complete lines so one bad record cannot stall the transcript forever.
      }
      if (record) {
        await this.onRecord(record);
        const timestampValue = record.timestamp || record.message?.timestamp;
        const timestampMs = typeof timestampValue === 'number'
          ? timestampValue
          : Date.parse(timestampValue || '');
        const isHistorical = this.afterTimestampMs !== null
          && Number.isFinite(timestampMs)
          && timestampMs < this.afterTimestampMs;
        if (!isHistorical) {
          for (const event of extractActivityEvents(record)) {
            await this.onEvent(event);
          }
        }
      }
      cursor = newlineIndex + 1;
      this.offset += cursor;
      buffer = buffer.subarray(cursor);
      cursor = 0;
      await this.onOffset(this.offset);
    }
  }

  poll() {
    const operation = this.pollPromise.catch(() => {}).then(() => this.pollOnce());
    this.pollPromise = operation;
    return operation;
  }

  async start() {
    await this.resolveTranscript();
    this.timer = setInterval(() => void this.poll().catch(() => {}), this.pollIntervalMs);
    this.timer.unref?.();
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.poll();
  }
}

module.exports = {
  OpenClawSessionMonitor,
  extractActivityEvents,
  formatFinishedActivity,
  formatLiveActivity,
  isScreenshotCommand,
  mediaFromAssistantText,
  sanitizeActivityText,
  sanitizeInline,
};

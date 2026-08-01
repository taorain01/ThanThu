'use strict';

const { splitDiscordText } = require('./message-utils');

function activityTitle(event) {
  const source = event.sourceLabel || (event.isRoot ? 'OpenClaw chính' : 'sub-agent');
  if (event.kind === 'assistant') {
    return event.final ? `✅ Phản hồi từ ${source}` : `💬 Cập nhật từ ${source}`;
  }
  if (event.kind === 'tool_call') {
    return `⚙️ Thao tác của ${source}`;
  }
  if (event.kind === 'tool_result') {
    return `🧾 Kết quả thao tác của ${source}`;
  }
  if (event.kind === 'worker') {
    return '🤖 Điều phối sub-agent';
  }
  return '📣 Tiến trình OpenClaw';
}

function isRootTranscriptFinal(event) {
  return Boolean(
    event?.origin === 'transcript'
    && event.isRoot
    && event.kind === 'assistant'
    && event.final
  );
}

function shouldSendActivity(event) {
  if (!String(event?.notificationText || event?.text || '').trim()) {
    return false;
  }
  return !isRootTranscriptFinal(event);
}

function buildActivityMessages(job, event, maxLength = 1900) {
  if (!shouldSendActivity(event)) {
    return [];
  }
  const body = String(event.notificationText || event.text).trim();
  const title = activityTitle(event);
  const baseHeader = `**${title}** · Job \`${job.id}\``;
  const continuationHeader = `**${title} (tiếp)** · Job \`${job.id}\``;
  const bodyLimit = Math.max(200, maxLength - continuationHeader.length - 1);
  return splitDiscordText(body, bodyLimit).map((chunk, index) => {
    const header = index === 0 ? baseHeader : continuationHeader;
    return `${header}\n${chunk}`;
  });
}

module.exports = {
  activityTitle,
  buildActivityMessages,
  isRootTranscriptFinal,
  shouldSendActivity,
};

'use strict';

const RESPONSE_PRIORITY_MS = 2 * 60 * 1000;

function timestampMs(value) {
  const parsed = Number(value) || Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}

function shouldSendDirectActivity(job) {
  return !job?.responseSent;
}

function responseCanYieldToActivity(job, now = Date.now(), priorityMs = RESPONSE_PRIORITY_MS) {
  const responseSentAt = timestampMs(job?.responseSentAt);
  const lastActivityAt = timestampMs(job?.lastActivityAt);
  if (responseSentAt === null || lastActivityAt === null) {
    return false;
  }
  return now - responseSentAt >= priorityMs && lastActivityAt > responseSentAt;
}

function shouldMoveStatusToBottom(options = {}) {
  const job = options.job;
  if (
    !job
    || job.status === 'queued'
    || !options.statusMessageId
    || options.lastMessageId === options.statusMessageId
  ) {
    return false;
  }
  if (!options.lastMessageIsBot) {
    return true;
  }
  return responseCanYieldToActivity(job, options.now, options.priorityMs);
}

module.exports = {
  RESPONSE_PRIORITY_MS,
  responseCanYieldToActivity,
  shouldMoveStatusToBottom,
  shouldSendDirectActivity,
  timestampMs,
};

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

function normalizeText(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function fingerprintText(value) {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function contentCandidates(content) {
  if (typeof content === 'string') {
    return [content];
  }
  if (!Array.isArray(content)) {
    return [];
  }
  const parts = content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text);
  return [...parts, parts.join('\n')];
}

function assistantText(content) {
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

async function findTranscriptResponse(options) {
  const targetFingerprint = options.requestFingerprint;
  if (!targetFingerprint) {
    return null;
  }
  let lines;
  try {
    lines = (await fs.readFile(options.transcriptPath, 'utf8')).split(/\r?\n/);
  } catch {
    return null;
  }

  const afterTimestampMs = Number(options.afterTimestampMs) || 0;
  let matchedRequest = false;
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record?.type !== 'message' || !record.message) {
      continue;
    }
    const timestampMs = Date.parse(record.timestamp || record.message.timestamp || '');
    if (Number.isFinite(timestampMs) && timestampMs < afterTimestampMs) {
      continue;
    }

    if (record.message.role === 'user') {
      matchedRequest = contentCandidates(record.message.content)
        .some((candidate) => fingerprintText(candidate) === targetFingerprint);
      continue;
    }
    if (
      matchedRequest
      && record.message.role === 'assistant'
      && record.message.stopReason !== 'toolUse'
    ) {
      const text = assistantText(record.message.content);
      if (text) {
        return text;
      }
    }
  }
  return null;
}

async function resolveSessionTranscriptPath(sessionsDir, sessionKey) {
  try {
    const index = JSON.parse(await fs.readFile(path.join(sessionsDir, 'sessions.json'), 'utf8'));
    const entry = index?.[sessionKey];
    if (!entry) {
      return null;
    }
    const sessionId = String(entry.sessionId || '').trim();
    const transcriptPath = entry.sessionFile
      || (sessionId ? path.join(sessionsDir, `${sessionId}.jsonl`) : null);
    if (!transcriptPath) {
      return null;
    }
    return transcriptPath;
  } catch {
    return null;
  }
}

async function findSessionResponse(sessionsDir, sessionKey, options) {
  const transcriptPath = await resolveSessionTranscriptPath(sessionsDir, sessionKey);
  if (!transcriptPath) {
    return null;
  }
  return findTranscriptResponse({
    transcriptPath,
    requestFingerprint: options.requestFingerprint,
    afterTimestampMs: options.afterTimestampMs,
  });
}

function waitForDelay(delayMs, signal) {
  if (signal?.aborted) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (completed) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(completed);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(true), delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitForSessionResponse(sessionsDir, sessionKey, options) {
  const pollIntervalMs = Math.max(100, Number(options.pollIntervalMs) || 750);
  const maxWaitMs = Math.max(0, Number(options.maxWaitMs) || 300000);
  const startedAt = Date.now();
  let transcriptPath = null;
  let previousSignature = null;

  while (!options.signal?.aborted) {
    transcriptPath ||= await resolveSessionTranscriptPath(sessionsDir, sessionKey);
    if (transcriptPath) {
      try {
        const stat = await fs.stat(transcriptPath);
        const signature = `${stat.size}:${stat.mtimeMs}`;
        if (signature !== previousSignature) {
          previousSignature = signature;
          const responseText = await findTranscriptResponse({
            transcriptPath,
            requestFingerprint: options.requestFingerprint,
            afterTimestampMs: options.afterTimestampMs,
          });
          if (responseText) {
            return responseText;
          }
        }
      } catch {
        transcriptPath = null;
        previousSignature = null;
      }
    }

    const remainingMs = maxWaitMs - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      return null;
    }
    const completedDelay = await waitForDelay(
      Math.min(pollIntervalMs, remainingMs),
      options.signal,
    );
    if (!completedDelay) {
      return null;
    }
  }
  return null;
}

module.exports = {
  assistantText,
  contentCandidates,
  findSessionResponse,
  findTranscriptResponse,
  fingerprintText,
  normalizeText,
  resolveSessionTranscriptPath,
  waitForSessionResponse,
};

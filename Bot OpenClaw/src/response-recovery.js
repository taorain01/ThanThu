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

async function findSessionResponse(sessionsDir, sessionKey, options) {
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
    return findTranscriptResponse({
      transcriptPath,
      requestFingerprint: options.requestFingerprint,
      afterTimestampMs: options.afterTimestampMs,
    });
  } catch {
    return null;
  }
}

module.exports = {
  assistantText,
  contentCandidates,
  findSessionResponse,
  findTranscriptResponse,
  fingerprintText,
  normalizeText,
};

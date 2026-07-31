'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const READ_CHUNK_BYTES = 64 * 1024;

function tokenCount(value) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function usageFromRecord(record) {
  const usage = record?.message?.usage || record?.usage;
  const totalTokens = tokenCount(usage?.totalTokens);
  if (totalTokens === null) {
    return null;
  }
  return {
    totalTokens,
    updatedAt: record.timestamp || record.message?.timestamp || null,
  };
}

function usageFromLine(line) {
  const text = line.toString('utf8').trim();
  if (!text) {
    return null;
  }
  try {
    return usageFromRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

async function readLatestTranscriptUsage(filePath) {
  let handle;
  try {
    handle = await fs.open(filePath, 'r');
    const stat = await handle.stat();
    let position = stat.size;
    let trailing = Buffer.alloc(0);

    // Scan complete JSONL records backward so large transcripts do not need to be loaded at once.
    while (position > 0) {
      const length = Math.min(READ_CHUNK_BYTES, position);
      position -= length;
      const chunk = Buffer.alloc(length);
      const { bytesRead } = await handle.read(chunk, 0, length, position);
      const combined = Buffer.concat([chunk.subarray(0, bytesRead), trailing]);
      let lineEnd = combined.length;

      for (let index = combined.length - 1; index >= 0; index -= 1) {
        if (combined[index] !== 0x0a) {
          continue;
        }
        const usage = usageFromLine(combined.subarray(index + 1, lineEnd));
        if (usage) {
          return usage;
        }
        lineEnd = index;
      }
      trailing = combined.subarray(0, lineEnd);
    }
    return usageFromLine(trailing);
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readSessionContextUsage(sessionsDir, sessionKey) {
  try {
    const index = JSON.parse(await fs.readFile(path.join(sessionsDir, 'sessions.json'), 'utf8'));
    const entry = index?.[sessionKey];
    if (!entry) {
      return null;
    }

    const contextTokens = tokenCount(
      entry.contextTokens ?? entry.contextBudgetStatus?.contextTokenBudget,
    );
    const storedTokens = tokenCount(entry.totalTokens);
    if (entry.totalTokensFresh === true && storedTokens !== null) {
      return {
        usedTokens: storedTokens,
        contextTokens,
        source: 'session',
        updatedAt: entry.updatedAt || null,
      };
    }

    const sessionId = String(entry.sessionId || '').trim();
    const transcriptPath = entry.sessionFile
      || (sessionId ? path.join(sessionsDir, `${sessionId}.jsonl`) : null);
    const transcriptUsage = transcriptPath
      ? await readLatestTranscriptUsage(transcriptPath)
      : null;
    return {
      usedTokens: transcriptUsage?.totalTokens ?? null,
      contextTokens,
      source: transcriptUsage ? 'transcript' : 'unavailable',
      updatedAt: transcriptUsage?.updatedAt || entry.updatedAt || null,
    };
  } catch {
    return null;
  }
}

module.exports = {
  readLatestTranscriptUsage,
  readSessionContextUsage,
  usageFromRecord,
};

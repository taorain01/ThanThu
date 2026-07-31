'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  readLatestTranscriptUsage,
  readSessionContextUsage,
} = require('../src/session-context');

async function fixture(t) {
  const sessionsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-openclaw-context-'));
  t.after(() => fs.rm(sessionsDir, { recursive: true, force: true }));
  return sessionsDir;
}

test('đọc snapshot context chính xác khi session đánh dấu usage còn mới', async (t) => {
  const sessionsDir = await fixture(t);
  const sessionKey = 'agent:main:openai-user:discord:guild:channel:1';
  await fs.writeFile(path.join(sessionsDir, 'sessions.json'), JSON.stringify({
    [sessionKey]: {
      sessionId: 'session-fresh',
      contextTokens: 200000,
      totalTokens: 47218,
      totalTokensFresh: true,
      updatedAt: 123456,
    },
  }));

  assert.deepEqual(await readSessionContextUsage(sessionsDir, sessionKey), {
    usedTokens: 47218,
    contextTokens: 200000,
    source: 'session',
    updatedAt: 123456,
  });
});

test('fallback về usage provider gần nhất trong transcript khi snapshot đã cũ', async (t) => {
  const sessionsDir = await fixture(t);
  const sessionKey = 'agent:main:openai-user:discord:guild:channel:2';
  const transcriptPath = path.join(sessionsDir, 'session-stale.jsonl');
  const records = [
    { type: 'message', timestamp: '2026-08-01T00:00:00.000Z', message: { role: 'assistant', usage: { totalTokens: 41000 } } },
    { type: 'message', timestamp: '2026-08-01T00:01:00.000Z', message: { role: 'assistant', usage: { totalTokens: 46907 } } },
    { type: 'message', message: { role: 'toolResult', content: 'đ'.repeat(70000) } },
  ];
  await fs.writeFile(transcriptPath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
  await fs.writeFile(path.join(sessionsDir, 'sessions.json'), JSON.stringify({
    [sessionKey]: {
      sessionId: 'session-stale',
      sessionFile: transcriptPath,
      contextTokens: 200000,
      totalTokens: 45000,
      totalTokensFresh: false,
    },
  }));

  assert.deepEqual(await readLatestTranscriptUsage(transcriptPath), {
    totalTokens: 46907,
    updatedAt: '2026-08-01T00:01:00.000Z',
  });
  assert.deepEqual(await readSessionContextUsage(sessionsDir, sessionKey), {
    usedTokens: 46907,
    contextTokens: 200000,
    source: 'transcript',
    updatedAt: '2026-08-01T00:01:00.000Z',
  });
});

test('chỉ trả giới hạn context khi chưa có usage chính xác', async (t) => {
  const sessionsDir = await fixture(t);
  const sessionKey = 'agent:main:openai-user:discord:guild:channel:3';
  await fs.writeFile(path.join(sessionsDir, 'sessions.json'), JSON.stringify({
    [sessionKey]: {
      sessionId: 'session-empty',
      contextBudgetStatus: { contextTokenBudget: 128000 },
    },
  }));

  assert.deepEqual(await readSessionContextUsage(sessionsDir, sessionKey), {
    usedTokens: null,
    contextTokens: 128000,
    source: 'unavailable',
    updatedAt: null,
  });
  assert.equal(await readSessionContextUsage(sessionsDir, 'missing'), null);
});

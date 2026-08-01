'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  findSessionResponse,
  findTranscriptResponse,
  fingerprintText,
  waitForSessionResponse,
} = require('../src/response-recovery');

async function fixture(t) {
  const sessionsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-openclaw-response-'));
  t.after(() => fs.rm(sessionsDir, { recursive: true, force: true }));
  return sessionsDir;
}

test('tìm đúng phản hồi final sau user message khớp fingerprint', async (t) => {
  const sessionsDir = await fixture(t);
  const transcriptPath = path.join(sessionsDir, 'session.jsonl');
  const records = [
    { type: 'message', timestamp: '2026-08-01T00:00:00.000Z', message: { role: 'user', content: 'Yêu cầu cũ' } },
    { type: 'message', timestamp: '2026-08-01T00:00:02.000Z', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Phản hồi cũ' }] } },
    { type: 'message', timestamp: '2026-08-01T00:01:00.000Z', message: { role: 'user', content: 'Yêu cầu cần khôi phục' } },
    { type: 'message', timestamp: '2026-08-01T00:01:02.000Z', message: { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'text', text: 'Đang làm' }] } },
    { type: 'message', timestamp: '2026-08-01T00:01:03.000Z', message: { role: 'toolResult', content: 'xong' } },
    { type: 'message', timestamp: '2026-08-01T00:01:04.000Z', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Phản hồi chính xác' }] } },
  ];
  await fs.writeFile(transcriptPath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);

  assert.equal(await findTranscriptResponse({
    transcriptPath,
    requestFingerprint: fingerprintText('Yêu cầu cần khôi phục'),
    afterTimestampMs: Date.parse('2026-08-01T00:00:30.000Z'),
  }), 'Phản hồi chính xác');
});

test('khớp text part của user content có ảnh và resolve transcript từ session index', async (t) => {
  const sessionsDir = await fixture(t);
  const sessionKey = 'agent:main:openai-user:discord:guild:channel:1';
  const transcriptPath = path.join(sessionsDir, 'image-session.jsonl');
  await fs.writeFile(transcriptPath, [
    JSON.stringify({
      type: 'message',
      timestamp: '2026-08-01T00:02:00.000Z',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'Xem ảnh này' },
          { type: 'text', text: '[Có 1 ảnh đính kèm.]' },
          { type: 'image', source: 'ẩn' },
        ],
      },
    }),
    JSON.stringify({
      type: 'message',
      timestamp: '2026-08-01T00:02:05.000Z',
      message: { role: 'assistant', stopReason: 'stop', content: 'Đã xem ảnh.' },
    }),
  ].join('\n'));
  await fs.writeFile(path.join(sessionsDir, 'sessions.json'), JSON.stringify({
    [sessionKey]: { sessionId: 'image-session', sessionFile: transcriptPath },
  }));

  assert.equal(await findSessionResponse(sessionsDir, sessionKey, {
    requestFingerprint: fingerprintText('Xem ảnh này'),
    afterTimestampMs: 0,
  }), 'Đã xem ảnh.');
});

test('vẫn khớp request khi OpenClaw nối thêm một dòng nội bộ vào user message', async (t) => {
  const sessionsDir = await fixture(t);
  const transcriptPath = path.join(sessionsDir, 'appended-user-line.jsonl');
  const requestText = 'Kiểm tra và báo trực tiếp tiến độ cho tôi.';
  await fs.writeFile(transcriptPath, [
    JSON.stringify({
      type: 'message',
      timestamp: '2026-08-01T00:01:00.000Z',
      message: {
        role: 'user',
        content: `${requestText}\n[Dòng ngữ cảnh nội bộ do OpenClaw nối thêm]`,
      },
    }),
    JSON.stringify({
      type: 'message',
      timestamp: '2026-08-01T00:01:02.000Z',
      message: { role: 'assistant', stopReason: 'stop', content: 'Đã hoàn tất.' },
    }),
    '',
  ].join('\n'), 'utf8');

  assert.equal(await findTranscriptResponse({
    transcriptPath,
    requestFingerprint: fingerprintText(requestText),
    afterTimestampMs: Date.parse('2026-08-01T00:00:59.000Z'),
  }), 'Đã hoàn tất.');
});

test('không lấy phản hồi khi request không khớp hoặc chỉ mới toolUse', async (t) => {
  const sessionsDir = await fixture(t);
  const transcriptPath = path.join(sessionsDir, 'incomplete.jsonl');
  await fs.writeFile(transcriptPath, [
    JSON.stringify({ type: 'message', message: { role: 'user', content: 'Đúng request' } }),
    JSON.stringify({ type: 'message', message: { role: 'assistant', stopReason: 'toolUse', content: 'Chưa xong' } }),
  ].join('\n'));

  assert.equal(await findTranscriptResponse({
    transcriptPath,
    requestFingerprint: fingerprintText('Request khác'),
  }), null);
  assert.equal(await findTranscriptResponse({
    transcriptPath,
    requestFingerprint: fingerprintText('Đúng request'),
  }), null);
});

test('chờ transcript ghi final rồi trả phản hồi ngay', async (t) => {
  const sessionsDir = await fixture(t);
  const sessionKey = 'agent:main:openai-user:discord:guild:channel:2';
  const transcriptPath = path.join(sessionsDir, 'live-session.jsonl');
  await fs.writeFile(path.join(sessionsDir, 'sessions.json'), JSON.stringify({
    [sessionKey]: { sessionId: 'live-session', sessionFile: transcriptPath },
  }));
  await fs.writeFile(transcriptPath, [
    JSON.stringify({
      type: 'message',
      timestamp: '2026-08-01T00:03:00.000Z',
      message: { role: 'user', content: 'Phản hồi ngay khi xong' },
    }),
    JSON.stringify({
      type: 'message',
      timestamp: '2026-08-01T00:03:01.000Z',
      message: { role: 'assistant', stopReason: 'toolUse', content: 'Đang xử lý' },
    }),
  ].join('\n'));

  const appendFinal = setTimeout(() => fs.appendFile(transcriptPath, [
    '',
    JSON.stringify({
      type: 'message',
      timestamp: '2026-08-01T00:03:02.000Z',
      message: { role: 'assistant', stopReason: 'stop', content: 'Đã hoàn tất sớm.' },
    }),
  ].join('\n')), 30);
  t.after(() => clearTimeout(appendFinal));

  assert.equal(await waitForSessionResponse(sessionsDir, sessionKey, {
    requestFingerprint: fingerprintText('Phản hồi ngay khi xong'),
    afterTimestampMs: Date.parse('2026-08-01T00:02:59.000Z'),
    pollIntervalMs: 10,
    maxWaitMs: 500,
  }), 'Đã hoàn tất sớm.');
});

test('dừng chờ transcript ngay khi signal bị hủy', async (t) => {
  const sessionsDir = await fixture(t);
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 20);
  t.after(() => clearTimeout(abortTimer));

  assert.equal(await waitForSessionResponse(sessionsDir, 'session-không-tồn-tại', {
    requestFingerprint: fingerprintText('Không cần chờ lâu'),
    pollIntervalMs: 100,
    maxWaitMs: 5000,
    signal: controller.signal,
  }), null);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  OpenClawSessionMonitor,
  extractActivityEvents,
  formatFinishedActivity,
  formatLiveActivity,
  mediaFromAssistantText,
  sanitizeActivityText,
  sanitizeInline,
} = require('../src/session-activity');

function transcriptMessage(message) {
  return JSON.stringify({ type: 'message', id: crypto.randomUUID(), message });
}

test('chuyển tool call và kết quả thành nhật ký an toàn', () => {
  const callEvents = extractActivityEvents({
    type: 'message',
    message: {
      role: 'assistant',
      stopReason: 'toolUse',
      content: [{
        type: 'toolCall',
        name: 'exec',
        arguments: { command: 'openclaw.cmd nodes invoke --command screen.snapshot --token sk-secretsecretsecret' },
      }],
    },
  });
  const resultEvents = extractActivityEvents({
    type: 'message',
    message: { role: 'toolResult', toolName: 'exec', isError: false, content: [] },
  });

  assert.match(callEvents[0].text, /chụp màn hình Windows/);
  assert.equal(callEvents[0].text.includes('sk-secret'), false);
  assert.equal(resultEvents[0].text, '✓ `exec` hoàn tất');
});

test('ẩn token, đường dẫn và dữ liệu dài', () => {
  const safe = sanitizeInline(
    `Bearer abcdef C:\\Users\\songt\\secret\\file.txt ${'A'.repeat(220)}`,
  );
  assert.equal(safe.includes('abcdef'), false);
  assert.equal(safe.includes('secret\\file.txt'), false);
  assert.equal(safe.includes('A'.repeat(100)), false);
  assert.match(safe, /REDACTED/);
  const direct = sanitizeActivityText(`Dòng một\nDòng hai sk-secretsecretsecret`);
  assert.match(direct, /Dòng một\nDòng hai/);
  assert.equal(direct.includes('sk-secret'), false);
});

test('định dạng tiến độ và tách nhật ký dài', () => {
  assert.match(formatLiveActivity([], 12000), /đang làm việc/i);
  const events = Array.from({ length: 30 }, (_, index) => `▶ \`exec\` — bước ${index} ${'x'.repeat(80)}`);
  const finished = formatFinishedActivity(events, 65000, 'completed', 500);
  assert.ok(finished.panel.length <= 500);
  assert.match(finished.overflow, /Nhật ký phiên đầy đủ/);
  assert.match(finished.overflow, /bước 29/);
});

test('lấy MEDIA từ câu trả lời cuối mà không đưa đường dẫn vào nhật ký', () => {
  assert.deepEqual(
    mediaFromAssistantText('Đã xong.\nMEDIA:C:\\Users\\test\\screen.png'),
    ['C:\\Users\\test\\screen.png'],
  );
  const events = extractActivityEvents({
    type: 'message',
    message: {
      role: 'assistant',
      stopReason: 'stop',
      content: [{ type: 'text', text: 'Đã xong.\nMEDIA:C:\\Users\\test\\screen.png' }],
    },
  });
  assert.equal(events[0].text, '💬 Đã xong.');
  assert.equal(events[0].notificationText, 'Đã xong.');
  assert.equal(events[0].kind, 'assistant');
  assert.equal(events[0].final, true);
  assert.deepEqual(events[0].mediaReferences, ['C:\\Users\\test\\screen.png']);
  assert.equal(events[0].mediaLabel, 'Đã xong.');
});

test('nhận phản hồi assistant dạng chuỗi để relay trực tiếp', () => {
  const events = extractActivityEvents({
    type: 'message',
    message: {
      role: 'assistant',
      stopReason: 'stop',
      content: 'Sub-agent đã hoàn tất.',
    },
  });

  assert.equal(events[0].notificationText, 'Sub-agent đã hoàn tất.');
  assert.equal(events[0].final, true);
});

test('nhận MEDIA trong toolUse nhưng không lấy ảnh từ tham số tool image', () => {
  const events = extractActivityEvents({
    type: 'message',
    message: {
      role: 'assistant',
      stopReason: 'toolUse',
      content: [
        { type: 'text', text: 'Ảnh 1 đã sẵn sàng.\nMEDIA:F:\\Hình Ảnh\\anhYoutube\\01.png' },
        { type: 'toolCall', name: 'image', arguments: { image: 'C:\\screen-check.png' } },
      ],
    },
  });
  assert.deepEqual(events[0].mediaReferences, ['F:\\Hình Ảnh\\anhYoutube\\01.png']);
  assert.match(events[0].text, /Ảnh 1 đã sẵn sàng/);
  assert.deepEqual(events[1].mediaReferences, []);
});

test('theo dõi các dòng transcript mới mà không phát lại lịch sử cũ', async (t) => {
  const sessionsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-openclaw-session-'));
  t.after(() => fs.rm(sessionsDir, { recursive: true, force: true }));
  const sessionKey = 'agent:main:openai-user:discord:guild:channel:1';
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const transcriptPath = path.join(sessionsDir, `${sessionId}.jsonl`);
  await fs.writeFile(path.join(sessionsDir, 'sessions.json'), JSON.stringify({
    [sessionKey]: { sessionId },
  }));
  await fs.writeFile(transcriptPath, `${transcriptMessage({
    role: 'toolResult', toolName: 'old', isError: false, content: [],
  })}\n`);

  const events = [];
  const monitor = new OpenClawSessionMonitor({
    sessionsDir,
    sessionKey,
    pollIntervalMs: 60000,
    onEvent: (event) => events.push(event),
  });
  await monitor.start();
  await fs.appendFile(transcriptPath, `${transcriptMessage({
    role: 'assistant',
    stopReason: 'toolUse',
    content: [{
      type: 'toolCall',
      name: 'image',
      arguments: { image: 'C:\\screen.png' },
    }],
  })}\n${transcriptMessage({
    role: 'toolResult', toolName: 'image', isError: false, content: [],
  })}\n`);
  await monitor.stop();

  assert.deepEqual(events.map((event) => event.text), [
    '▶ `image` — phân tích ảnh',
    '✓ `image` hoàn tất',
  ]);
  assert.deepEqual(events[0].mediaReferences, []);
});

test('bỏ qua record cũ theo timestamp nhưng vẫn commit offset', async (t) => {
  const sessionsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-openclaw-session-time-'));
  t.after(() => fs.rm(sessionsDir, { recursive: true, force: true }));
  const sessionKey = 'agent:main:subagent:timestamp-child';
  const transcriptPath = path.join(sessionsDir, 'timestamp-child.jsonl');
  const cutoff = Date.now();
  await fs.writeFile(path.join(sessionsDir, 'sessions.json'), JSON.stringify({
    [sessionKey]: { sessionId: 'timestamp-child', sessionFile: transcriptPath },
  }));
  await fs.writeFile(transcriptPath, [
    JSON.stringify({
      type: 'message',
      timestamp: cutoff - 1000,
      message: { role: 'toolResult', toolName: 'old', isError: false, content: [] },
    }),
    JSON.stringify({
      type: 'message',
      timestamp: cutoff + 1000,
      message: { role: 'toolResult', toolName: 'new', isError: false, content: [] },
    }),
    '',
  ].join('\n'), 'utf8');

  const events = [];
  let offset = 0;
  const monitor = new OpenClawSessionMonitor({
    sessionsDir,
    sessionKey,
    startAtEnd: false,
    afterTimestampMs: cutoff,
    pollIntervalMs: 60000,
    onEvent: (event) => events.push(event.text),
    onOffset: (value) => { offset = value; },
  });
  await monitor.start();
  await monitor.stop();

  assert.deepEqual(events, ['✓ `new` hoàn tất']);
  assert.equal(offset, (await fs.stat(transcriptPath)).size);
});

test('không commit offset nếu xử lý event lỗi để lần poll sau không mất MEDIA', async (t) => {
  const sessionsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-openclaw-session-retry-'));
  t.after(() => fs.rm(sessionsDir, { recursive: true, force: true }));
  const sessionKey = 'agent:main:subagent:retry-child';
  const transcriptPath = path.join(sessionsDir, 'retry-child.jsonl');
  await fs.writeFile(path.join(sessionsDir, 'sessions.json'), JSON.stringify({
    [sessionKey]: { sessionId: 'retry-child', sessionFile: transcriptPath },
  }));
  await fs.writeFile(transcriptPath, `${transcriptMessage({
    role: 'assistant',
    stopReason: 'toolUse',
    content: [{ type: 'text', text: 'Ảnh đã xong.\nMEDIA:F:\\Hình Ảnh\\anhYoutube\\retry.png' }],
  })}\n`, 'utf8');

  let shouldFail = true;
  let savedOffset = 0;
  const received = [];
  const monitor = new OpenClawSessionMonitor({
    sessionsDir,
    sessionKey,
    startAtEnd: false,
    pollIntervalMs: 60000,
    onOffset: (offset) => { savedOffset = offset; },
    onEvent: (event) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error('disk busy');
      }
      received.push(...event.mediaReferences);
    },
  });
  await monitor.start();
  await assert.rejects(() => monitor.poll(), /disk busy/);
  assert.equal(savedOffset, 0);
  await monitor.poll();
  await monitor.stop();

  assert.deepEqual(received, ['F:\\Hình Ảnh\\anhYoutube\\retry.png']);
  assert.equal(savedOffset, (await fs.stat(transcriptPath)).size);
});

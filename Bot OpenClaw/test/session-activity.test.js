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
  assert.equal(events[0].text, '');
  assert.deepEqual(events[0].mediaReferences, ['C:\\Users\\test\\screen.png']);
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
  assert.deepEqual(events[0].mediaReferences, ['C:\\screen.png']);
});

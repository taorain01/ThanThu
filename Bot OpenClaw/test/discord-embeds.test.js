'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COLORS,
  EMBED_LIMITS,
  RESPONSE_DESCRIPTION_LIMIT,
  buildJobStatusEmbed,
  buildResponseEmbeds,
  splitEmbedDescription,
} = require('../src/discord-embeds');

function normalizeWhitespace(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

function assertEmbedLimits(embed) {
  const data = embed.toJSON();
  assert.ok(embed.length <= EMBED_LIMITS.total);
  assert.ok((data.title || '').length <= EMBED_LIMITS.title);
  assert.ok((data.description || '').length <= EMBED_LIMITS.description);
  assert.ok((data.footer?.text || '').length <= EMBED_LIMITS.footer);
  assert.ok((data.fields || []).length <= EMBED_LIMITS.fields);
  for (const field of data.fields || []) {
    assert.ok(field.name.length <= EMBED_LIMITS.fieldName);
    assert.ok(field.value.length <= EMBED_LIMITS.fieldValue);
  }
}

function createJob(status, overrides = {}) {
  return {
    id: 'job-123456789',
    channelId: '987654321',
    status,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T01:02:03.000Z',
    tasks: {
      subagent: {
        taskId: 'subagent',
        runId: 'run-current',
        status: 'running',
        label: 'Tạo ảnh minh họa',
        progressSummary: 'Đang kiểm tra bố cục cuối',
        createdAt: Date.parse('2026-08-01T01:10:00.000Z'),
        lastEventAt: Date.parse('2026-08-01T01:29:00.000Z'),
      },
      cli: {
        taskId: 'cli',
        runId: 'run-current',
        status: 'running',
        createdAt: Date.parse('2026-08-01T01:10:00.000Z'),
        lastEventAt: Date.parse('2026-08-01T01:29:00.000Z'),
      },
      done: {
        taskId: 'done',
        runId: 'run-done',
        status: 'succeeded',
        label: 'Thu thập dữ liệu',
        createdAt: Date.parse('2026-08-01T00:30:00.000Z'),
        endedAt: Date.parse('2026-08-01T01:00:00.000Z'),
      },
    },
    events: ['▶ `browser` — mở trang', '✓ `browser` hoàn tất'],
    terminalReason: '',
    ...overrides,
  };
}

test('dùng nội dung dự phòng khi OpenClaw trả về rỗng', () => {
  assert.deepEqual(splitEmbedDescription('   '), ['OpenClaw không trả về nội dung.']);
});

test('giữ nội dung đúng ngưỡng trong một embed', () => {
  const text = 'x'.repeat(RESPONSE_DESCRIPTION_LIMIT);
  assert.deepEqual(splitEmbedDescription(text), [text]);
});

test('chia phản hồi dài theo đoạn và giữ đúng thứ tự', () => {
  const text = Array.from(
    { length: 500 },
    (_, index) => `Đoạn ${index}: nội dung phản hồi từ OpenClaw.`,
  ).join('\n\n');
  const chunks = splitEmbedDescription(text);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.every((chunk) => chunk.length <= RESPONSE_DESCRIPTION_LIMIT), true);
  assert.equal(normalizeWhitespace(chunks.join(' ')), normalizeWhitespace(text));
});

test('cắt cứng chuỗi dài không có khoảng trắng', () => {
  const text = 'A'.repeat(RESPONSE_DESCRIPTION_LIMIT * 3 + 25);
  const chunks = splitEmbedDescription(text);
  assert.ok(chunks.length >= 4);
  assert.equal(chunks.every((chunk) => chunk.length <= RESPONSE_DESCRIPTION_LIMIT), true);
  assert.equal(chunks.join(''), text);
});

test('tự đóng và mở lại code fence giữa các embed', () => {
  const text = [
    'Ví dụ mã nguồn:',
    '```js',
    ...Array.from({ length: 500 }, (_, index) => `const dongCode${index} = ${index};`),
    '```',
    'Kết thúc phản hồi.',
  ].join('\n');
  const chunks = splitEmbedDescription(text);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    const fenceCount = (chunk.match(/```/g) || []).length;
    assert.equal(fenceCount % 2, 0);
    assert.ok(chunk.length <= RESPONSE_DESCRIPTION_LIMIT);
  }
  const combined = chunks.join('\n');
  assert.match(combined, /dongCode0/);
  assert.match(combined, /dongCode499/);
  assert.match(combined, /Kết thúc phản hồi/);
});

test('dựng chuỗi embed phản hồi có nhận diện, phân trang và giới hạn an toàn', () => {
  const embeds = buildResponseEmbeds('Nội dung.\n\n'.repeat(1500), {
    jobId: '123456789012345678',
    botName: 'OPENCLAW // ASSISTANT',
    botIconUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
    timestamp: '2026-08-01T01:02:03.000Z',
  });
  assert.ok(embeds.length > 1);
  for (const [index, embed] of embeds.entries()) {
    const data = embed.toJSON();
    assertEmbedLimits(embed);
    assert.equal(data.color, COLORS.response);
    assert.match(data.author.name, /OPENCLAW/);
    assert.match(data.footer.text, new RegExp(`Phần ${index + 1}/${embeds.length}`));
    assert.equal(data.timestamp, '2026-08-01T01:02:03.000Z');
  }
});

test('dựng embed hợp lệ cho mọi trạng thái job', () => {
  const statuses = [
    'queued',
    'running',
    'background',
    'recovering',
    'completed',
    'completed_with_blocker',
    'failed',
    'stopped',
  ];
  for (const status of statuses) {
    const embed = buildJobStatusEmbed(createJob(status), {
      counts: { delivered: 2, total: 4, ready: 1 },
      contextUsage: {
        usedTokens: 46907,
        contextTokens: 200000,
        source: 'transcript',
      },
      queuePosition: status === 'queued' ? 2 : null,
      queuePending: 5,
      activeSessions: 2,
      maxConcurrentSessions: 2,
      prefix: '>',
      botName: 'OPENCLAW // JOB MONITOR',
      botIconUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
      now: Date.parse('2026-08-01T01:30:00.000Z'),
      heartbeatMs: 60000,
    });
    const data = embed.toJSON();
    assertEmbedLimits(embed);
    assert.equal(data.color, COLORS[status]);
    assert.match(data.description, /job-123456789/);
    assert.ok(data.fields.some((field) => field.name.includes('Thời gian')));
    assert.ok(data.fields.some((field) => field.name.includes('File')));
    assert.ok(data.fields.some((field) => field.name.includes('Worker')));
    assert.ok(data.fields.some((field) => field.name.includes('Task hiện tại')));
    const contextField = data.fields.find((field) => field.name.includes('Context'));
    assert.match(contextField.value, /46,907 \/ 200,000 token \(23\.5%\)/);
    assert.match(contextField.value, /chính xác/);
    if (status === 'queued') {
      const queueField = data.fields.find((field) => field.name.includes('Hàng đợi'));
      assert.match(queueField.value, /2\/5/);
      assert.match(queueField.value, /2\/2 session đang chạy/);
    }
  }
});

test('gộp record cùng runId và hiển thị task hiện tại theo heartbeat', () => {
  const now = Date.parse('2026-08-01T01:30:00.000Z');
  const embed = buildJobStatusEmbed(createJob('background'), {
    counts: { delivered: 1, total: 2, ready: 1 },
    prefix: '>',
    now,
    heartbeatMs: 60000,
  });
  const data = embed.toJSON();
  const workerField = data.fields.find((field) => field.name.includes('Worker'));
  const taskField = data.fields.find((field) => field.name.includes('Task hiện tại'));

  assert.equal(workerField.value, '1 đang chạy • 1 xong • 0 lỗi');
  assert.match(taskField.value, /Worker 2 · Tạo ảnh minh họa/);
  assert.match(taskField.value, /1 phút trước/);
  assert.match(taskField.value, /Đang kiểm tra bố cục cuối/);
  assert.equal(data.footer.text, 'Heartbeat 60s • Dừng: > o stop (hoặc > openclaw stop)');
  assert.equal(data.timestamp, '2026-08-01T01:30:00.000Z');
});

test('mô tả hợp lý khi job chưa có worker', () => {
  const queued = buildJobStatusEmbed(createJob('queued', { tasks: {} })).toJSON();
  const running = buildJobStatusEmbed(createJob('running', { tasks: {} })).toJSON();
  const background = buildJobStatusEmbed(createJob('background', { tasks: {} })).toJSON();

  assert.match(queued.fields.find((field) => field.name.includes('Task hiện tại')).value, /Chưa khởi chạy/);
  assert.match(running.fields.find((field) => field.name.includes('Task hiện tại')).value, /Agent chính đang xử lý/);
  assert.match(background.fields.find((field) => field.name.includes('Task hiện tại')).value, /Đang tổng hợp kết quả/);
});

test('rút gọn nhật ký và kết quả dài mà không vượt giới hạn field', () => {
  const embed = buildJobStatusEmbed(createJob('failed', {
    events: Array.from({ length: 30 }, (_, index) => `Bước ${index}: ${'x'.repeat(300)}`),
    terminalReason: `Không thể hoàn tất: ${'y'.repeat(3000)}`,
  }), {
    counts: { delivered: 8, total: 10, ready: 2 },
    prefix: '>',
  });
  const data = embed.toJSON();
  assertEmbedLimits(embed);
  assert.ok(data.fields.some((field) => field.name.includes('Chi tiết lỗi')));
  assert.ok(data.fields.every((field) => field.value.length <= EMBED_LIMITS.fieldValue));
});

test('bảng tiến độ không lộ token hoặc đường dẫn cục bộ', () => {
  const embed = buildJobStatusEmbed(createJob('failed', {
    events: ['Đọc C:\\Users\\songt\\secret\\checkpoint.json bằng Bearer abc-secret'],
    terminalReason: 'Lỗi sk-secretsecretsecret tại F:\\Hình Ảnh\\anhYoutube\\01.png',
    tasks: {
      sensitive: {
        taskId: 'sensitive',
        status: 'failed',
        label: 'Đọc C:\\Users\\songt\\secret\\worker.txt',
        progressSummary: 'Bearer task-secret tại F:\\Hình Ảnh\\anhYoutube\\worker.png',
      },
    },
  }), {
    counts: { delivered: 0, total: 1, ready: 1 },
  });
  const serialized = JSON.stringify(embed.toJSON());
  assert.equal(serialized.includes('checkpoint.json'), false);
  assert.equal(serialized.includes('anhYoutube'), false);
  assert.equal(serialized.includes('abc-secret'), false);
  assert.equal(serialized.includes('task-secret'), false);
  assert.equal(serialized.includes('sk-secret'), false);
});

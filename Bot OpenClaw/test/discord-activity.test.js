'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildActivityMessages,
  isRootTranscriptFinal,
  shouldSendActivity,
} = require('../src/discord-activity');

const job = { id: '1533010068075970710' };

test('không gửi trùng phản hồi final của phiên chính từ transcript', () => {
  const event = {
    origin: 'transcript',
    isRoot: true,
    kind: 'assistant',
    final: true,
    notificationText: 'Đã hoàn tất.',
  };
  assert.equal(isRootTranscriptFinal(event), true);
  assert.equal(shouldSendActivity(event), false);
  assert.deepEqual(buildActivityMessages(job, event), []);
});

test('gửi trực tiếp cập nhật chính, tool và phản hồi final của sub-agent', () => {
  const main = buildActivityMessages(job, {
    origin: 'transcript',
    isRoot: true,
    kind: 'assistant',
    final: false,
    notificationText: 'Mình đang kiểm tra dữ liệu.',
  });
  const tool = buildActivityMessages(job, {
    origin: 'transcript',
    isRoot: false,
    kind: 'tool_call',
    text: '▶ `browser` — snapshot',
  });
  const child = buildActivityMessages(job, {
    origin: 'transcript',
    isRoot: false,
    sourceLabel: 'Worker tạo ảnh 0012',
    kind: 'assistant',
    final: true,
    notificationText: 'Đã xử lý xong toàn bộ checkpoint.',
  });

  assert.match(main[0], /Cập nhật từ OpenClaw chính/);
  assert.match(tool[0], /Thao tác của sub-agent/);
  assert.match(child[0], /Phản hồi từ Worker tạo ảnh 0012/);
  assert.match(child[0], /checkpoint/);
});

test('chia phản hồi dài thành nhiều tin nhắn có nhãn tiếp', () => {
  const messages = buildActivityMessages(job, {
    origin: 'transcript',
    isRoot: false,
    kind: 'assistant',
    final: true,
    notificationText: 'nội dung '.repeat(300),
  }, 300);

  assert.ok(messages.length > 1);
  assert.equal(messages.every((message) => message.length <= 300), true);
  assert.match(messages[1], /\(tiếp\)/);
});

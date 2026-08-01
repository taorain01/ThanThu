'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isAuxiliarySessionActivity,
  isRootTranscriptFinal,
  sessionActivityRecord,
} = require('../src/discord-activity');

test('không gửi trùng phản hồi final của phiên chính từ transcript', () => {
  const event = {
    origin: 'transcript',
    isRoot: true,
    kind: 'assistant',
    final: true,
    notificationText: 'Đã hoàn tất.',
  };
  assert.equal(isRootTranscriptFinal(event), true);
  assert.equal(isAuxiliarySessionActivity(event), false);
  assert.equal(sessionActivityRecord(event), null);
});

test('chỉ đưa hoạt động của session phụ vào bản ghi embed riêng', () => {
  const main = sessionActivityRecord({
    origin: 'transcript',
    isRoot: true,
    kind: 'assistant',
    final: false,
    notificationText: 'Mình đang kiểm tra dữ liệu.',
  });
  const tool = sessionActivityRecord({
    origin: 'transcript',
    isRoot: false,
    sessionKey: 'agent:main:subagent:worker-1',
    kind: 'tool_call',
    text: '▶ `browser` — snapshot',
  });
  const child = sessionActivityRecord({
    origin: 'transcript',
    isRoot: false,
    sessionKey: 'agent:main:subagent:worker-1',
    sourceLabel: 'Worker tạo ảnh 0012',
    kind: 'assistant',
    final: true,
    notificationText: 'Đã xử lý xong toàn bộ checkpoint.',
  });

  assert.equal(main, null);
  assert.equal(tool.kind, 'tool_call');
  assert.match(tool.text, /browser/);
  assert.equal(child.label, 'Worker tạo ảnh 0012');
  assert.equal(child.final, true);
  assert.match(child.text, /checkpoint/);
});

test('lọc dữ liệu nhạy cảm và giới hạn nội dung trước khi lưu vào embed session phụ', () => {
  const record = sessionActivityRecord({
    origin: 'transcript',
    isRoot: false,
    sessionKey: 'agent:main:subagent:worker-2',
    kind: 'assistant',
    final: true,
    notificationText: `Bearer secret-token C:\\Users\\songt\\secret\\file.txt ${'nội dung '.repeat(800)}`,
  });

  assert.ok(record.text.length <= 4000);
  assert.equal(record.text.includes('secret-token'), false);
  assert.equal(record.text.includes('file.txt'), false);
});

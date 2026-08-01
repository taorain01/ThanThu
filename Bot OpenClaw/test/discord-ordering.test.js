'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RESPONSE_PRIORITY_MS,
  responseCanYieldToActivity,
  shouldMoveStatusToBottom,
} = require('../src/discord-ordering');

const responseSentAt = '2026-08-01T08:00:00.000Z';
const responseSentAtMs = Date.parse(responseSentAt);

function job(overrides = {}) {
  return {
    status: 'background',
    responseSent: true,
    responseSentAt,
    lastActivityAt: '2026-08-01T08:00:30.000Z',
    ...overrides,
  };
}

test('giữ phản hồi ở cuối trong hai phút dù task có cập nhật mới', () => {
  assert.equal(responseCanYieldToActivity(
    job(),
    responseSentAtMs + RESPONSE_PRIORITY_MS - 1,
  ), false);
  assert.equal(shouldMoveStatusToBottom({
    job: job(),
    statusMessageId: 'status',
    lastMessageId: 'response',
    lastMessageIsBot: true,
    now: responseSentAtMs + RESPONSE_PRIORITY_MS - 1,
  }), false);
});

test('task mới đưa status xuống cuối sau khi phản hồi đã nằm dưới hai phút', () => {
  assert.equal(responseCanYieldToActivity(
    job(),
    responseSentAtMs + RESPONSE_PRIORITY_MS,
  ), true);
  assert.equal(shouldMoveStatusToBottom({
    job: job(),
    statusMessageId: 'status',
    lastMessageId: 'response',
    lastMessageIsBot: true,
    now: responseSentAtMs + RESPONSE_PRIORITY_MS,
  }), true);
});

test('không đưa status xuống cuối nếu không có hoạt động sau phản hồi', () => {
  assert.equal(shouldMoveStatusToBottom({
    job: job({ lastActivityAt: responseSentAt }),
    statusMessageId: 'status',
    lastMessageId: 'response',
    lastMessageIsBot: true,
    now: responseSentAtMs + RESPONSE_PRIORITY_MS * 2,
  }), false);
});

test('tin nhắn mới của người dùng vẫn kéo status đang chạy xuống cuối ngay', () => {
  assert.equal(shouldMoveStatusToBottom({
    job: job(),
    statusMessageId: 'status',
    lastMessageId: 'user-message',
    lastMessageIsBot: false,
    now: responseSentAtMs + 1000,
  }), true);
});

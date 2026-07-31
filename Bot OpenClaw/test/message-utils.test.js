'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { splitDiscordText } = require('../src/message-utils');

test('giữ phản hồi ngắn trong một tin nhắn', () => {
  assert.deepEqual(splitDiscordText('Xin chào'), ['Xin chào']);
});

test('chia phản hồi dài dưới giới hạn Discord', () => {
  const text = Array.from({ length: 800 }, (_, index) => `dòng-${index}`).join(' ');
  const chunks = splitDiscordText(text, 200);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.every((chunk) => chunk.length <= 200), true);
  assert.equal(chunks.join(' '), text);
});

test('trả thông báo mặc định khi nội dung rỗng', () => {
  assert.deepEqual(splitDiscordText('   '), ['OpenClaw không trả về nội dung.']);
});

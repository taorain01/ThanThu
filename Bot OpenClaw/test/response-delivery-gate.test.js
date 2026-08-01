'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ResponseDeliveryGate,
  isNoResponsePlaceholder,
} = require('../src/response-delivery-gate');

test('nhận diện chính xác placeholder kỹ thuật của OpenClaw', () => {
  assert.equal(isNoResponsePlaceholder('No response from OpenClaw.'), true);
  assert.equal(isNoResponsePlaceholder('  no response from openclaw  '), true);
  assert.equal(isNoResponsePlaceholder('OpenClaw chưa trả lời.'), false);
  assert.equal(isNoResponsePlaceholder('No response from another service.'), false);
});

test('SSE và transcript cạnh tranh vẫn chỉ gửi một phản hồi', async () => {
  const delivered = [];
  const gate = new ResponseDeliveryGate(async (text) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    delivered.push(text);
  });

  const [streamResult, transcriptResult] = await Promise.all([
    gate.deliverOnce('Phản hồi từ SSE'),
    gate.deliverOnce('Phản hồi từ transcript'),
  ]);

  assert.deepEqual(delivered, ['Phản hồi từ SSE']);
  assert.equal(streamResult, true);
  assert.equal(transcriptResult, true);
  assert.equal(await gate.deliverOnce('Không được gửi'), false);
});

test('delivery lỗi cho phép nguồn còn lại thử lại an toàn', async () => {
  let calls = 0;
  const gate = new ResponseDeliveryGate(async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error('Discord tạm lỗi');
    }
  });

  await assert.rejects(() => gate.deliverOnce('Lần đầu'), /Discord tạm lỗi/);
  assert.equal(await gate.deliverOnce('Lần hai'), true);
  assert.equal(calls, 2);
});

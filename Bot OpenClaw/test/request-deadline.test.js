'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RequestDeadline } = require('../src/request-deadline');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForAbort(signal, timeoutMs = 500) {
  if (signal.aborted) {
    return Promise.resolve(signal.reason);
  }
  return Promise.race([
    new Promise((resolve) => signal.addEventListener('abort', () => resolve(signal.reason), { once: true })),
    wait(timeoutMs).then(() => {
      throw new Error('Không nhận được tín hiệu abort đúng hạn.');
    }),
  ]);
}

test('hoạt động transcript reset idle timeout', async () => {
  const deadline = new RequestDeadline({ idleTimeoutMs: 50, maxRuntimeMs: 500 });
  await wait(30);
  deadline.touch();
  await wait(30);
  assert.equal(deadline.signal.aborted, false);
  const reason = await waitForAbort(deadline.signal);
  assert.equal(reason.code, 'idle_timeout');
  deadline.stop();
});

test('thời lượng tối đa không bị reset bởi hoạt động', async () => {
  const deadline = new RequestDeadline({ idleTimeoutMs: 500, maxRuntimeMs: 45 });
  const touchTimer = setInterval(() => deadline.touch(), 10);
  const reason = await waitForAbort(deadline.signal);
  clearInterval(touchTimer);
  assert.equal(reason.code, 'max_runtime');
  deadline.stop();
});

test('chuyển tiếp tín hiệu dừng từ queue', async () => {
  const parent = new AbortController();
  const deadline = new RequestDeadline({
    signal: parent.signal,
    idleTimeoutMs: 500,
    maxRuntimeMs: 1000,
  });
  const reason = Object.assign(new Error('stop'), { code: 'stopped' });
  parent.abort(reason);
  assert.equal(await waitForAbort(deadline.signal), reason);
  deadline.stop();
});

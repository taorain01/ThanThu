'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startStatusHeartbeat, statusUpdateDelay } = require('../src/status-heartbeat');

test('event tiến độ cập nhật gần realtime nhưng vẫn debounce để tránh rate-limit', () => {
  assert.equal(statusUpdateDelay({
    now: 10000,
    lastUpdatedAt: 9500,
    debounceMs: 1000,
  }), 500);
  assert.equal(statusUpdateDelay({
    now: 10000,
    lastUpdatedAt: 8000,
    debounceMs: 1000,
  }), 100);
  assert.equal(statusUpdateDelay({ immediate: true }), 100);
});

test('heartbeat chủ động refresh job dù không có event mới', async () => {
  let intervalCallback;
  let intervalMs;
  let cleared = false;
  const refreshed = [];
  const heartbeat = startStatusHeartbeat({
    intervalMs: 60000,
    listActiveJobs: () => [{ id: 'job-1' }, { id: 'job-2' }],
    refreshJob: async (job) => refreshed.push(job.id),
    setIntervalImpl: (callback, delay) => {
      intervalCallback = callback;
      intervalMs = delay;
      return { unref() {} };
    },
    clearIntervalImpl: () => {
      cleared = true;
    },
  });

  assert.equal(intervalMs, 60000);
  assert.equal(typeof intervalCallback, 'function');
  await heartbeat.tick();
  assert.deepEqual(refreshed, ['job-1', 'job-2']);
  heartbeat.stop();
  assert.equal(cleared, true);
});

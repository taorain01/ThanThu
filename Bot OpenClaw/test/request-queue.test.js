'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  QueueFullError,
  QueueStoppedError,
  SerialRequestQueue,
} = require('../src/request-queue');

function deferredTask(events, name) {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  return {
    release,
    task: async () => {
      events.push(`start:${name}`);
      await gate;
      events.push(`end:${name}`);
      return name;
    },
  };
}

test('xử lý tuần tự và báo số yêu cầu đang chờ', async () => {
  const queue = new SerialRequestQueue(2);
  const events = [];
  const first = deferredTask(events, 'a');
  const second = deferredTask(events, 'b');

  const firstPromise = queue.enqueue(first.task);
  const secondPromise = queue.enqueue(second.task);
  assert.deepEqual(queue.getStatus(), { active: true, pending: 1 });

  first.release();
  assert.equal(await firstPromise, 'a');
  second.release();
  assert.equal(await secondPromise, 'b');
  assert.deepEqual(events, ['start:a', 'end:a', 'start:b', 'end:b']);
});

test('từ chối khi hàng đợi đầy', async () => {
  const queue = new SerialRequestQueue(1);
  const first = deferredTask([], 'a');
  const second = deferredTask([], 'b');
  const p1 = queue.enqueue(first.task);
  const p2 = queue.enqueue(second.task);
  await assert.rejects(() => queue.enqueue(async () => {}), QueueFullError);
  first.release();
  await p1;
  second.release();
  await p2;
});

test('stop hủy yêu cầu đang chạy và toàn bộ hàng đợi', async () => {
  const queue = new SerialRequestQueue(2);
  const active = queue.enqueue(
    (signal) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  );
  const waiting = queue.enqueue(async () => 'không được chạy');
  queue.stop();
  await assert.rejects(() => active, QueueStoppedError);
  await assert.rejects(() => waiting, QueueStoppedError);
  assert.deepEqual(queue.getStatus(), { active: false, pending: 0 });
});

test('queue toàn cục giữ channel thứ hai chờ nhưng vẫn cho stop theo job', async () => {
  const queue = new SerialRequestQueue(3);
  const events = [];
  const first = deferredTask(events, 'channel-1');
  const running = queue.enqueue(first.task, { jobId: 'job-1', channelId: 'channel-1' });
  const waiting = queue.enqueue(
    async () => 'không được chạy',
    { jobId: 'job-2', channelId: 'channel-2' },
  );

  const detail = queue.getDetailedStatus();
  assert.equal(detail.activeMetadata.jobId, 'job-1');
  assert.equal(detail.pendingMetadata[0].jobId, 'job-2');
  assert.equal(queue.stopWhere((metadata) => metadata.jobId === 'job-2'), 1);
  await assert.rejects(() => waiting, QueueStoppedError);
  first.release();
  assert.equal(await running, 'channel-1');
  assert.deepEqual(events, ['start:channel-1', 'end:channel-1']);
});

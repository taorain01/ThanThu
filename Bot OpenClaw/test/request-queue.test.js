'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  QueueFullError,
  QueueStoppedError,
  SerialRequestQueue,
  SessionRequestQueue,
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

test('queue tuần tự vẫn cho dừng riêng một job đang chờ', async () => {
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

test('hai session chạy song song nhưng yêu cầu cùng session vẫn tuần tự', async () => {
  const queue = new SessionRequestQueue(5, 2);
  const events = [];
  const sessionAFirst = deferredTask(events, 'session-a-1');
  const sessionASecond = deferredTask(events, 'session-a-2');
  const sessionB = deferredTask(events, 'session-b-1');

  const a1 = queue.enqueue(sessionAFirst.task, { jobId: 'a-1', sessionKey: 'session-a' });
  const a2 = queue.enqueue(sessionASecond.task, { jobId: 'a-2', sessionKey: 'session-a' });
  const b1 = queue.enqueue(sessionB.task, { jobId: 'b-1', sessionKey: 'session-b' });

  const detail = queue.getDetailedStatus();
  assert.equal(detail.activeCount, 2);
  assert.equal(detail.maxConcurrent, 2);
  assert.deepEqual(
    detail.activeMetadataList.map((item) => item.jobId).sort(),
    ['a-1', 'b-1'],
  );
  assert.deepEqual(detail.pendingMetadata.map((item) => item.jobId), ['a-2']);
  assert.deepEqual(events, ['start:session-a-1', 'start:session-b-1']);

  sessionB.release();
  assert.equal(await b1, 'session-b-1');
  assert.deepEqual(events, ['start:session-a-1', 'start:session-b-1', 'end:session-b-1']);

  sessionAFirst.release();
  assert.equal(await a1, 'session-a-1');
  assert.equal(queue.getDetailedStatus().activeMetadata.jobId, 'a-2');
  sessionASecond.release();
  assert.equal(await a2, 'session-a-2');
  assert.deepEqual(events, [
    'start:session-a-1',
    'start:session-b-1',
    'end:session-b-1',
    'end:session-a-1',
    'start:session-a-2',
    'end:session-a-2',
  ]);
});

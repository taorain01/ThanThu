'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TaskSnapshotService } = require('../src/task-snapshot-service');

function fakeTimer() {
  return { unref() {} };
}

test('nhiều job dùng chung đúng một lần tải snapshot', async () => {
  let listCalls = 0;
  const received = [];
  const taskClient = {
    list: async () => {
      listCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return [{ taskId: 'task-shared', status: 'running' }];
    },
    getLastSyncInfo: () => ({ source: 'rpc', latencyMs: 12, at: '2026-08-07T00:00:00.000Z' }),
    show: async (taskId) => ({ taskId, status: 'running' }),
  };
  const service = new TaskSnapshotService({
    taskClient,
    setTimeoutImpl: fakeTimer,
    clearTimeoutImpl: () => {},
  });
  service.subscribe('job-1', { onSnapshot: async (snapshot) => received.push(['job-1', snapshot]) });
  service.subscribe('job-2', { onSnapshot: async (snapshot) => received.push(['job-2', snapshot]) });

  const snapshots = await Promise.all([service.refresh(), service.refresh(), service.refresh()]);
  assert.equal(listCalls, 1);
  assert.equal(received.length, 2);
  assert.equal(snapshots.every((snapshot) => snapshot.source === 'rpc'), true);
  service.close();
});

test('lỗi snapshot được phát một lần cho mọi job và tăng backoff', async () => {
  const errors = [];
  const service = new TaskSnapshotService({
    taskClient: { list: async () => { throw new Error('offline'); } },
    setTimeoutImpl: fakeTimer,
    clearTimeoutImpl: () => {},
    backoffMs: [2000, 5000, 10000, 30000],
  });
  service.subscribe('job-1', { onError: async (_error, state) => errors.push(state) });
  service.subscribe('job-2', { onError: async (_error, state) => errors.push(state) });

  await assert.rejects(() => service.refresh(), /offline/);
  assert.equal(errors.length, 2);
  assert.equal(errors.every((state) => state.retryInMs === 2000), true);
  assert.equal(service.nextDelay(), 2000);
  service.close();
});

test('tasks.get cùng ID được coalesce giữa nhiều job', async () => {
  let showCalls = 0;
  const service = new TaskSnapshotService({
    taskClient: {
      list: async () => [],
      show: async (taskId) => {
        showCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { taskId, status: 'succeeded' };
      },
    },
    setTimeoutImpl: fakeTimer,
    clearTimeoutImpl: () => {},
  });

  const results = await Promise.all([
    service.getTask('task-1'),
    service.getTask('task-1'),
    service.getTask('task-1'),
  ]);
  assert.equal(showCalls, 1);
  assert.equal(results.every((task) => task.status === 'succeeded'), true);
  service.close();
});

test('tasks.list theo session được coalesce trong cửa sổ xác nhận hủy', async () => {
  let calls = 0;
  const service = new TaskSnapshotService({
    taskClient: {
      list: async () => [],
      listForSession: async (sessionKey) => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return [{ taskId: 'task-terminal', ownerKey: sessionKey, status: 'succeeded' }];
      },
    },
    setTimeoutImpl: fakeTimer,
    clearTimeoutImpl: () => {},
  });

  const results = await Promise.all([
    service.getSessionTasks('agent:main:session'),
    service.getSessionTasks('agent:main:session'),
  ]);
  assert.equal(calls, 1);
  assert.equal(results[0][0].status, 'succeeded');
  service.close();
});

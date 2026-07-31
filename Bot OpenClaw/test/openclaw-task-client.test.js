'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OpenClawTaskClient, OpenClawTaskError } = require('../src/openclaw-task-client');

test('gọi tasks list/show/cancel bằng execFile, không qua shell', async () => {
  const calls = [];
  const client = new OpenClawTaskClient({
    nodePath: 'C:\\node.exe',
    openclawModulePath: 'C:\\openclaw\\openclaw.mjs',
    execFileImpl: async (...args) => {
      calls.push(args);
      const command = args[1][2];
      if (command === 'list') {
        return { stdout: JSON.stringify({ tasks: [{ taskId: 'task-1' }] }) };
      }
      if (command === 'show') {
        return { stdout: JSON.stringify({ taskId: 'task-1', status: 'running' }) };
      }
      return { stdout: 'cancel requested' };
    },
  });

  assert.deepEqual(await client.list(), [{ taskId: 'task-1' }]);
  assert.equal((await client.show('task-1')).status, 'running');
  await client.cancel('task-1');
  assert.deepEqual(calls.map((call) => call[1]), [
    ['C:\\openclaw\\openclaw.mjs', 'tasks', 'list', '--json'],
    ['C:\\openclaw\\openclaw.mjs', 'tasks', 'show', 'task-1', '--json'],
    ['C:\\openclaw\\openclaw.mjs', 'tasks', 'cancel', 'task-1'],
  ]);
  assert.equal(calls.every((call) => call[2].shell === undefined), true);
  assert.equal(calls.every((call) => call[2].windowsHide === true), true);
});

test('không lộ stdout lỗi và báo JSON sai định dạng', async () => {
  const failed = new OpenClawTaskClient({
    execFileImpl: async () => { throw new Error('token-secret'); },
  });
  await assert.rejects(
    () => failed.list(),
    (error) => error instanceof OpenClawTaskError && !error.message.includes('token-secret'),
  );

  const invalid = new OpenClawTaskClient({
    execFileImpl: async () => ({ stdout: 'not-json' }),
  });
  await assert.rejects(() => invalid.list(), /JSON không hợp lệ/);
});

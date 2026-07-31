'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeWorkers } = require('../src/task-summary');

test('gom subagent và cli cùng runId thành một worker logic', () => {
  const summary = summarizeWorkers({
    tasks: {
      subagent: {
        taskId: 'task-subagent',
        runtime: 'subagent',
        runId: 'run-1',
        childSessionKey: 'agent:main:subagent:child-1',
        label: 'Tạo bộ ảnh',
        status: 'running',
        startedAt: 1000,
        lastEventAt: 3000,
      },
      cli: {
        taskId: 'task-cli',
        runtime: 'cli',
        runId: 'run-1',
        childSessionKey: 'agent:main:subagent:child-1',
        status: 'running',
        startedAt: 1000,
        lastEventAt: 3000,
      },
    },
  });

  assert.equal(summary.counts.total, 1);
  assert.equal(summary.counts.active, 1);
  assert.equal(summary.current.displayLabel, 'Tạo bộ ảnh');
  assert.equal(summary.current.records.length, 2);
});

test('tóm tắt đúng worker hoàn tất, blocker và worker hiện tại mới nhất', () => {
  const summary = summarizeWorkers({
    first: {
      taskId: 'first',
      runId: 'run-1',
      label: 'Worker đầu',
      status: 'succeeded',
      endedAt: 2000,
    },
    blocked: {
      taskId: 'blocked',
      runId: 'run-2',
      label: 'Worker lỗi',
      status: 'succeeded',
      terminalOutcome: 'blocked',
      progressSummary: '[blocked] Không thể tiếp tục',
      endedAt: 3000,
    },
    latest: {
      taskId: 'latest',
      runId: 'run-3',
      label: 'Worker hiện tại',
      status: 'running',
      progressSummary: 'Đang xử lý C:\\Users\\songt\\secret.txt với sk-secretsecretsecret',
      lastEventAt: 4000,
    },
  });

  assert.deepEqual(summary.counts, {
    total: 3,
    active: 1,
    succeeded: 1,
    problem: 1,
  });
  assert.equal(summary.current.displayLabel, 'Worker hiện tại');
  assert.equal(summary.current.progress.includes('secret.txt'), false);
  assert.equal(summary.current.progress.includes('sk-secret'), false);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RainderClientError } = require('../src/rainder-client');
const {
  executeRainderUploadCommand,
  formatQueue,
  friendlyRainderError,
} = require('../src/rainder-command');

test('format queue khong tao mention va hien run hien tai', () => {
  const text = formatQueue({
    progress: { running: true, pct: 42, run_id: 'ytu_1', current: '@everyone' },
    items: [{ id: 'yt_1', channel: 'Namizuko', status: 'uploading', title: '`Title`' }],
  });
  assert.match(text, /42%/);
  assert.match(text, /ytu_1/);
  assert.doesNotMatch(text, /@everyone/);
  assert.doesNotMatch(text, /`Title`/);
});

test('start mac dinh dung item dang tick va request id cua Discord message', async () => {
  const calls = [];
  const client = {
    async startUploads(ids, options) {
      calls.push({ ids, options });
      return { ok: true, progress: { running: true, pct: 0, run_id: 'ytu_2' } };
    },
  };
  const text = await executeRainderUploadCommand(client, ['start'], { requestId: 'discord:9' });
  assert.match(text, /Da bat dau upload/);
  assert.deepEqual(calls[0], {
    ids: [],
    options: {
      source: 'discord',
      requestId: 'discord:9',
      idempotencyKey: 'discord:9',
    },
  });
});

test('offline, timeout va conflict co thong bao an toan', () => {
  assert.match(friendlyRainderError(new RainderClientError('offline', 'x')), /Rainder dang tat/);
  assert.match(friendlyRainderError(new RainderClientError('timeout', 'x')), /khong duoc tu dong gui lai/);
  assert.match(
    friendlyRainderError(new RainderClientError('conflict', 'x', 409, { progress: { run_id: 'ytu_live' } })),
    /ytu_live/,
  );
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RainderClient,
  RainderClientError,
  validateDiscovery,
} = require('../src/rainder-client');

const discoveryProvider = async () => ({
  url: 'http://127.0.0.1:18793',
  token: 'bridge-token',
});

test('validate discovery chi chap nhan HTTP loopback', () => {
  assert.deepEqual(validateDiscovery({ url: 'http://127.0.0.1:18793', token: 'x' }), {
    url: 'http://127.0.0.1:18793',
    token: 'x',
  });
  assert.throws(
    () => validateDiscovery({ url: 'https://example.com', token: 'x' }),
    (error) => error instanceof RainderClientError && error.code === 'offline',
  );
});

test('start gui token, source va idempotency key dung contract', async () => {
  const calls = [];
  const client = new RainderClient({
    discoveryProvider,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ ok: true, run_id: 'ytu_1', progress: { running: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const result = await client.startUploads(['yt_1'], {
    source: 'discord',
    requestId: 'discord:123',
  });

  assert.equal(result.run_id, 'ytu_1');
  assert.equal(calls[0].url, 'http://127.0.0.1:18793/v1/youtube/uploads/start');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer bridge-token');
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'discord:123');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    item_ids: ['yt_1'],
    source: 'discord',
    request_id: 'discord:123',
  });
});

test('phan loai auth va conflict ma khong lam mat progress', async () => {
  for (const [status, code] of [[401, 'auth'], [409, 'conflict']]) {
    const client = new RainderClient({
      discoveryProvider,
      fetchImpl: async () => new Response(
        JSON.stringify({ ok: false, error: 'blocked', progress: { run_id: 'ytu_current' } }),
        { status, headers: { 'Content-Type': 'application/json' } },
      ),
    });
    await assert.rejects(
      client.listUploads(),
      (error) => error.code === code && error.payload.progress.run_id === 'ytu_current',
    );
  }
});

test('timeout va bridge offline co ma loi rieng', async () => {
  const offline = new RainderClient({
    discoveryProvider: async () => {
      throw new RainderClientError('offline', 'off');
    },
  });
  await assert.rejects(offline.health(), (error) => error.code === 'offline');

  const timeout = new RainderClient({
    discoveryProvider,
    timeoutMs: 5,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }),
  });
  await assert.rejects(timeout.health(), (error) => error.code === 'timeout');
});

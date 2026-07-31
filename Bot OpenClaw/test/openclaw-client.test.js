'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  OpenClawClient,
  OpenClawError,
  PC_OPERATOR_INSTRUCTIONS,
} = require('../src/openclaw-client');

function config(overrides = {}) {
  return {
    openclawBaseUrl: 'http://127.0.0.1:18789',
    openclawGatewayToken: 'gateway-secret',
    openclawModel: 'openclaw/default',
    requestTimeoutMs: 1000,
    ...overrides,
  };
}

function chatArgs(overrides = {}) {
  return {
    guildId: '1239836342456942643',
    channelId: '111111111111111111',
    sessionGeneration: 3,
    text: 'Chụp màn hình',
    imageParts: [],
    ...overrides,
  };
}

test('gửi session ổn định và đọc phản hồi thành công', async () => {
  let request;
  const client = new OpenClawClient(config(), {
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return Response.json({ choices: [{ message: { content: 'Đã xong.' } }] });
    },
  });

  assert.equal(await client.chat(chatArgs()), 'Đã xong.');
  assert.equal(request.url, 'http://127.0.0.1:18789/v1/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer gateway-secret');
  assert.equal(request.options.headers['x-openclaw-message-channel'], 'discord');
  assert.equal(
    request.body.user,
    'discord:1239836342456942643:111111111111111111:3',
  );
  assert.deepEqual(request.body.messages[0], {
    role: 'system',
    content: PC_OPERATOR_INSTRUCTIONS,
  });
  assert.equal(request.body.messages[1].role, 'user');
  assert.deepEqual(request.body.messages[1].content, [
    { type: 'text', text: 'Chụp màn hình' },
  ]);
  assert.equal(request.body.stream, false);
  assert.equal(request.body.tools, undefined);
});

test('không retry khi OpenClaw trả lỗi', async () => {
  for (const [status, code] of [[401, 'auth'], [429, 'rate_limited'], [500, 'unavailable']]) {
    let calls = 0;
    const client = new OpenClawClient(config(), {
      fetchImpl: async () => {
        calls += 1;
        return new Response('{}', { status });
      },
    });
    await assert.rejects(
      () => client.chat(chatArgs()),
      (error) => error instanceof OpenClawError && error.code === code,
    );
    assert.equal(calls, 1);
  }
});

test('báo lỗi JSON và nội dung phản hồi không hợp lệ', async () => {
  const invalidJson = new OpenClawClient(config(), {
    fetchImpl: async () => new Response('not-json', { status: 200 }),
  });
  await assert.rejects(() => invalidJson.chat(chatArgs()), /JSON không hợp lệ/);

  const empty = new OpenClawClient(config(), {
    fetchImpl: async () => Response.json({ choices: [{ message: { content: '' } }] }),
  });
  await assert.rejects(() => empty.chat(chatArgs()), /nội dung văn bản hợp lệ/);
});

test('timeout không tạo lần gọi thứ hai', async () => {
  let calls = 0;
  const client = new OpenClawClient(config({ requestTimeoutMs: 20 }), {
    fetchImpl: async (_url, options) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
    },
  });
  await assert.rejects(
    () => client.chat(chatArgs()),
    (error) => error instanceof OpenClawError && error.code === 'timeout',
  );
  assert.equal(calls, 1);
});

test('health chỉ trả trạng thái an toàn', async () => {
  const available = new OpenClawClient(config(), {
    fetchImpl: async () => new Response('{}', { status: 200 }),
  });
  assert.deepEqual(await available.health(), { ok: true, status: 200 });

  const offline = new OpenClawClient(config(), {
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.deepEqual(await offline.health(), { ok: false, status: null });
});

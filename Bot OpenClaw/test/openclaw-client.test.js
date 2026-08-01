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
    openclawAgentId: 'main',
    ...overrides,
  };
}

function chatArgs(overrides = {}) {
  return {
    guildId: '1239836342456942643',
    channelId: '111111111111111111',
    sessionGeneration: 3,
    backendModel: 'ollama/qwen3:8b',
    text: 'Chụp màn hình',
    imageParts: [],
    ...overrides,
  };
}

function sseResponse(chunks) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  }), {
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });
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
  assert.equal(request.options.headers['x-openclaw-model'], 'ollama/qwen3:8b');
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
  assert.equal(
    client.sessionKey(chatArgs()),
    'agent:main:openai-user:discord:1239836342456942643:111111111111111111:3',
  );
});

test('đánh số ảnh và yêu cầu vision chi tiết cao', async () => {
  let requestBody;
  const client = new OpenClawClient(config(), {
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return Response.json({ choices: [{ message: { content: 'Đã thấy đủ ảnh.' } }] });
    },
  });
  const images = [
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AQID' } },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,BAUG', detail: 'auto' } },
  ];

  await client.chat(chatArgs({ text: 'So sánh các ảnh', imageParts: images }));

  assert.deepEqual(requestBody.messages[1].content, [
    { type: 'text', text: 'So sánh các ảnh' },
    {
      type: 'text',
      text: '[Có 2 ảnh đính kèm. Mỗi ảnh có nhãn ANH N/2 được in trực tiếp trong ảnh. Khi người dùng nói "ảnh N", phải đối chiếu nhãn đó; hãy quan sát cả ảnh rất nhỏ hoặc chỉ chứa logo/chữ.]',
    },
    {
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,AQID', detail: 'high' },
    },
    {
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,BAUG', detail: 'high' },
    },
  ]);
  assert.equal(images[0].image_url.detail, undefined);
  assert.equal(images[1].image_url.detail, 'auto');
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

test('tín hiệu timeout từ supervisor được giữ nguyên và không tạo lần gọi thứ hai', async () => {
  let calls = 0;
  const controller = new AbortController();
  const client = new OpenClawClient(config(), {
    fetchImpl: async (_url, options) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
    },
  });
  const reason = Object.assign(new Error('idle'), { code: 'idle_timeout' });
  setTimeout(() => controller.abort(reason), 20);
  await assert.rejects(
    () => client.chat(chatArgs({ signal: controller.signal })),
    (error) => error === reason && error.code === 'idle_timeout',
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

test('đọc SSE phân mảnh, ghép delta và dừng tại DONE', async () => {
  let requestBody;
  const updates = [];
  const client = new OpenClawClient(config(), {
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return sseResponse([
        'data: {"choices":[{"delta":{"con',
        'tent":"Xin "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"chào"}}]}\n\n',
        'data: [DONE]\n\n',
      ]);
    },
  });

  const result = await client.chat(chatArgs({
    onDelta: ({ delta, text }) => updates.push({ delta, text }),
  }));

  assert.equal(requestBody.stream, true);
  assert.equal(result, 'Xin chào');
  assert.deepEqual(updates, [
    { delta: 'Xin ', text: 'Xin ' },
    { delta: 'chào', text: 'Xin chào' },
  ]);
});

test('stream chấp nhận JSON fallback và phát một delta hoàn chỉnh', async () => {
  const updates = [];
  const client = new OpenClawClient(config(), {
    fetchImpl: async () => Response.json({
      choices: [{ message: { content: 'Phản hồi đầy đủ.' } }],
    }),
  });

  const result = await client.chat(chatArgs({
    onDelta: (update) => updates.push(update),
  }));

  assert.equal(result, 'Phản hồi đầy đủ.');
  assert.deepEqual(updates, [{
    delta: 'Phản hồi đầy đủ.',
    text: 'Phản hồi đầy đủ.',
  }]);
});

test('không retry khi SSE báo lỗi sau khi đã có delta', async () => {
  let calls = 0;
  const updates = [];
  const client = new OpenClawClient(config(), {
    fetchImpl: async () => {
      calls += 1;
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"Đang làm"}}]}\n\n',
        'data: {"error":{"message":"gateway failed"}}\n\n',
      ]);
    },
  });

  await assert.rejects(
    () => client.chat(chatArgs({ onDelta: (update) => updates.push(update) })),
    (error) => error instanceof OpenClawError && error.code === 'stream_error',
  );
  assert.equal(calls, 1);
  assert.equal(updates.length, 1);
});

test('abort trong lúc đọc SSE giữ nguyên lý do dừng và không retry', async () => {
  let calls = 0;
  const controller = new AbortController();
  const reason = Object.assign(new Error('stop'), { code: 'queue_stopped' });
  const client = new OpenClawClient(config(), {
    fetchImpl: async (_url, options) => {
      calls += 1;
      return new Response(new ReadableStream({
        start(streamController) {
          options.signal.addEventListener('abort', () => {
            streamController.error(options.signal.reason);
          }, { once: true });
        },
      }), {
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  });

  setTimeout(() => controller.abort(reason), 20);
  await assert.rejects(
    () => client.chat(chatArgs({ signal: controller.signal, onDelta: () => {} })),
    (error) => error === reason,
  );
  assert.equal(calls, 1);
});

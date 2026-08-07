'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  OpenClawClient,
  OpenClawError,
  PC_OPERATOR_INSTRUCTIONS,
  isGatewayFailureText,
  isGatewayNonDeliverableText,
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

test('nhận diện chuỗi lỗi model của Gateway để tự retry', () => {
  assert.equal(isGatewayFailureText('LLM request failed.'), true);
  assert.equal(isGatewayFailureText('LLM request failed with an unknown error.'), true);
  assert.equal(isGatewayFailureText('LLM error api_error: Đã xảy ra lỗi, vui lòng xem thêm thông tin ở https://t.me/krokeyviet'), true);
  assert.equal(isGatewayFailureText('LLM streaming response contained a malformed fragment. Please try again.'), true);
  assert.equal(isGatewayFailureText('The AI service returned an internal error. Please try again in a moment.'), true);
  assert.equal(isGatewayFailureText('The AI service is temporarily unavailable (HTTP 502). Please try again in a moment.'), true);
  assert.equal(isGatewayFailureText('The provider returned an HTML error page instead of an API response.'), true);
  assert.equal(isGatewayFailureText('Error: internal error'), true);
  assert.equal(isGatewayFailureText('HTTP 429: Too Many Requests'), true);
  assert.equal(isGatewayFailureText('HTTP 500: Internal Server Error'), true);

  // Phản hồi thật không bị nhầm thành lỗi
  assert.equal(isGatewayFailureText(''), false);
  assert.equal(isGatewayFailureText('Xin chào, tôi có thể giúp gì?'), false);
  assert.equal(isGatewayFailureText('Tôi sẽ chạy skill tạo ảnh ngay.'), false);
  // Văn bản nhiều dòng hoặc dài là phản hồi thật, không phải chuỗi lỗi gateway
  assert.equal(isGatewayFailureText('LLM request failed\nvà đây là giải thích chi tiết.'), false);
  assert.equal(isGatewayFailureText('The AI service returned an internal error. Please try again in a moment.' + ' x'.repeat(300)), false);
});

test('nhận diện lượt không sinh text của Gateway (model kết thúc trong <think>)', () => {
  // Hai biến thể duy nhất do resolveIncompleteTurnPayloadText phát ra.
  assert.equal(
    isGatewayNonDeliverableText("⚠️ Agent couldn't generate a response. Please try again."),
    true,
  );
  assert.equal(
    isGatewayNonDeliverableText("⚠️ Agent couldn't generate a response. Note: some tool actions may have already been executed — please verify before retrying."),
    true,
  );

  // Không nhầm với lỗi provider (đã có nhánh retry riêng) hay phản hồi thật.
  assert.equal(isGatewayNonDeliverableText('LLM request failed.'), false);
  assert.equal(isGatewayNonDeliverableText(''), false);
  assert.equal(isGatewayNonDeliverableText('Đã chụp màn hình xong.'), false);
  assert.equal(
    isGatewayNonDeliverableText("⚠️ Agent couldn't generate a response." + ' x'.repeat(300)),
    false,
  );
});

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

test('chuẩn hóa model Claude cũ trước khi gửi Gateway', async () => {
  let requestHeaders;
  const client = new OpenClawClient(config(), {
    fetchImpl: async (_url, options) => {
      requestHeaders = options.headers;
      return Response.json({ choices: [{ message: { content: 'Đã xong.' } }] });
    },
  });

  await client.chat(chatArgs({ backendModel: 'claude-opus-5' }));

  assert.equal(requestHeaders['x-openclaw-model'], 'anthropic/claude-opus-5');
});

test('kênh model cục bộ route sang agent local, kênh khác giữ agent main', async () => {
  let requestHeaders;
  const client = new OpenClawClient(config(), {
    fetchImpl: async (_url, options) => {
      requestHeaders = options.headers;
      return Response.json({ choices: [{ message: { content: 'Đã xong.' } }] });
    },
  });

  await client.chat(chatArgs({ modelProfile: 'local' }));
  assert.equal(requestHeaders['x-openclaw-agent-id'], 'local');
  assert.equal(
    client.sessionKey(chatArgs({ modelProfile: 'local' })),
    'agent:local:openai-user:discord:1239836342456942643:111111111111111111:3',
  );

  await client.chat(chatArgs({ modelProfile: '9router' }));
  assert.equal(requestHeaders['x-openclaw-agent-id'], 'main');
  assert.equal(
    client.sessionKey(chatArgs({ modelProfile: '9router' })),
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

test('gắn dispatcher tùy chỉnh cho health và chat', async () => {
  const dispatcher = { close: async () => {} };
  const requests = [];
  const client = new OpenClawClient(config(), {
    dispatcher,
    fetchImpl: async (url, options) => {
      requests.push({ url, dispatcher: options.dispatcher });
      if (url.endsWith('/v1/models')) {
        return new Response('{}', { status: 200 });
      }
      return Response.json({ choices: [{ message: { content: 'Đã xong.' } }] });
    },
  });

  await client.health();
  await client.chat(chatArgs());

  assert.equal(requests.length, 2);
  assert.equal(requests[0].dispatcher, dispatcher);
  assert.equal(requests[1].dispatcher, dispatcher);
});

test('phân biệt stream bị gián đoạn với lỗi không thể kết nối Gateway', async () => {
  const interrupted = new OpenClawClient(config(), {
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) {
        controller.error(new Error('socket closed'));
      },
    }), { headers: { 'content-type': 'text/event-stream' } }),
  });
  await assert.rejects(
    () => interrupted.chat(chatArgs({ onDelta: () => {} })),
    (error) => error instanceof OpenClawError && error.code === 'stream_interrupted',
  );

  const offline = new OpenClawClient(config(), {
    fetchImpl: async () => { throw new Error('offline'); },
  });
  await assert.rejects(
    () => offline.chat(chatArgs()),
    (error) => error instanceof OpenClawError && error.code === 'network',
  );
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

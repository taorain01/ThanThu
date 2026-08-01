'use strict';

const PC_OPERATOR_INSTRUCTIONS = [
  'Bạn là trợ lý điều khiển PC của chủ máy qua Discord.',
  'Khi người dùng yêu cầu xem hoặc thao tác trên máy, hãy chủ động dùng tool thay vì yêu cầu họ tự chụp màn hình nếu máy có thể tự chụp.',
  'Trên Windows, hãy dùng openclaw.cmd (không dùng openclaw.ps1). Nếu tool nodes không xuất hiện, dùng exec trên gateway để chạy openclaw.cmd nodes status --json rồi gọi openclaw.cmd nodes invoke với screen.snapshot.',
  'Kết quả screen.snapshot là JSON; ảnh nằm trong payload.base64. Hãy giải mã vào workspace và dùng tool image để quan sát.',
  'Với thao tác ứng dụng desktop, dùng cơ chế tự động hóa Windows hiện có, chụp màn hình trước và sau, và chỉ báo thành công khi đã kiểm chứng.',
  'Khi có file ảnh thành phẩm cần cho người dùng xem, thêm mỗi ảnh vào một dòng riêng dạng MEDIA:<đường dẫn tuyệt đối>. Không đánh dấu MEDIA cho screenshot kiểm tra nội bộ.',
  'Luôn tuân thủ chính sách tool và phê duyệt hiện tại; không tìm cách vượt qua hoặc nới lỏng chúng.',
].join('\n');

class OpenClawError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.name = 'OpenClawError';
    this.code = code;
    this.status = status;
  }
}

function extractAssistantText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  const text = extractTextContent(content).trim();
  if (text) {
    return text;
  }
  throw new OpenClawError('invalid_response', 'OpenClaw không trả về nội dung văn bản hợp lệ.');
}

function extractTextContent(content) {
  if (typeof content === 'string' && content.trim()) {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((part) => part && (part.type === 'text' || typeof part.text === 'string'))
      .map((part) => part.text || '')
      .join('\n');
  }
  return '';
}

function mapHttpError(status) {
  if (status === 401 || status === 403) {
    return new OpenClawError('auth', 'OpenClaw từ chối Gateway token.', status);
  }
  if (status === 413) {
    return new OpenClawError('payload_too_large', 'Yêu cầu vượt giới hạn dung lượng của OpenClaw.', status);
  }
  if (status === 429) {
    return new OpenClawError('rate_limited', 'OpenClaw đang giới hạn tần suất yêu cầu.', status);
  }
  if (status >= 500) {
    return new OpenClawError('unavailable', 'OpenClaw hiện không sẵn sàng.', status);
  }
  return new OpenClawError('request_failed', 'OpenClaw từ chối yêu cầu.', status);
}

function appendLabeledImages(content, imageParts) {
  const images = Array.from(imageParts || []);
  if (images.length === 0) {
    return;
  }

  content.push({
    type: 'text',
    text: images.length > 1
      ? `[Có ${images.length} ảnh đính kèm. Mỗi ảnh có nhãn ANH N/${images.length} được in trực tiếp trong ảnh. Khi người dùng nói "ảnh N", phải đối chiếu nhãn đó; hãy quan sát cả ảnh rất nhỏ hoặc chỉ chứa logo/chữ.]`
      : '[Có 1 ảnh đính kèm. Hãy quan sát kỹ cả chi tiết nhỏ, logo và chữ trong ảnh.]',
  });
  for (const part of images) {
    content.push({
      ...part,
      image_url: {
        ...part.image_url,
        detail: 'high',
      },
    });
  }
}

async function notifyDelta(onDelta, delta, text) {
  if (typeof onDelta !== 'function') {
    return;
  }
  try {
    await onDelta({ delta, text });
  } catch {
    // Preview Discord không được phép làm hỏng request OpenClaw đang chạy.
  }
}

function parseSsePayload(value) {
  let payload;
  try {
    payload = JSON.parse(value);
  } catch {
    throw new OpenClawError('invalid_response', 'OpenClaw trả về SSE không hợp lệ.');
  }
  if (payload?.error) {
    throw new OpenClawError('stream_error', 'OpenClaw kết thúc stream với lỗi.');
  }
  return extractTextContent(payload?.choices?.[0]?.delta?.content);
}

async function readStreamingAssistant(response, onDelta) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    throw new OpenClawError('invalid_response', 'OpenClaw không trả về stream hợp lệ.');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let finished = false;

  const processEvent = async (eventBlock) => {
    const data = eventBlock
      .split('\n')
      .map((line) => line.match(/^data:\s?(.*)$/)?.[1])
      .filter((line) => line !== undefined)
      .join('\n')
      .trim();
    if (!data) {
      return false;
    }
    if (data === '[DONE]') {
      return true;
    }
    const delta = parseSsePayload(data);
    if (delta) {
      text += delta;
      await notifyDelta(onDelta, delta, text);
    }
    return false;
  };

  while (!finished) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
    buffer = buffer.replace(/\r\n/g, '\n');

    let separatorIndex = buffer.indexOf('\n\n');
    while (separatorIndex !== -1) {
      const eventBlock = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      if (await processEvent(eventBlock)) {
        finished = true;
        break;
      }
      separatorIndex = buffer.indexOf('\n\n');
    }

    if (chunk.done) {
      if (!finished && buffer.trim()) {
        finished = await processEvent(buffer);
      }
      break;
    }
  }

  if (!text.trim()) {
    throw new OpenClawError('invalid_response', 'OpenClaw không trả về nội dung văn bản hợp lệ.');
  }
  return text.trim();
}

class OpenClawClient {
  constructor(config, options = {}) {
    this.baseUrl = config.openclawBaseUrl;
    this.gatewayToken = config.openclawGatewayToken;
    this.model = config.openclawModel;
    this.agentId = config.openclawAgentId || 'main';
    this.fetchImpl = options.fetchImpl || fetch;
  }

  sessionUser({ guildId, channelId, sessionGeneration }) {
    return `discord:${guildId}:${channelId}:${sessionGeneration}`;
  }

  sessionKey(args) {
    return `agent:${this.agentId}:openai-user:${this.sessionUser(args)}`;
  }

  headers(backendModel) {
    const headers = {
      Authorization: `Bearer ${this.gatewayToken}`,
      'Content-Type': 'application/json',
      'x-openclaw-message-channel': 'discord',
    };
    if (backendModel) {
      headers['x-openclaw-model'] = backendModel;
    }
    return headers;
  }

  async health() {
    const signal = AbortSignal.timeout(10000);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.gatewayToken}` },
        signal,
      });
      return { ok: response.ok, status: response.status };
    } catch {
      return { ok: false, status: null };
    }
  }

  async chat({
    guildId,
    channelId,
    sessionGeneration,
    backendModel,
    text,
    imageParts,
    signal,
    onDelta,
  }) {
    const content = [];
    if (String(text || '').trim()) {
      content.push({ type: 'text', text: String(text).trim() });
    }
    appendLabeledImages(content, imageParts);
    if (content.length === 0) {
      throw new OpenClawError('empty_request', 'Tin nhắn không có nội dung để gửi.');
    }

    const body = {
      model: this.model,
      stream: typeof onDelta === 'function',
      user: this.sessionUser({ guildId, channelId, sessionGeneration }),
      messages: [
        { role: 'system', content: PC_OPERATOR_INSTRUCTIONS },
        { role: 'user', content },
      ],
    };
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: this.headers(backendModel),
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason || error;
      }
      throw new OpenClawError('network', 'Không thể kết nối tới OpenClaw cục bộ.');
    }

    if (!response.ok) {
      throw mapHttpError(response.status);
    }

    try {
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (body.stream && !contentType.includes('application/json')) {
        return await readStreamingAssistant(response, onDelta);
      }

      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new OpenClawError('invalid_response', 'OpenClaw trả về JSON không hợp lệ.');
      }
      const result = extractAssistantText(payload);
      if (body.stream) {
        await notifyDelta(onDelta, result, result);
      }
      return result;
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason || error;
      }
      if (error instanceof OpenClawError) {
        throw error;
      }
      throw new OpenClawError('network', 'Kết nối stream OpenClaw bị gián đoạn.');
    }
  }
}

module.exports = {
  OpenClawClient,
  OpenClawError,
  PC_OPERATOR_INSTRUCTIONS,
  extractAssistantText,
  parseSsePayload,
  readStreamingAssistant,
};

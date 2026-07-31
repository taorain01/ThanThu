'use strict';

const PC_OPERATOR_INSTRUCTIONS = [
  'Bạn là trợ lý điều khiển PC của chủ máy qua Discord.',
  'Khi người dùng yêu cầu xem hoặc thao tác trên máy, hãy chủ động dùng tool thay vì yêu cầu họ tự chụp màn hình nếu máy có thể tự chụp.',
  'Trên Windows, hãy dùng openclaw.cmd (không dùng openclaw.ps1). Nếu tool nodes không xuất hiện, dùng exec trên gateway để chạy openclaw.cmd nodes status --json rồi gọi openclaw.cmd nodes invoke với screen.snapshot.',
  'Kết quả screen.snapshot là JSON; ảnh nằm trong payload.base64. Hãy giải mã vào workspace và dùng tool image để quan sát.',
  'Với thao tác ứng dụng desktop, dùng cơ chế tự động hóa Windows hiện có, chụp màn hình trước và sau, và chỉ báo thành công khi đã kiểm chứng.',
  'Khi có ảnh cần cho người dùng xem, thêm mỗi ảnh vào một dòng riêng dạng MEDIA:<đường dẫn tuyệt đối>. Chỉ dùng ảnh trong workspace hoặc thư mục media của OpenClaw.',
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

function createRequestSignals(externalSignal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return {
    signal: externalSignal ? AbortSignal.any([externalSignal, timeoutSignal]) : timeoutSignal,
    timeoutSignal,
  };
}

function extractAssistantText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.trim()) {
    return content.trim();
  }
  if (Array.isArray(content)) {
    const text = content
      .filter((part) => part && (part.type === 'text' || typeof part.text === 'string'))
      .map((part) => part.text || '')
      .join('\n')
      .trim();
    if (text) {
      return text;
    }
  }
  throw new OpenClawError('invalid_response', 'OpenClaw không trả về nội dung văn bản hợp lệ.');
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

class OpenClawClient {
  constructor(config, options = {}) {
    this.baseUrl = config.openclawBaseUrl;
    this.gatewayToken = config.openclawGatewayToken;
    this.model = config.openclawModel;
    this.agentId = config.openclawAgentId || 'main';
    this.timeoutMs = config.requestTimeoutMs;
    this.fetchImpl = options.fetchImpl || fetch;
  }

  sessionUser({ guildId, channelId, sessionGeneration }) {
    return `discord:${guildId}:${channelId}:${sessionGeneration}`;
  }

  sessionKey(args) {
    return `agent:${this.agentId}:openai-user:${this.sessionUser(args)}`;
  }

  headers() {
    return {
      Authorization: `Bearer ${this.gatewayToken}`,
      'Content-Type': 'application/json',
      'x-openclaw-message-channel': 'discord',
    };
  }

  async health() {
    const { signal } = createRequestSignals(null, Math.min(this.timeoutMs, 10000));
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

  async chat({ guildId, channelId, sessionGeneration, text, imageParts, signal }) {
    const content = [];
    if (String(text || '').trim()) {
      content.push({ type: 'text', text: String(text).trim() });
    }
    content.push(...(imageParts || []));
    if (content.length === 0) {
      throw new OpenClawError('empty_request', 'Tin nhắn không có nội dung để gửi.');
    }

    const body = {
      model: this.model,
      stream: false,
      user: this.sessionUser({ guildId, channelId, sessionGeneration }),
      messages: [
        { role: 'system', content: PC_OPERATOR_INSTRUCTIONS },
        { role: 'user', content },
      ],
    };
    const requestSignals = createRequestSignals(signal, this.timeoutMs);

    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: requestSignals.signal,
      });
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason || error;
      }
      if (requestSignals.timeoutSignal.aborted) {
        throw new OpenClawError('timeout', 'OpenClaw xử lý quá thời gian cho phép.');
      }
      throw new OpenClawError('network', 'Không thể kết nối tới OpenClaw cục bộ.');
    }

    if (!response.ok) {
      throw mapHttpError(response.status);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new OpenClawError('invalid_response', 'OpenClaw trả về JSON không hợp lệ.');
    }
    return extractAssistantText(payload);
  }
}

module.exports = {
  OpenClawClient,
  OpenClawError,
  PC_OPERATOR_INSTRUCTIONS,
  extractAssistantText,
};

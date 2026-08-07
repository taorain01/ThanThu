'use strict';

const { Agent } = require('undici');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

// Backend proxy (vd xpiki) trả model Claude dạng "claude-opus-5" không prefix,
// nhưng OpenClaw chỉ nhận ID đầy đủ "anthropic/claude-opus-5". Map về đúng chuẩn.
function normalizeBackendModelId(id) {
  if (id && !id.includes('/') && /^claude-/i.test(id)) {
    return `anthropic/${id}`;
  }
  return id;
}

function readBackendCredentials() {
  try {
    const raw = fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8');
    const data = JSON.parse(raw);
    const env = data?.env || {};
    const baseUrl = String(env.ANTHROPIC_BASE_URL || '').trim().replace(/\/+$/, '');
    const apiKey = String(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || '').trim();
    if (baseUrl && apiKey) {
      return { baseUrl, apiKey };
    }
  } catch {
    // settings.json không đọc được
  }
  return null;
}

const PC_OPERATOR_INSTRUCTIONS = [
  'Bạn là trợ lý điều khiển PC của chủ máy qua Discord.',
  'Khi người dùng yêu cầu xem hoặc thao tác trên máy, hãy chủ động dùng tool thay vì yêu cầu họ tự chụp màn hình nếu máy có thể tự chụp.',
  'Trên Windows, hãy dùng openclaw.cmd (không dùng openclaw.ps1). Nếu tool nodes không xuất hiện, dùng exec trên gateway để chạy openclaw.cmd nodes status --json rồi gọi openclaw.cmd nodes invoke với screen.snapshot.',
  'Khi cần chụp màn hình PC, KHÔNG tự viết script Python/PowerShell và không tự giải mã base64. Chỉ cần dùng exec chạy đúng một lệnh này, gõ nguyên văn không thêm dấu ngoặc và không đổi dấu gạch chéo: node C:/oc-tools/shot.js --out C:/Users/songt/.openclaw/workspace/screenshot.png . Lệnh in một dòng JSON có ok và path; nếu ok=true thì ảnh đã lưu xong, hãy dùng tool image để xem nếu cần quan sát nội dung.',
  'Kết quả screen.snapshot là JSON; ảnh nằm trong payload.base64. Hãy giải mã vào workspace và dùng tool image để quan sát.',
  'Với thao tác ứng dụng desktop, dùng cơ chế tự động hóa Windows hiện có, chụp màn hình trước và sau, và chỉ báo thành công khi đã kiểm chứng.',
  'Khi có file ảnh thành phẩm cần cho người dùng xem, thêm mỗi ảnh vào một dòng riêng dạng MEDIA:<đường dẫn tuyệt đối>. Không đánh dấu MEDIA cho screenshot kiểm tra nội bộ.',
  'Khi người dùng yêu cầu gửi tin nhắn hoặc file vào một Discord channel theo tên hoặc ID, không dùng tool message vì Discord channel native của OpenClaw chưa được cài. Hãy tạo request JSON UTF-8 gồm channel, content và files rồi dùng exec chạy: node "C:\\Bot Discord\\Bot OpenClaw\\scripts\\send-discord-message.js" --request "<đường-dẫn-request.json>".',
  'Đường dẫn thư mục ảnh chính luôn là F:\\Hình Ảnh (chữ "Hình Ảnh" đúng dấu tiếng Việt). KHÔNG được tạo hoặc ghi vào thư mục tên lỗi ký tự như "HĂ¬nh áº¢nh". Không bao giờ nhúng đường dẫn tiếng Việt vào file .ps1 chạy bằng PowerShell — PowerShell 5.1 đọc file UTF-8 không BOM theo ANSI làm hỏng ký tự; nếu cần lệnh PowerShell có đường dẫn tiếng Việt, dùng -EncodedCommand (Base64 UTF-16LE) hoặc viết script Node. Nếu vô tình tạo ra thư mục tên lỗi, chạy: node "C:\\Bot Discord\\Bot OpenClaw\\scripts\\fix-media-folder-mojibake.js" để gộp về đúng rồi tiếp tục dùng đường dẫn chuẩn.',
  'Sender cục bộ resolve chính xác tên hoặc ID channel theo từng lần gửi nhưng chỉ trong đúng server của bot. Phải dùng đúng channel được yêu cầu cho job hiện tại; không tái sử dụng channel hardcode từ job khác. Chỉ báo đã gửi khi output có ok=true và messageId; không đưa Discord token vào prompt, request hoặc log.',
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

// Chuỗi lỗi user-facing do Gateway phát hành khi lượt chạy agent thất bại
// (nguồn: formatRawAssistantErrorForUi và terminal-error của OpenClaw 2026.7.1).
// Bot dùng chúng để nhận diện phản hồi lỗi và tự retry thay vì chuyển tiếp tới Discord.
const GATEWAY_FAILURE_TEXT_PATTERN = /^(?:LLM request failed|LLM error|LLM streaming response|The AI service|The provider returned an HTML error page|Error: internal error|HTTP \d{3}:)/;

function isGatewayFailureText(value) {
  const text = String(value || '').trim();
  if (!text || text.includes('\n') || text.length > 200) {
    return false;
  }
  return GATEWAY_FAILURE_TEXT_PATTERN.test(text);
}

// Gateway đánh dấu lượt là `non_deliverable_terminal_turn` khi model kết thúc
// (stopReason "stop") mà không sinh phần text nào — hay gặp với model cục bộ
// suy luận nhiều: chúng trả lời xong trong <think> rồi phát EOS luôn. Lúc đó
// gateway trả về đúng một trong hai chuỗi dưới đây thay cho câu trả lời. Đây
// KHÔNG phải lỗi provider nên GATEWAY_FAILURE_TEXT_PATTERN không khớp; bot phải
// nhận diện riêng để nhắc model chốt lại câu trả lời (ngữ cảnh vẫn còn trong
// session, và tool có thể đã chạy xong).
const GATEWAY_NON_DELIVERABLE_TEXT_PATTERN = /^⚠️\s*Agent couldn't generate a response\./;

function isGatewayNonDeliverableText(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 300) {
    return false;
  }
  return GATEWAY_NON_DELIVERABLE_TEXT_PATTERN.test(text);
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

function createOpenClawDispatcher() {
  return new Agent({
    // RequestDeadline quản lý timeout theo hoạt động và tổng thời gian của job.
    headersTimeout: 0,
    bodyTimeout: 0,
  });
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
    this.dispatcher = options.dispatcher === undefined
      ? (options.fetchImpl ? null : createOpenClawDispatcher())
      : options.dispatcher;
  }

  requestOptions(options) {
    return this.dispatcher ? { ...options, dispatcher: this.dispatcher } : options;
  }

  sessionUser({ guildId, channelId, sessionGeneration }) {
    return `discord:${guildId}:${channelId}:${sessionGeneration}`;
  }

  // Kênh chạy model cục bộ được route sang agent riêng (`local`) để chỉ agent đó
  // bật localModelLean; các kênh Claude/9router giữ nguyên bộ tool đầy đủ trên `main`.
  resolveAgentId(modelProfile) {
    return modelProfile === 'local' ? 'local' : this.agentId;
  }

  sessionKey(args) {
    return `agent:${this.resolveAgentId(args?.modelProfile)}:openai-user:${this.sessionUser(args)}`;
  }

  headers(backendModel, agentId) {
    const headers = {
      Authorization: `Bearer ${this.gatewayToken}`,
      'Content-Type': 'application/json',
      'x-openclaw-message-channel': 'discord',
    };
    if (agentId) {
      headers['x-openclaw-agent-id'] = agentId;
    }
    if (backendModel) {
      headers['x-openclaw-model'] = normalizeBackendModelId(backendModel);
    }
    return headers;
  }

  async health() {
    const signal = AbortSignal.timeout(10000);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/models`, this.requestOptions({
        method: 'GET',
        headers: { Authorization: `Bearer ${this.gatewayToken}` },
        signal,
      }));
      return { ok: response.ok, status: response.status };
    } catch {
      return { ok: false, status: null };
    }
  }

  async listModels() {
    const signal = AbortSignal.timeout(15000);

    // Gọi thẳng backend API (không qua Gateway — Gateway chỉ trả model routing)
    const creds = readBackendCredentials();
    if (creds) {
      // Thử cả 2 endpoint: /models và /v1/models (tùy proxy)
      const endpoints = [
        `${creds.baseUrl}/models`,
        `${creds.baseUrl}/v1/models`,
      ];
      for (const modelsUrl of endpoints) {
        try {
          const response = await this.fetchImpl(modelsUrl, this.requestOptions({
            method: 'GET',
            headers: { Authorization: `Bearer ${creds.apiKey}` },
            signal,
          }));
          if (response.ok) {
            const payload = await response.json();
            const models = (payload?.data || payload?.models || [])
              .filter((m) => m?.id && typeof m.id === 'string')
              .map((m) => ({
                id: normalizeBackendModelId(m.id),
                displayName: m.display_name || m.id,
                ownedBy: m.owned_by || '',
              }));
            if (models.length > 0) {
              return models;
            }
          }
        } catch {
          // Thử endpoint tiếp theo
        }
      }
    }

    // Fallback: gọi qua Gateway
    const response = await this.fetchImpl(`${this.baseUrl}/v1/models`, this.requestOptions({
      method: 'GET',
      headers: { Authorization: `Bearer ${this.gatewayToken}` },
      signal,
    }));
    if (!response.ok) {
      throw mapHttpError(response.status);
    }
    const payload = await response.json();
    const models = (payload?.data || payload?.models || [])
      .filter((m) => m?.id && typeof m.id === 'string')
      .map((m) => ({
        id: normalizeBackendModelId(m.id),
        displayName: m.display_name || m.id,
        ownedBy: m.owned_by || '',
      }));
    return models;
  }

  async chat({
    guildId,
    channelId,
    sessionGeneration,
    modelProfile,
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
      response = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, this.requestOptions({
        method: 'POST',
        headers: this.headers(backendModel, this.resolveAgentId(modelProfile)),
        body: JSON.stringify(body),
        signal,
      }));
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
      throw new OpenClawError('stream_interrupted', 'Kết nối stream OpenClaw bị gián đoạn.');
    }
  }

  async close() {
    await this.dispatcher?.close?.();
  }
}

module.exports = {
  OpenClawClient,
  OpenClawError,
  PC_OPERATOR_INSTRUCTIONS,
  createOpenClawDispatcher,
  extractAssistantText,
  isGatewayFailureText,
  isGatewayNonDeliverableText,
  parseSsePayload,
  readStreamingAssistant,
};

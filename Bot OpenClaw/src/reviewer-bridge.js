'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

class ReviewerBridgeError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'ReviewerBridgeError';
    this.code = code;
    this.status = status;
  }
}

async function ensureBridgeToken(filePath) {
  try {
    const token = String(await fs.readFile(filePath, 'utf8')).trim();
    if (/^[a-f0-9]{64}$/.test(token)) return token;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const token = crypto.randomBytes(32).toString('hex');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  return token;
}

function jsonResponse(response, status, payload) {
  const body = `${JSON.stringify(payload)}\n`;
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

async function readJsonBody(request, maxBytes = 512 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new ReviewerBridgeError('payload_too_large', 'Yêu cầu Reviewer vượt giới hạn.', 413);
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ReviewerBridgeError('invalid_json', 'JSON gửi tới Reviewer không hợp lệ.');
  }
}

function publicJob(job) {
  if (!job) return null;
  const tasks = Object.values(job.tasks || {}).map((task) => ({
    taskId: task.taskId,
    label: task.label || task.prompt || '',
    status: task.status,
    progressSummary: task.progressSummary || '',
    updatedAt: task.updatedAt || null,
  }));
  const artifacts = Object.values(job.artifacts || {}).map((artifact) => ({
    id: artifact.id,
    label: artifact.label || '',
    status: artifact.status,
    order: artifact.order,
    extension: artifact.extension,
    size: artifact.size,
    createdAt: artifact.createdAt,
  }));
  return {
    id: job.id,
    channelId: job.channelId,
    status: job.status,
    backendModel: job.backendModel,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    lastActivityAt: job.lastActivityAt,
    lastEvent: job.lastEvent,
    terminalReason: job.terminalReason,
    responseSent: job.responseSent,
    responseText: job.responseText || '',
    streamPreview: job.streamPreview || '',
    tasks,
    artifacts,
  };
}

async function startReviewerBridge(options) {
  const token = await ensureBridgeToken(options.tokenPath);
  const clients = new Set();
  const host = '127.0.0.1';
  const requestedPort = options.port === undefined ? 18792 : Number(options.port);

  const authorized = (request, requestUrl) => {
    const header = String(request.headers.authorization || '');
    const supplied = header.startsWith('Bearer ') ? header.slice(7) : requestUrl.searchParams.get('token');
    if (!supplied) return false;
    const suppliedBytes = Buffer.from(supplied);
    const tokenBytes = Buffer.from(token);
    if (suppliedBytes.length !== tokenBytes.length) return false;
    return crypto.timingSafeEqual(suppliedBytes, tokenBytes);
  };

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', `http://${host}:${requestedPort}`);
    try {
      if (request.method === 'GET' && requestUrl.pathname === '/health') {
        jsonResponse(response, 200, {
          ok: true,
          service: 'openclaw-reviewer-bridge',
          ready: options.isReady?.() === true,
        });
        return;
      }
      if (!authorized(request, requestUrl)) {
        throw new ReviewerBridgeError('unauthorized', 'Reviewer bridge từ chối token.', 401);
      }
      if (request.method === 'GET' && requestUrl.pathname === '/events') {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        response.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
        clients.add(response);
        request.on('close', () => clients.delete(response));
        return;
      }
      if (request.method === 'GET' && requestUrl.pathname === '/channels') {
        jsonResponse(response, 200, { ok: true, channels: await options.listChannels() });
        return;
      }
      if (request.method === 'GET' && requestUrl.pathname === '/jobs') {
        const limit = Math.min(100, Math.max(1, Number(requestUrl.searchParams.get('limit')) || 30));
        jsonResponse(response, 200, {
          ok: true,
          jobs: options.listJobs(limit).map(publicJob),
        });
        return;
      }
      if (request.method === 'POST' && requestUrl.pathname === '/commands') {
        const body = await readJsonBody(request);
        const text = String(body.text || '').trim();
        const channelId = String(body.channelId || '').trim();
        if (!text || text.length > 100000) {
          throw new ReviewerBridgeError('invalid_command', 'Nội dung lệnh trống hoặc quá dài.');
        }
        if (!/^\d{17,20}$/.test(channelId)) {
          throw new ReviewerBridgeError('invalid_channel', 'Discord channel ID không hợp lệ.');
        }
        const job = await options.submitCommand({
          channelId,
          text,
          albumName: String(body.albumName || '').trim(),
          skillName: String(body.skillName || '').trim(),
        });
        jsonResponse(response, 202, { ok: true, job: publicJob(job) });
        return;
      }
      const jobAction = requestUrl.pathname.match(/^\/commands\/([^/]+)\/(stop|resume)$/);
      if (request.method === 'POST' && jobAction) {
        const [, jobId, action] = jobAction;
        const job = action === 'stop'
          ? await options.stopCommand(jobId)
          : await options.resumeCommand(jobId);
        jsonResponse(response, 200, { ok: true, job: publicJob(job) });
        return;
      }
      throw new ReviewerBridgeError('not_found', 'Reviewer bridge không có endpoint này.', 404);
    } catch (error) {
      const status = error instanceof ReviewerBridgeError ? error.status : 500;
      options.logger?.warn?.('Reviewer bridge xử lý request thất bại.', {
        name: error.name,
        code: error.code,
        path: requestUrl.pathname,
      });
      jsonResponse(response, status, {
        ok: false,
        code: error.code || 'reviewer_bridge_error',
        message: error instanceof ReviewerBridgeError
          ? error.message
          : 'Reviewer bridge gặp lỗi nội bộ.',
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const port = server.address()?.port || requestedPort;
  const publish = (event, payload) => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of clients) {
      try {
        client.write(frame);
      } catch {
        clients.delete(client);
      }
    }
  };

  const heartbeat = setInterval(() => publish('heartbeat', { at: Date.now() }), 15000);
  heartbeat.unref?.();
  options.logger?.info?.('Reviewer bridge đã sẵn sàng.', { host, port });

  return {
    host,
    port,
    tokenPath: options.tokenPath,
    publishJob(job) {
      publish('job', publicJob(job));
    },
    async close() {
      clearInterval(heartbeat);
      for (const client of clients) client.end();
      clients.clear();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = {
  ReviewerBridgeError,
  ensureBridgeToken,
  publicJob,
  startReviewerBridge,
};

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_DISCOVERY_PATH = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'RainderPlaylist',
  'openclaw-bridge.json',
);

class RainderClientError extends Error {
  constructor(code, message, status = null, payload = null) {
    super(message);
    this.name = 'RainderClientError';
    this.code = code;
    this.status = status;
    this.payload = payload;
  }
}

function validateDiscovery(payload) {
  const token = String(payload?.token || '').trim();
  let url;
  try {
    url = new URL(String(payload?.url || ''));
  } catch {
    throw new RainderClientError('offline', 'Rainder bridge discovery is invalid.');
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !token) {
    throw new RainderClientError('offline', 'Rainder bridge discovery is invalid.');
  }
  return { url: url.origin, token };
}

class RainderClient {
  constructor(options = {}) {
    this.discoveryPath = options.discoveryPath || process.env.RAINDER_BRIDGE_DISCOVERY_PATH || DEFAULT_DISCOVERY_PATH;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.timeoutMs = Number(options.timeoutMs || 5000);
    this.discoveryProvider = options.discoveryProvider || null;
  }

  async readDiscovery() {
    if (this.discoveryProvider) {
      return validateDiscovery(await this.discoveryProvider());
    }
    let raw;
    try {
      raw = await fs.promises.readFile(this.discoveryPath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new RainderClientError('offline', 'Rainder is not running.');
      }
      throw new RainderClientError('offline', 'Cannot read Rainder bridge discovery.');
    }
    try {
      return validateDiscovery(JSON.parse(raw));
    } catch (error) {
      if (error instanceof RainderClientError) throw error;
      throw new RainderClientError('offline', 'Rainder bridge discovery is invalid.');
    }
  }

  async request(method, pathname, options = {}) {
    if (typeof this.fetchImpl !== 'function') {
      throw new RainderClientError('unavailable', 'Fetch API is unavailable.');
    }
    const discovery = await this.readDiscovery();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = {
      Authorization: `Bearer ${discovery.token}`,
      Accept: 'application/json',
    };
    let body;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = String(options.idempotencyKey);
    }
    try {
      const response = await this.fetchImpl(`${discovery.url}${pathname}`, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok) {
        const message = String(payload?.error || `Rainder returned HTTP ${response.status}.`);
        if (response.status === 401) {
          throw new RainderClientError('auth', message, response.status, payload);
        }
        if (response.status === 409) {
          throw new RainderClientError('conflict', message, response.status, payload);
        }
        throw new RainderClientError(payload?.code || 'http', message, response.status, payload);
      }
      return payload;
    } catch (error) {
      if (error instanceof RainderClientError) throw error;
      if (error?.name === 'AbortError') {
        throw new RainderClientError('timeout', 'Rainder did not respond in time.');
      }
      throw new RainderClientError('offline', 'Rainder is not running or the bridge is unreachable.');
    } finally {
      clearTimeout(timer);
    }
  }

  health() {
    return this.request('GET', '/health');
  }

  listUploads() {
    return this.request('GET', '/v1/youtube/uploads');
  }

  startUploads(itemIds = [], options = {}) {
    return this.request('POST', '/v1/youtube/uploads/start', {
      body: {
        item_ids: itemIds.length ? itemIds : undefined,
        source: options.source || 'discord',
        request_id: options.requestId || undefined,
      },
      idempotencyKey: options.idempotencyKey || options.requestId,
    });
  }

  stopUpload(runId = '') {
    return this.request('POST', '/v1/youtube/uploads/stop', {
      body: { run_id: runId || undefined },
    });
  }
}

module.exports = {
  DEFAULT_DISCOVERY_PATH,
  RainderClient,
  RainderClientError,
  validateDiscovery,
};

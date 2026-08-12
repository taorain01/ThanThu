'use strict';

const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const ACTIVE_LEDGER_STATUSES = Object.freeze(['queued', 'running']);

class OpenClawTaskError extends Error {
  constructor(message, cause, options = {}) {
    super(message, { cause });
    this.name = 'OpenClawTaskError';
    this.code = options.code || 'task_unavailable';
    this.status = options.status || null;
  }
}

function defaultOpenClawModulePath() {
  return path.join(
    process.env.APPDATA || '',
    'npm',
    'node_modules',
    'openclaw',
    'openclaw.mjs',
  );
}

function cloneTasks(tasks) {
  return tasks.map((task) => ({ ...task }));
}

class OpenClawTaskClient {
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl || '').replace(/\/+$/, '');
    this.gatewayToken = String(options.gatewayToken || '');
    this.rpcTimeoutMs = Math.max(1000, Number(options.rpcTimeoutMs) || 5000);
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.nodePath = options.nodePath || process.execPath;
    this.openclawModulePath = options.openclawModulePath || defaultOpenClawModulePath();
    this.timeoutMs = options.timeoutMs || 25000;
    this.execFileImpl = options.execFileImpl || execFileAsync;
    this.listCacheMs = Math.max(0, Number(options.listCacheMs) || 0);
    // CLI liệt kê TOÀN BỘ ledger task (quan sát 12-18 giây với ~400 task) nên
    // chỉ được dùng làm fallback thưa; giữa hai lần fallback bot dùng snapshot
    // cuối và chờ RPC hồi phục thay vì spawn CLI liên tục.
    this.cliFallbackMs = Math.max(1000, Number(options.cliFallbackMs) || 120000);
    this.now = options.now || Date.now;
    this.listSnapshot = null;
    this.listSnapshotAt = 0;
    this.listPromise = null;
    this.lastCliFallbackAt = 0;
    this.lastSyncInfo = {
      source: 'none',
      latencyMs: null,
      at: null,
    };
  }

  get rpcEnabled() {
    return Boolean(this.baseUrl && this.gatewayToken && this.fetchImpl);
  }

  getLastSyncInfo() {
    return { ...this.lastSyncInfo };
  }

  async runCli(args, expectJson = false) {
    try {
      const result = await this.execFileImpl(
        this.nodePath,
        [this.openclawModulePath, ...args],
        {
          windowsHide: true,
          timeout: this.timeoutMs,
          maxBuffer: 8 * 1024 * 1024,
          encoding: 'utf8',
        },
      );
      if (!expectJson) {
        return String(result.stdout || '').trim();
      }
      try {
        return JSON.parse(String(result.stdout || ''));
      } catch (error) {
        throw new OpenClawTaskError('OpenClaw tasks trả về JSON không hợp lệ.', error, {
          code: 'invalid_json',
        });
      }
    } catch (error) {
      if (error instanceof OpenClawTaskError) {
        throw error;
      }
      throw new OpenClawTaskError('Không thể truy vấn durable task của OpenClaw.', error, {
        code: 'cli_unavailable',
      });
    }
  }

  async rpc(method, params = {}) {
    if (!this.rpcEnabled) {
      throw new OpenClawTaskError('Admin HTTP RPC của OpenClaw chưa được cấu hình.', null, {
        code: 'rpc_disabled',
      });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.rpcTimeoutMs);
    timer.unref?.();
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/v1/admin/rpc`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.gatewayToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: randomUUID(), method, params }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new OpenClawTaskError('Không kết nối được Admin HTTP RPC của OpenClaw.', error, {
        code: error?.name === 'AbortError' ? 'rpc_timeout' : 'rpc_unavailable',
      });
    } finally {
      clearTimeout(timer);
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new OpenClawTaskError('Admin HTTP RPC trả về JSON không hợp lệ.', error, {
        code: 'invalid_json',
        status: response.status,
      });
    }
    if (!response.ok || payload?.ok !== true) {
      const message = String(payload?.error?.message || 'Gateway từ chối yêu cầu task.');
      const notFound = /task not found/i.test(message);
      throw new OpenClawTaskError('Admin HTTP RPC không xử lý được yêu cầu task.', null, {
        code: notFound ? 'task_not_found' : 'rpc_rejected',
        status: response.status,
      });
    }
    return payload.payload || {};
  }

  async listRpc() {
    const tasks = [];
    let cursor;
    do {
      const payload = await this.rpc('tasks.list', {
        status: ACTIVE_LEDGER_STATUSES,
        limit: 500,
        ...(cursor ? { cursor } : {}),
      });
      tasks.push(...(Array.isArray(payload.tasks) ? payload.tasks : []));
      cursor = payload.nextCursor || null;
    } while (cursor);
    return tasks;
  }

  async listForSession(sessionKey) {
    const normalized = String(sessionKey || '').trim();
    if (!normalized) {
      return [];
    }
    if (!this.rpcEnabled) {
      return (await this.listCli()).filter((task) => (
        task.requesterSessionKey === normalized
        || task.ownerKey === normalized
        || task.childSessionKey === normalized
      ));
    }
    const tasks = [];
    let cursor;
    do {
      const payload = await this.rpc('tasks.list', {
        sessionKey: normalized,
        limit: 500,
        ...(cursor ? { cursor } : {}),
      });
      tasks.push(...(Array.isArray(payload.tasks) ? payload.tasks : []));
      cursor = payload.nextCursor || null;
    } while (cursor);
    return tasks;
  }

  async listCli() {
    const payload = await this.runCli(['tasks', 'list', '--json'], true);
    return Array.isArray(payload?.tasks) ? payload.tasks : [];
  }

  async list(options = {}) {
    const fresh = options.fresh === true;
    const maxAgeMs = Math.max(0, Number(options.maxAgeMs) || this.listCacheMs);
    const now = this.now();
    if (!fresh && this.listSnapshot && now - this.listSnapshotAt < maxAgeMs) {
      return cloneTasks(this.listSnapshot);
    }
    if (this.listPromise) {
      return cloneTasks(await this.listPromise);
    }

    this.listPromise = (async () => {
      const startedAt = this.now();
      let tasks;
      let source = 'cli';
      if (this.rpcEnabled) {
        try {
          tasks = await this.listRpc();
          source = 'rpc';
        } catch (rpcError) {
          const fallbackDue = !this.listSnapshot
            || startedAt - this.lastCliFallbackAt >= this.cliFallbackMs;
          if (!fallbackDue) {
            throw rpcError;
          }
          this.lastCliFallbackAt = startedAt;
          tasks = await this.listCli();
        }
      } else {
        tasks = await this.listCli();
      }
      this.listSnapshot = cloneTasks(tasks);
      this.listSnapshotAt = this.now();
      this.lastSyncInfo = {
        source,
        latencyMs: Math.max(0, this.listSnapshotAt - startedAt),
        at: new Date(this.listSnapshotAt).toISOString(),
      };
      return this.listSnapshot;
    })();
    try {
      return cloneTasks(await this.listPromise);
    } finally {
      this.listPromise = null;
    }
  }

  async show(lookup) {
    const taskId = String(lookup);
    if (this.rpcEnabled) {
      const payload = await this.rpc('tasks.get', { taskId });
      return payload.task || payload;
    }
    return this.runCli(['tasks', 'show', taskId, '--json'], true);
  }

  async cancel(lookup, reason = 'Người dùng Discord yêu cầu dừng job.') {
    const taskId = String(lookup);
    if (this.rpcEnabled) {
      try {
        return await this.rpc('tasks.cancel', { taskId, reason });
      } catch (error) {
        await this.runCli(['tasks', 'cancel', taskId]);
        return { found: true, cancelled: true, source: 'cli' };
      }
    }
    await this.runCli(['tasks', 'cancel', taskId]);
    return { found: true, cancelled: true, source: 'cli' };
  }
}

module.exports = {
  ACTIVE_LEDGER_STATUSES,
  OpenClawTaskClient,
  OpenClawTaskError,
  defaultOpenClawModulePath,
};

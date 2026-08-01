'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

class OpenClawTaskError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'OpenClawTaskError';
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

class OpenClawTaskClient {
  constructor(options = {}) {
    this.nodePath = options.nodePath || process.execPath;
    this.openclawModulePath = options.openclawModulePath || defaultOpenClawModulePath();
    this.timeoutMs = options.timeoutMs || 15000;
    this.execFileImpl = options.execFileImpl || execFileAsync;
    this.listCacheMs = Math.max(0, Number(options.listCacheMs) || 0);
    this.now = options.now || Date.now;
    this.listSnapshot = null;
    this.listSnapshotAt = 0;
    this.listPromise = null;
  }

  async run(args, expectJson = false) {
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
        throw new OpenClawTaskError('OpenClaw tasks trả về JSON không hợp lệ.', error);
      }
    } catch (error) {
      if (error instanceof OpenClawTaskError) {
        throw error;
      }
      throw new OpenClawTaskError('Không thể truy vấn durable task của OpenClaw.', error);
    }
  }

  async list(options = {}) {
    const fresh = options.fresh === true;
    const maxAgeMs = Math.max(0, Number(options.maxAgeMs) || this.listCacheMs);
    const now = this.now();
    if (!fresh && this.listSnapshot && now - this.listSnapshotAt < maxAgeMs) {
      return this.listSnapshot.map((task) => ({ ...task }));
    }
    if (this.listPromise) {
      const tasks = await this.listPromise;
      return tasks.map((task) => ({ ...task }));
    }

    this.listPromise = (async () => {
      const payload = await this.run(['tasks', 'list', '--json'], true);
      const tasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
      this.listSnapshot = tasks.map((task) => ({ ...task }));
      this.listSnapshotAt = this.now();
      return this.listSnapshot;
    })();
    try {
      const tasks = await this.listPromise;
      return tasks.map((task) => ({ ...task }));
    } finally {
      this.listPromise = null;
    }
  }

  async show(lookup) {
    return this.run(['tasks', 'show', String(lookup), '--json'], true);
  }

  async cancel(lookup) {
    await this.run(['tasks', 'cancel', String(lookup)]);
  }
}

module.exports = {
  OpenClawTaskClient,
  OpenClawTaskError,
  defaultOpenClawModulePath,
};

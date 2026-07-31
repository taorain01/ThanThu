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

  async list() {
    const payload = await this.run(['tasks', 'list', '--json'], true);
    return Array.isArray(payload?.tasks) ? payload.tasks : [];
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

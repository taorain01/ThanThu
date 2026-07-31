'use strict';

class RequestDeadline {
  constructor(options = {}) {
    this.idleTimeoutMs = options.idleTimeoutMs;
    this.maxRuntimeMs = options.maxRuntimeMs;
    this.controller = new AbortController();
    this.idleTimer = null;
    this.maxTimer = null;
    this.externalSignal = options.signal || null;
    this.externalAbort = null;

    if (this.externalSignal) {
      this.externalAbort = () => this.abort(this.externalSignal.reason || new Error('Yêu cầu đã bị dừng.'));
      if (this.externalSignal.aborted) {
        this.externalAbort();
      } else {
        this.externalSignal.addEventListener('abort', this.externalAbort, { once: true });
      }
    }

    this.maxTimer = setTimeout(() => {
      this.abort(Object.assign(new Error('OpenClaw đã chạy quá thời lượng tối đa.'), {
        name: 'OpenClawMaxRuntimeError',
        code: 'max_runtime',
      }));
    }, this.maxRuntimeMs);
    this.maxTimer.unref?.();
    this.touch();
  }

  get signal() {
    return this.controller.signal;
  }

  touch() {
    if (this.controller.signal.aborted) {
      return;
    }
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      this.abort(Object.assign(new Error('OpenClaw không có hoạt động mới quá thời gian cho phép.'), {
        name: 'OpenClawIdleTimeoutError',
        code: 'idle_timeout',
      }));
    }, this.idleTimeoutMs);
    this.idleTimer.unref?.();
  }

  abort(reason) {
    if (!this.controller.signal.aborted) {
      this.controller.abort(reason);
    }
  }

  stop() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.maxTimer) {
      clearTimeout(this.maxTimer);
      this.maxTimer = null;
    }
    if (this.externalSignal && this.externalAbort) {
      this.externalSignal.removeEventListener('abort', this.externalAbort);
    }
  }
}

module.exports = {
  RequestDeadline,
};

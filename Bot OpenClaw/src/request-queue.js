'use strict';

class QueueFullError extends Error {
  constructor() {
    super('Hàng đợi OpenClaw đã đầy.');
    this.name = 'QueueFullError';
  }
}

class QueueStoppedError extends Error {
  constructor() {
    super('Yêu cầu đã bị dừng.');
    this.name = 'QueueStoppedError';
  }
}

class SerialRequestQueue {
  constructor(maxPending) {
    this.maxPending = maxPending;
    this.pending = [];
    this.active = null;
  }

  getStatus() {
    return {
      active: Boolean(this.active),
      pending: this.pending.length,
    };
  }

  enqueue(task) {
    if (this.pending.length >= this.maxPending) {
      return Promise.reject(new QueueFullError());
    }

    const promise = new Promise((resolve, reject) => {
      this.pending.push({ task, resolve, reject });
    });
    void this.drain();
    return promise;
  }

  stop() {
    if (this.active) {
      this.active.controller.abort(new QueueStoppedError());
    }
    const waiting = this.pending.splice(0);
    for (const item of waiting) {
      item.reject(new QueueStoppedError());
    }
  }

  async drain() {
    if (this.active || this.pending.length === 0) {
      return;
    }

    const item = this.pending.shift();
    const controller = new AbortController();
    this.active = { controller };
    try {
      const result = await item.task(controller.signal);
      item.resolve(result);
    } catch (error) {
      item.reject(error);
    } finally {
      this.active = null;
      void this.drain();
    }
  }
}

module.exports = {
  QueueFullError,
  QueueStoppedError,
  SerialRequestQueue,
};

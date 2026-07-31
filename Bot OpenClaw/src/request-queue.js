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

  enqueue(task, metadata = {}) {
    if (this.pending.length >= this.maxPending) {
      return Promise.reject(new QueueFullError());
    }

    const promise = new Promise((resolve, reject) => {
      this.pending.push({ task, resolve, reject, metadata });
    });
    void this.drain();
    return promise;
  }

  stop() {
    return this.stopWhere(() => true);
  }

  stopWhere(predicate) {
    let stopped = 0;
    if (this.active && predicate(this.active.metadata)) {
      this.active.controller.abort(new QueueStoppedError());
      stopped += 1;
    }
    const waiting = [];
    const kept = [];
    for (const item of this.pending) {
      if (predicate(item.metadata)) {
        waiting.push(item);
      } else {
        kept.push(item);
      }
    }
    this.pending = kept;
    for (const item of waiting) {
      item.reject(new QueueStoppedError());
      stopped += 1;
    }
    return stopped;
  }

  getDetailedStatus() {
    return {
      ...this.getStatus(),
      activeMetadata: this.active ? { ...this.active.metadata } : null,
      pendingMetadata: this.pending.map((item) => ({ ...item.metadata })),
    };
  }

  async drain() {
    if (this.active || this.pending.length === 0) {
      return;
    }

    const item = this.pending.shift();
    const controller = new AbortController();
    this.active = { controller, metadata: item.metadata };
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

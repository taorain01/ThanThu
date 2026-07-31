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

class SessionRequestQueue {
  constructor(maxPending, maxConcurrent = 1) {
    this.maxPending = maxPending;
    this.maxConcurrent = maxConcurrent;
    this.pending = [];
    this.active = new Map();
  }

  getStatus() {
    return {
      active: this.active.size > 0,
      pending: this.pending.length,
    };
  }

  enqueue(task, metadata = {}) {
    const queueKey = this.queueKey(metadata);
    const canStartImmediately = this.active.size < this.maxConcurrent
      && !this.active.has(queueKey);
    if (!canStartImmediately && this.pending.length >= this.maxPending) {
      return Promise.reject(new QueueFullError());
    }

    const promise = new Promise((resolve, reject) => {
      this.pending.push({ task, resolve, reject, metadata, queueKey });
    });
    this.drain();
    return promise;
  }

  stop() {
    return this.stopWhere(() => true);
  }

  stopWhere(predicate) {
    let stopped = 0;
    for (const item of this.active.values()) {
      if (predicate(item.metadata)) {
        item.controller.abort(new QueueStoppedError());
        stopped += 1;
      }
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
    const activeMetadataList = [...this.active.values()]
      .map((item) => ({ ...item.metadata }));
    return {
      ...this.getStatus(),
      activeCount: this.active.size,
      maxConcurrent: this.maxConcurrent,
      activeMetadata: activeMetadataList[0] || null,
      activeMetadataList,
      pendingMetadata: this.pending.map((item) => ({ ...item.metadata })),
    };
  }

  queueKey(metadata) {
    return String(metadata.sessionKey || metadata.channelId || '__global__');
  }

  drain() {
    while (this.active.size < this.maxConcurrent && this.pending.length > 0) {
      const pendingIndex = this.pending.findIndex((item) => !this.active.has(item.queueKey));
      if (pendingIndex < 0) {
        return;
      }
      const [item] = this.pending.splice(pendingIndex, 1);
      const controller = new AbortController();
      this.active.set(item.queueKey, { controller, metadata: item.metadata });
      void this.run(item, controller);
    }
  }

  async run(item, controller) {
    try {
      const result = await item.task(controller.signal);
      item.resolve(result);
    } catch (error) {
      item.reject(error);
    } finally {
      this.active.delete(item.queueKey);
      this.drain();
    }
  }
}

class SerialRequestQueue extends SessionRequestQueue {
  constructor(maxPending) {
    super(maxPending, 1);
  }
}

module.exports = {
  QueueFullError,
  QueueStoppedError,
  SerialRequestQueue,
  SessionRequestQueue,
};

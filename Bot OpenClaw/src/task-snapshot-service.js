'use strict';

class TaskSnapshotService {
  constructor(options = {}) {
    this.taskClient = options.taskClient;
    this.normalPollMs = Math.max(500, Number(options.normalPollMs) || 2000);
    this.stoppingPollMs = Math.max(500, Number(options.stoppingPollMs) || 1000);
    this.backoffMs = options.backoffMs || [2000, 5000, 10000, 30000];
    this.logger = options.logger;
    this.now = options.now || Date.now;
    this.setTimeoutImpl = options.setTimeoutImpl || setTimeout;
    this.clearTimeoutImpl = options.clearTimeoutImpl || clearTimeout;
    this.consumers = new Map();
    this.taskRequests = new Map();
    this.sessionRequests = new Map();
    this.timer = null;
    this.refreshPromise = null;
    this.failureCount = 0;
    this.closed = false;
    this.lastLoggedSource = null;
  }

  subscribe(id, options = {}) {
    const key = String(id);
    this.consumers.set(key, {
      stopping: options.stopping === true,
      onSnapshot: options.onSnapshot || (async () => {}),
      onError: options.onError || (async () => {}),
    });
    this.schedule(this.nextDelay());
    return () => {
      this.consumers.delete(key);
      if (!this.consumers.size) {
        this.clearTimer();
      }
    };
  }

  setStopping(id, stopping) {
    const consumer = this.consumers.get(String(id));
    if (!consumer) {
      return;
    }
    consumer.stopping = stopping === true;
    if (consumer.stopping) {
      this.schedule(this.stoppingPollMs, { replaceLater: true });
    }
  }

  nextDelay() {
    if (this.failureCount > 0) {
      return this.backoffMs[Math.min(this.failureCount - 1, this.backoffMs.length - 1)];
    }
    return [...this.consumers.values()].some((consumer) => consumer.stopping)
      ? this.stoppingPollMs
      : this.normalPollMs;
  }

  clearTimer() {
    if (this.timer) {
      this.clearTimeoutImpl(this.timer);
      this.timer = null;
    }
  }

  schedule(delayMs, options = {}) {
    if (this.closed || !this.consumers.size) {
      return;
    }
    if (this.timer) {
      if (!options.replaceLater) {
        return;
      }
      this.clearTimer();
    }
    this.timer = this.setTimeoutImpl(() => {
      this.timer = null;
      void this.tick();
    }, Math.max(0, Number(delayMs) || 0));
    this.timer.unref?.();
  }

  async tick() {
    if (this.closed || !this.consumers.size) {
      return;
    }
    try {
      await this.refresh({ reason: 'poll' });
    } catch {
      // Lỗi đã được phát cho từng consumer trong refresh().
    } finally {
      this.schedule(this.nextDelay());
    }
  }

  async refresh(options = {}) {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    this.clearTimer();
    this.refreshPromise = (async () => {
      const startedAt = this.now();
      try {
        const tasks = await this.taskClient.list({ fresh: options.fresh !== false });
        const finishedAt = this.now();
        const info = this.taskClient.getLastSyncInfo?.() || {};
        const snapshot = {
          tasks,
          source: info.source || 'unknown',
          latencyMs: Number.isFinite(info.latencyMs)
            ? info.latencyMs
            : Math.max(0, finishedAt - startedAt),
          at: info.at || new Date(finishedAt).toISOString(),
          reason: options.reason || 'manual',
        };
        this.failureCount = 0;
        if (snapshot.source !== this.lastLoggedSource || snapshot.latencyMs >= this.normalPollMs) {
          this.logger?.info('Đã đồng bộ durable task OpenClaw.', {
            source: snapshot.source,
            taskRpcMs: snapshot.latencyMs,
            tasks: snapshot.tasks.length,
            consumers: this.consumers.size,
          });
          this.lastLoggedSource = snapshot.source;
        }
        await Promise.allSettled([...this.consumers.values()].map((consumer) => (
          consumer.onSnapshot(snapshot)
        )));
        return snapshot;
      } catch (error) {
        this.failureCount += 1;
        const state = {
          failureCount: this.failureCount,
          retryInMs: this.nextDelay(),
        };
        this.logger?.warn('Task snapshot OpenClaw gặp lỗi; giữ dữ liệu cuối đã biết.', {
          name: error?.name,
          code: error?.code,
          retryInMs: state.retryInMs,
          consumers: this.consumers.size,
        });
        await Promise.allSettled([...this.consumers.values()].map((consumer) => (
          consumer.onError(error, state)
        )));
        throw error;
      } finally {
        this.refreshPromise = null;
        this.schedule(this.nextDelay());
      }
    })();
    return this.refreshPromise;
  }

  async getTask(taskId) {
    const key = String(taskId);
    if (!this.taskRequests.has(key)) {
      const request = Promise.resolve(this.taskClient.show(key)).finally(() => {
        this.taskRequests.delete(key);
      });
      this.taskRequests.set(key, request);
    }
    return this.taskRequests.get(key);
  }

  async getSessionTasks(sessionKey) {
    const key = String(sessionKey || '').trim();
    if (!key) {
      return [];
    }
    if (!this.sessionRequests.has(key)) {
      const request = Promise.resolve(this.taskClient.listForSession(key)).finally(() => {
        this.sessionRequests.delete(key);
      });
      this.sessionRequests.set(key, request);
    }
    return this.sessionRequests.get(key);
  }

  close() {
    this.closed = true;
    this.clearTimer();
    this.consumers.clear();
  }
}

module.exports = {
  TaskSnapshotService,
};

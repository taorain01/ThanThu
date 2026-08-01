'use strict';

function statusUpdateDelay(options = {}) {
  if (options.immediate) {
    return 100;
  }
  const now = Number(options.now) || Date.now();
  const lastUpdatedAt = Number(options.lastUpdatedAt) || 0;
  const debounceMs = Number(options.debounceMs) || 1000;
  return Math.max(100, debounceMs - Math.max(0, now - lastUpdatedAt));
}

function startStatusHeartbeat(options) {
  const intervalMs = Number(options.intervalMs) || 60000;
  const setIntervalImpl = options.setIntervalImpl || setInterval;
  const clearIntervalImpl = options.clearIntervalImpl || clearInterval;
  const tick = async () => {
    const jobs = await options.listActiveJobs();
    await Promise.allSettled(jobs.map((job) => options.refreshJob(job)));
  };
  const timer = setIntervalImpl(() => {
    void tick().catch((error) => options.onError?.(error));
  }, intervalMs);
  timer.unref?.();
  return {
    tick,
    stop: () => clearIntervalImpl(timer),
  };
}

module.exports = {
  startStatusHeartbeat,
  statusUpdateDelay,
};

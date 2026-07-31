'use strict';

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
};

'use strict';

const { sanitizeInline } = require('./session-activity');

const ACTIVE_TASK_STATUSES = new Set(['queued', 'running']);
const PROBLEM_TASK_STATUSES = new Set(['failed', 'timed_out', 'cancelled', 'lost']);
const SUCCESS_TASK_STATUSES = new Set(['succeeded', 'completed']);

function numericTimestamp(value) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) {
    return number;
  }
  const parsed = Date.parse(value || '');
  return Number.isNaN(parsed) ? 0 : parsed;
}

function taskActivityAt(task) {
  return Math.max(
    numericTimestamp(task?.lastEventAt),
    numericTimestamp(task?.endedAt),
    numericTimestamp(task?.startedAt),
    numericTimestamp(task?.createdAt),
  );
}

function taskStartedAt(task) {
  return numericTimestamp(task?.startedAt) || numericTimestamp(task?.createdAt);
}

function logicalTaskKey(task, fallbackIndex) {
  return String(
    task?.runId
    || task?.childSessionKey
    || task?.taskId
    || `task-${fallbackIndex}`,
  );
}

function hasBlockedOutcome(task) {
  return task?.terminalOutcome === 'blocked'
    || /^\s*\[blocked\]/i.test(String(task?.progressSummary || ''));
}

function workerStatus(records) {
  if (records.some((task) => task.status === 'running')) {
    return 'running';
  }
  if (records.some((task) => task.status === 'queued')) {
    return 'queued';
  }
  if (records.some((task) => PROBLEM_TASK_STATUSES.has(task.status) || hasBlockedOutcome(task))) {
    return 'problem';
  }
  if (records.some((task) => SUCCESS_TASK_STATUSES.has(task.status))) {
    return 'succeeded';
  }
  return 'unknown';
}

function preferredText(records, fields) {
  return [...records]
    .sort((a, b) => taskActivityAt(b) - taskActivityAt(a))
    .flatMap((task) => fields.map((field) => task?.[field]))
    .map((value) => sanitizeInline(value))
    .find(Boolean) || '';
}

function summarizeWorkers(jobOrTasks) {
  const taskMap = jobOrTasks?.tasks || jobOrTasks || {};
  const groups = new Map();
  Object.values(taskMap).forEach((task, index) => {
    const key = logicalTaskKey(task, index);
    const records = groups.get(key) || [];
    records.push(task);
    groups.set(key, records);
  });

  const workers = [...groups.entries()]
    .map(([key, records]) => {
      const startedTimes = records.map(taskStartedAt).filter(Boolean);
      const activityTimes = records.map(taskActivityAt).filter(Boolean);
      return {
        key,
        records,
        status: workerStatus(records),
        label: preferredText(records, ['label']),
        progress: preferredText(records, ['progressSummary', 'terminalSummary', 'error']),
        startedAt: startedTimes.length ? Math.min(...startedTimes) : 0,
        lastActivityAt: activityTimes.length ? Math.max(...activityTimes) : 0,
      };
    })
    .sort((a, b) => (a.startedAt || a.lastActivityAt) - (b.startedAt || b.lastActivityAt))
    .map((worker, index) => ({
      ...worker,
      number: index + 1,
      displayLabel: worker.label || `Worker ${index + 1}`,
    }));

  const active = workers.filter((worker) => ACTIVE_TASK_STATUSES.has(worker.status));
  const succeeded = workers.filter((worker) => worker.status === 'succeeded');
  const problem = workers.filter((worker) => worker.status === 'problem');
  const current = [...(active.length ? active : workers)]
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0] || null;

  return {
    workers,
    current,
    counts: {
      total: workers.length,
      active: active.length,
      succeeded: succeeded.length,
      problem: problem.length,
    },
  };
}

module.exports = {
  ACTIVE_TASK_STATUSES,
  PROBLEM_TASK_STATUSES,
  summarizeWorkers,
};

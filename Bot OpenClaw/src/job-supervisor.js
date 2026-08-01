'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  OpenClawSessionMonitor,
  mediaFromAssistantText,
  sanitizeActivityText,
  sanitizeInline,
} = require('./session-activity');
const { sessionActivityRecord } = require('./discord-activity');
const { stageMediaReference } = require('./response-media');
const { RequestDeadline } = require('./request-deadline');
const {
  ACTIVE_TASK_STATUSES,
  PROBLEM_TASK_STATUSES,
  summarizeWorkers,
} = require('./task-summary');

const FAILED_TASK_STATUSES = PROBLEM_TASK_STATUSES;
const TERMINAL_JOB_STATUSES = new Set([
  'completed',
  'completed_with_blocker',
  'failed',
  'stopped',
]);

function delay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function taskBelongsToJob(task, job, knownSessions) {
  const createdAt = Number(task.createdAt) || 0;
  const discoveryAfter = Number(job.taskDiscoveryAfter) || Date.parse(job.createdAt);
  if (createdAt && createdAt < discoveryAfter - 5000) {
    return false;
  }
  return knownSessions.has(task.requesterSessionKey)
    || knownSessions.has(task.ownerKey)
    || knownSessions.has(task.childSessionKey);
}

function durableTaskRecord(task) {
  const record = {};
  for (const key of [
    'taskId',
    'runtime',
    'sourceId',
    'requesterSessionKey',
    'ownerKey',
    'childSessionKey',
    'runId',
    'status',
    'deliveryStatus',
    'notifyPolicy',
    'createdAt',
    'startedAt',
    'endedAt',
    'lastEventAt',
    'cleanupAfter',
    'terminalOutcome',
  ]) {
    if (task?.[key] !== undefined) {
      record[key] = task[key];
    }
  }
  for (const key of ['label', 'progressSummary', 'terminalSummary', 'error']) {
    if (task?.[key]) {
      record[key] = sanitizeInline(task[key]);
    }
  }
  return record;
}

function artifactCounts(job) {
  const artifacts = Object.values(job.artifacts || {});
  return {
    total: artifacts.length,
    delivered: artifacts.filter((artifact) => artifact.status === 'delivered').length,
    ready: artifacts.filter((artifact) => artifact.status === 'ready').length,
  };
}

class JobSupervisor {
  constructor(options) {
    this.store = options.store;
    this.taskClient = options.taskClient;
    this.openclaw = options.openclaw;
    this.sessionsDir = options.sessionsDir;
    this.openclawHome = options.openclawHome;
    this.allowedRoots = options.allowedRoots;
    this.outboxRoot = options.outboxRoot || path.join(this.openclawHome, 'media', 'discord-outbox');
    this.pollMs = options.pollMs ?? 2000;
    this.retryDelaysMs = options.retryDelaysMs ?? [5000, 30000, 120000];
    this.discoveryGraceMs = options.discoveryGraceMs ?? 5000;
    this.terminalGraceMs = options.terminalGraceMs ?? 3000;
    this.cancelGraceMs = options.cancelGraceMs ?? 120000;
    this.idleTimeoutMs = options.idleTimeoutMs;
    this.maxRuntimeMs = options.maxRuntimeMs;
    this.logger = options.logger;
    this.onJobChanged = options.onJobChanged || (() => {});
    this.sendActivity = options.sendActivity || (async () => {});
    this.sendArtifact = options.sendArtifact || (async () => {
      throw new Error('Chưa cấu hình bộ gửi artifact.');
    });
    this.contexts = new Map();
    this.deliveryPromises = new Map();
    this.deliverySequence = 0;
  }

  async createJob(input, options = {}) {
    const job = await this.store.createJob(input);
    if (options.watch !== false) {
      await this.watchJob(job.id, { rootStartAtEnd: true });
    }
    return this.store.getJob(job.id);
  }

  getJob(jobId) {
    return this.store.getJob(jobId);
  }

  listJobs(options) {
    return this.store.listJobs(options);
  }

  async watchJob(jobId, options = {}) {
    if (this.contexts.has(jobId)) {
      return this.contexts.get(jobId);
    }
    const job = this.store.getJob(jobId);
    if (!job) {
      throw new Error(`Không tìm thấy job ${jobId}.`);
    }
    let settleResolve;
    const settled = new Promise((resolve) => {
      settleResolve = resolve;
    });
    const context = {
      monitors: new Map(),
      deliveries: new Map(),
      pollTimer: null,
      syncPromise: Promise.resolve(),
      settled,
      settleResolve,
      foregroundDone: options.recovered === true,
      foregroundError: null,
      settling: false,
      discoveryDeadline: null,
      terminalDeadline: null,
      cancelDeadline: null,
      cancelRequestedTaskIds: new Set(),
      stopRequested: Boolean(
        job.stopRequested
        || (job.status === 'background' && job.terminalReason === 'Đã dừng theo yêu cầu người dùng.'),
      ),
      settlePromise: null,
      explicitBlocker: '',
      activityTouch: null,
      rootStartAtEnd: options.rootStartAtEnd === true,
    };
    this.contexts.set(jobId, context);
    await this.addSessionMonitor(jobId, job.rootSessionKey, context.rootStartAtEnd);
    await this.resumePendingDeliveries(jobId);
    context.pollTimer = setInterval(() => {
      void this.syncTasks(jobId).catch((error) => {
        this.logger?.error('Không thể giám sát durable task OpenClaw.', {
          jobId,
          name: error.name,
        });
      });
    }, this.pollMs);
    context.pollTimer.unref?.();
    return context;
  }

  async addSessionMonitor(jobId, sessionKey, startAtEnd = false) {
    const context = this.contexts.get(jobId);
    if (!context || !sessionKey || context.monitors.has(sessionKey)) {
      return;
    }
    const job = this.store.getJob(jobId);
    const savedOffset = job.sessionOffsets[sessionKey];
    const monitor = new OpenClawSessionMonitor({
      sessionsDir: this.sessionsDir,
      sessionKey,
      initialOffset: savedOffset,
      startAtEnd: savedOffset === undefined ? startAtEnd : false,
      afterTimestampMs: job.sessionStartedAt[sessionKey] || Date.parse(job.createdAt) - 1000,
      onOffset: (offset) => this.store.setSessionOffset(jobId, sessionKey, offset),
      onRecord: () => this.contexts.get(jobId)?.activityTouch?.(),
      onEvent: (event) => this.handleEvent(jobId, {
        ...event,
        origin: 'transcript',
        sessionKey,
        isRoot: sessionKey === job.rootSessionKey,
      }),
    });
    context.monitors.set(sessionKey, monitor);
    await monitor.start();
  }

  setActivityTouch(jobId, callback) {
    const context = this.contexts.get(jobId);
    if (context) {
      context.activityTouch = callback;
    }
  }

  async handleEvent(jobId, event) {
    const context = this.contexts.get(jobId);
    const job = this.store.getJob(jobId);
    const activity = {
      origin: 'system',
      ...event,
      isRoot: event.isRoot ?? (
        event.sessionKey ? event.sessionKey === job?.rootSessionKey : false
      ),
    };
    if (!activity.sourceLabel && activity.sessionKey && !activity.isRoot) {
      const sourceTask = Object.values(job?.tasks || {}).find((task) => (
        task.childSessionKey === activity.sessionKey && task.label
      ));
      activity.sourceLabel = sourceTask?.label || '';
    }
    context?.activityTouch?.();
    if (activity.text) {
      const sessionRecord = sessionActivityRecord(activity);
      if (sessionRecord) {
        await this.store.addSessionEvent(jobId, activity.sessionKey, sessionRecord);
      } else {
        await this.store.addEvent(jobId, activity.text);
      }
      try {
        await this.sendActivity(this.store.getJob(jobId), activity);
      } catch (error) {
        this.logger?.warn('Không gửi được hoạt động OpenClaw trực tiếp lên Discord.', {
          jobId,
          kind: activity.kind,
          name: error.name,
        });
        if (activity.origin === 'transcript') {
          throw error;
        }
      }
    }
    const mediaReferences = activity.mediaReferences || [];
    for (let index = 0; index < mediaReferences.length; index += 1) {
      await this.registerArtifact(
        jobId,
        mediaReferences[index],
        activity.mediaLabels?.[index] || activity.mediaLabel,
      );
    }
    await this.notifyJobChanged(jobId);
  }

  async recordWorkerTransitions(jobId, before, after) {
    const previousByKey = new Map(before.workers.map((worker) => [worker.key, worker]));
    let changed = false;
    for (const worker of after.workers) {
      const previous = previousByKey.get(worker.key);
      let text = '';
      if (!previous) {
        if (worker.status === 'problem') {
          text = `✗ Worker gặp vấn đề: ${worker.displayLabel}`;
        } else if (worker.status === 'succeeded') {
          text = `✓ Worker hoàn tất: ${worker.displayLabel}`;
        } else {
          text = `🤖 Worker bắt đầu: ${worker.displayLabel}`;
        }
      } else if (
        ACTIVE_TASK_STATUSES.has(previous.status)
        && !ACTIVE_TASK_STATUSES.has(worker.status)
      ) {
        text = worker.status === 'problem'
          ? `✗ Worker gặp vấn đề: ${worker.displayLabel}`
          : `✓ Worker hoàn tất: ${worker.displayLabel}`;
      }
      if (text) {
        await this.handleEvent(jobId, {
          kind: 'worker',
          origin: 'task',
          text,
        });
        changed = true;
      }
    }
    return changed;
  }

  async registerArtifact(jobId, reference, label = '', options = {}) {
    const staged = await stageMediaReference(reference, {
      jobId,
      openclawHome: this.openclawHome,
      outboxRoot: this.outboxRoot,
      allowedRoots: this.allowedRoots,
    });
    if (!staged.artifact) {
      this.logger?.warn('Bỏ qua MEDIA không hợp lệ hoặc ngoài allowlist.', { jobId });
      return null;
    }
    const current = this.store.getJob(jobId);
    const existing = current.artifacts[staged.artifact.id];
    const artifact = {
      ...staged.artifact,
      order: existing?.order || Object.keys(current.artifacts).length + 1,
      label: sanitizeInline(label).replace(/^💬\s*/, '') || existing?.label || '',
      status: existing?.status || 'ready',
    };
    await this.store.upsertArtifact(jobId, artifact);
    if (options.deliver !== false && existing?.status !== 'delivered') {
      void this.deliverArtifact(jobId, artifact.id);
    }
    return artifact;
  }

  async resumePendingDeliveries(jobId) {
    const job = this.store.getJob(jobId);
    for (const artifact of Object.values(job.artifacts || {})) {
      if (artifact.status === 'delivered') {
        continue;
      }
      if (artifact.status === 'sending') {
        await this.store.updateArtifact(jobId, artifact.id, { status: 'ready' });
      }
      void this.deliverArtifact(jobId, artifact.id);
    }
  }

  deliverArtifact(jobId, artifactId, options = {}) {
    const context = this.contexts.get(jobId);
    const baseKey = `${jobId}:${artifactId}`;
    const deliveryKey = options.force
      ? `${baseKey}:${Date.now()}:${this.deliverySequence += 1}`
      : baseKey;
    if (!options.force && this.deliveryPromises.has(deliveryKey)) {
      return this.deliveryPromises.get(deliveryKey);
    }

    const delivery = this.runDelivery(jobId, artifactId, options);
    this.deliveryPromises.set(deliveryKey, delivery);
    context?.deliveries.set(deliveryKey, delivery);
    delivery.then(
      () => {
        this.deliveryPromises.delete(deliveryKey);
        context?.deliveries.delete(deliveryKey);
      },
      () => {
        this.deliveryPromises.delete(deliveryKey);
        context?.deliveries.delete(deliveryKey);
      },
    );
    return delivery;
  }

  async runDelivery(jobId, artifactId, options) {
    let lastError;
    const attempts = this.retryDelaysMs.length + 1;
    for (let index = 0; index < attempts; index += 1) {
      const job = this.store.getJob(jobId);
      const artifact = job?.artifacts?.[artifactId];
      if (!artifact) {
        return null;
      }
      if (artifact.status === 'delivered' && !options.force) {
        return artifact;
      }
      await this.store.updateArtifact(jobId, artifactId, (current) => {
        current.status = 'sending';
        current.attempts = (current.attempts || 0) + 1;
        current.lastError = '';
      });
      try {
        await this.ensureArtifactStaged(jobId, artifactId);
        const messageId = await this.sendArtifact(this.store.getJob(jobId), {
          ...this.store.getJob(jobId).artifacts[artifactId],
          resend: options.force === true,
        });
        await this.store.updateArtifact(jobId, artifactId, (current) => {
          current.status = 'delivered';
          current.lastDiscordMessageId = String(messageId);
          current.discordMessageIds = [...new Set([
            ...(current.discordMessageIds || []),
            String(messageId),
          ])];
          current.deliveredAt = new Date().toISOString();
          current.lastError = '';
        });
        await this.notifyJobChanged(jobId);
        return this.store.getJob(jobId).artifacts[artifactId];
      } catch (error) {
        lastError = error;
        await this.store.updateArtifact(jobId, artifactId, (current) => {
          current.status = 'ready';
          current.lastError = error.name || 'Error';
        });
        this.logger?.warn('Không gửi được artifact lên Discord.', {
          jobId,
          attempt: index + 1,
          name: error.name,
        });
        if (index < this.retryDelaysMs.length) {
          await delay(this.retryDelaysMs[index]);
        }
      }
    }
    await this.notifyJobChanged(jobId);
    throw lastError;
  }

  async ensureArtifactStaged(jobId, artifactId) {
    const artifact = this.store.getJob(jobId)?.artifacts?.[artifactId];
    if (!artifact) {
      throw new Error('Artifact không còn tồn tại trong delivery ledger.');
    }
    try {
      const stat = await fs.stat(artifact.stagedPath);
      if (stat.isFile()) {
        return artifact;
      }
    } catch {
      // Outbox hết hạn sẽ được dựng lại từ file gốc đã hash.
    }
    const staged = await stageMediaReference(artifact.sourcePath, {
      jobId,
      openclawHome: this.openclawHome,
      outboxRoot: this.outboxRoot,
      allowedRoots: this.allowedRoots,
    });
    if (!staged.artifact || staged.artifact.id !== artifactId) {
      throw new Error('File gốc của artifact không còn hợp lệ hoặc đã thay đổi.');
    }
    await this.store.updateArtifact(jobId, artifactId, {
      stagedPath: staged.artifact.stagedPath,
      sourcePath: staged.artifact.sourcePath,
      size: staged.artifact.size,
    });
    return this.store.getJob(jobId).artifacts[artifactId];
  }

  async syncTasks(jobId, options = {}) {
    const context = this.contexts.get(jobId);
    if (!context || context.settling) {
      return;
    }
    const operation = context.syncPromise.catch((error) => {
      this.logger?.error('Lần đồng bộ durable task trước đó gặp lỗi.', {
        jobId,
        name: error.name,
      });
    }).then(async () => {
      if (context.settling || this.contexts.get(jobId) !== context) {
        return;
      }
      let tasks;
      try {
        tasks = await this.taskClient.list({
          fresh: options.fresh === true,
          maxAgeMs: this.pollMs,
        });
      } catch (error) {
        this.logger?.warn('Không đồng bộ được durable task OpenClaw.', {
          jobId,
          name: error.name,
        });
        return;
      }

      let job = this.store.getJob(jobId);
      if (!job || TERMINAL_JOB_STATUSES.has(job.status)) {
        return;
      }
      const workersBefore = summarizeWorkers(job);
      const knownSessions = new Set([
        job.rootSessionKey,
        ...Object.values(job.tasks).map((task) => task.childSessionKey).filter(Boolean),
      ]);
      const matched = new Map();
      let changed = true;
      while (changed) {
        changed = false;
        for (const task of tasks) {
          if (matched.has(task.taskId) || !taskBelongsToJob(task, job, knownSessions)) {
            continue;
          }
          matched.set(task.taskId, task);
          if (task.childSessionKey && !knownSessions.has(task.childSessionKey)) {
            knownSessions.add(task.childSessionKey);
            changed = true;
          }
        }
      }

      for (const task of matched.values()) {
        await this.store.upsertTask(jobId, durableTaskRecord(task));
        if (task.childSessionKey && task.childSessionKey !== job.rootSessionKey) {
          await this.addSessionMonitor(jobId, task.childSessionKey, false);
        }
      }
      for (const task of Object.values(job.tasks)) {
        if (!ACTIVE_TASK_STATUSES.has(task.status) || matched.has(task.taskId)) {
          continue;
        }
        try {
          const refreshed = await this.taskClient.show(task.taskId);
          await this.store.upsertTask(jobId, durableTaskRecord(refreshed?.task || refreshed));
        } catch {
          await this.store.upsertTask(jobId, durableTaskRecord({
            ...task,
            status: 'lost',
            error: 'Durable task không còn xuất hiện trong OpenClaw tasks.',
          }));
        }
      }
      job = this.store.getJob(jobId);
      if (context.settling || this.contexts.get(jobId) !== context) {
        return;
      }
      const workersAfter = summarizeWorkers(job);
      const workerChanged = await this.recordWorkerTransitions(jobId, workersBefore, workersAfter);
      job = this.store.getJob(jobId);
      const jobTasks = Object.values(job.tasks);
      const activeTasks = jobTasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status));
      if (activeTasks.length) {
        if (context.stopRequested || job.stopRequested) {
          await this.cancelActiveTasks(context, activeTasks);
        }
        const latest = this.store.getJob(jobId);
        if (
          context.settling
          || this.contexts.get(jobId) !== context
          || !latest
          || TERMINAL_JOB_STATUSES.has(latest.status)
        ) {
          return;
        }
        context.terminalDeadline = null;
        if (context.foregroundDone && latest.status !== 'background') {
          await this.store.updateJob(jobId, { status: 'background' });
          await this.notifyJobChanged(jobId);
        } else if (workerChanged) {
          await this.notifyJobChanged(jobId);
        }
        return;
      }

      if (workerChanged) {
        await this.notifyJobChanged(jobId);
      }

      if (!context.foregroundDone) {
        return;
      }
      const now = Date.now();
      if (!jobTasks.length) {
        context.discoveryDeadline ||= now + this.discoveryGraceMs;
        if (now < context.discoveryDeadline) {
          return;
        }
      } else {
        context.terminalDeadline ||= now + this.terminalGraceMs;
        if (now < context.terminalDeadline) {
          return;
        }
      }
      await this.settle(jobId);
    });
    context.syncPromise = operation;
    return operation;
  }

  async markForegroundDone(jobId, result = {}) {
    const context = this.contexts.get(jobId);
    if (!context) {
      return;
    }
    context.foregroundDone = true;
    context.foregroundError = result.error || null;
    context.discoveryDeadline = Date.now() + this.discoveryGraceMs;
    if (result.error) {
      await this.handleEvent(jobId, {
        kind: 'system',
        origin: 'foreground',
        text: `✗ Yêu cầu cha gặp lỗi: ${result.error.code || result.error.name || 'Error'}`,
      });
    }
    await this.syncTasks(jobId, { fresh: true });
  }

  async settle(jobId) {
    const context = this.contexts.get(jobId);
    if (!context) {
      return;
    }
    if (!context.settlePromise) {
      context.settling = true;
      if (context.pollTimer) {
        clearInterval(context.pollTimer);
        context.pollTimer = null;
      }
      context.settlePromise = (async () => {
        await this.stopMonitoring(context);
        const pendingDeliveries = [...context.deliveries.values()];
        if (pendingDeliveries.length) {
          await Promise.allSettled(pendingDeliveries);
        }
        const job = this.store.getJob(jobId);
        const tasks = Object.values(job.tasks);
        const counts = artifactCounts(job);
        const hasBlocked = Boolean(context.explicitBlocker) || tasks.some((task) => (
          task.terminalOutcome === 'blocked'
          || /^\s*\[blocked\]/i.test(task.progressSummary || '')
        ));
        const hasFailed = tasks.some((task) => FAILED_TASK_STATUSES.has(task.status));
        let status = 'completed';
        let terminalReason = '';
        const stopRequested = context.stopRequested
          || job.stopRequested
          || (job.status === 'background' && job.terminalReason === 'Đã dừng theo yêu cầu người dùng.');
        if (stopRequested) {
          status = 'stopped';
          terminalReason = 'Đã dừng theo yêu cầu người dùng.';
        } else if (hasBlocked || (hasFailed && counts.total > 0)) {
          status = 'completed_with_blocker';
          terminalReason = sanitizeInline(
            context.explicitBlocker
            || tasks.find((task) => task.progressSummary || task.error)?.progressSummary
            || tasks.find((task) => task.error)?.error
            || 'Có task con gặp blocker.',
          );
        } else if (hasFailed) {
          status = 'failed';
          terminalReason = 'OpenClaw không hoàn tất được yêu cầu.';
        } else if (context.foregroundError && tasks.length === 0 && counts.total === 0) {
          status = 'failed';
          terminalReason = sanitizeInline(
            context.foregroundError.message || 'Yêu cầu cha không hoàn tất.',
          );
        }
        await this.store.updateJob(jobId, {
          status,
          terminalReason,
          stopRequested,
        });
        const terminalEvents = {
          completed: '✅ Job đã hoàn tất toàn bộ công việc.',
          completed_with_blocker: `⚠️ Job hoàn tất nhưng còn blocker: ${terminalReason}`,
          failed: `❌ Job không hoàn tất: ${terminalReason}`,
          stopped: '⏹ Job đã dừng theo yêu cầu.',
        };
        await this.handleEvent(jobId, {
          kind: 'system',
          origin: 'terminal',
          text: terminalEvents[status],
        });
        this.contexts.delete(jobId);
        await this.notifyJobChanged(jobId);
        context.settleResolve(this.store.getJob(jobId));
      })();
    }
    return context.settlePromise;
  }

  async stopMonitoring(context) {
    if (context.pollTimer) {
      clearInterval(context.pollTimer);
      context.pollTimer = null;
    }
    for (const monitor of context.monitors.values()) {
      await monitor.stop();
    }
  }

  async closeContext(jobId) {
    const context = this.contexts.get(jobId);
    if (!context) {
      return;
    }
    context.settling = true;
    await this.stopMonitoring(context);
    this.contexts.delete(jobId);
  }

  async cancelJob(jobId) {
    const job = this.store.getJob(jobId);
    if (!job || TERMINAL_JOB_STATUSES.has(job.status)) {
      return job;
    }
    await this.store.updateJob(jobId, { stopRequested: true });
    const context = await this.watchJob(jobId, { recovered: true });
    context.stopRequested = true;
    context.cancelDeadline = Date.now() + this.cancelGraceMs;
    await this.syncTasks(jobId, { fresh: true });
    const activeTasks = Object.values(this.store.getJob(jobId).tasks)
      .filter((task) => ACTIVE_TASK_STATUSES.has(task.status));
    await this.cancelActiveTasks(context, activeTasks);
    const timer = setTimeout(() => void this.settle(jobId), this.cancelGraceMs);
    timer.unref?.();
    await this.handleEvent(jobId, {
      kind: 'system',
      origin: 'command',
      text: '⏹ Đã yêu cầu OpenClaw hủy toàn bộ durable task của job.',
    });
    return this.store.getJob(jobId);
  }

  async cancelActiveTasks(context, tasks) {
    const taskIds = tasks
      .map((task) => task.taskId)
      .filter((taskId) => taskId && !context.cancelRequestedTaskIds.has(taskId));
    for (const taskId of taskIds) {
      context.cancelRequestedTaskIds.add(taskId);
    }
    await Promise.allSettled(taskIds.map((taskId) => this.taskClient.cancel(taskId)));
  }

  async recoverJob(jobId, signal, options = {}) {
    let job = this.store.getJob(jobId);
    if (!job || (TERMINAL_JOB_STATUSES.has(job.status) && !options.force)) {
      return job;
    }
    if (options.force && TERMINAL_JOB_STATUSES.has(job.status)) {
      await this.store.updateJob(jobId, {
        status: 'recovering',
        terminalReason: '',
      });
      job = this.store.getJob(jobId);
    }
    const context = await this.watchJob(jobId, { recovered: true });
    await this.syncTasks(jobId, { fresh: true });
    let current = this.store.getJob(jobId);
    if (!current || TERMINAL_JOB_STATUSES.has(current.status) || context.settling) {
      return context.settled;
    }
    if (Object.values(current.tasks).some((task) => ACTIVE_TASK_STATUSES.has(task.status))) {
      if (current.status !== 'background') {
        await this.store.updateJob(jobId, { status: 'background' });
        await this.notifyJobChanged(jobId);
      }
      return context.settled;
    }
    const currentTasks = Object.values(current.tasks);
    const hasLostTask = currentTasks.some((task) => task.status === 'lost');
    if (current.responseSent && currentTasks.length === 0 && !options.force) {
      await Promise.all([...context.monitors.values()].map((monitor) => monitor.poll()));
      await this.settle(jobId);
      return context.settled;
    }
    if (currentTasks.length && !hasLostTask && !options.force) {
      await Promise.all([...context.monitors.values()].map((monitor) => monitor.poll()));
      await this.settle(jobId);
      return context.settled;
    }
    if (current.recoveryCount >= 1 && !options.force) {
      await this.store.updateJob(jobId, {
        status: 'completed_with_blocker',
        terminalReason: 'Không còn durable task đang chạy và job đã dùng hết một lần tự khôi phục.',
      });
      await this.closeContext(jobId);
      context.settleResolve(this.store.getJob(jobId));
      await this.notifyJobChanged(jobId);
      return this.store.getJob(jobId);
    }

    const recoveryStartedAt = Date.now();
    await this.store.updateJob(jobId, (mutable) => {
      mutable.status = 'recovering';
      mutable.recoveryCount += 1;
      mutable.taskDiscoveryAfter = recoveryStartedAt;
      mutable.tasks = {};
    });
    await this.notifyJobChanged(jobId);
    const deadline = new RequestDeadline({
      signal,
      idleTimeoutMs: this.idleTimeoutMs,
      maxRuntimeMs: this.maxRuntimeMs,
    });
    this.setActivityTouch(jobId, () => deadline.touch());
    try {
      const responseText = await this.openclaw.chat({
        guildId: current.guildId,
        channelId: current.channelId,
        sessionGeneration: current.sessionGeneration,
        backendModel: current.backendModel || undefined,
        text: [
          `Khôi phục an toàn job Discord ${jobId} sau khi bot hoặc máy bị gián đoạn.`,
          'Đọc durable task và checkpoint liên quan trong workspace. Xác minh đúng ứng dụng, đúng conversation và trạng thái UI trước mọi click.',
          'Không tạo lại hoặc gửi lại artifact đã hoàn tất. Nếu không xác minh chắc chắn được bước tiếp theo, trả [blocked] và không thao tác mù quáng.',
          'Với mỗi file ảnh thành phẩm mới đã kiểm tra, ghi một dòng MEDIA:<đường dẫn tuyệt đối>. Không đánh dấu MEDIA cho screenshot nội bộ.',
        ].join('\n'),
        imageParts: [],
        signal: deadline.signal,
      });
      const references = mediaFromAssistantText(responseText);
      const visibleText = String(responseText || '')
        .split(/\r?\n/)
        .filter((line) => !/^\s*MEDIA:/i.test(line))
        .join(' ');
      for (const reference of references) {
        await this.registerArtifact(jobId, reference, visibleText);
      }
      const safeResponse = sanitizeInline(visibleText);
      if (safeResponse) {
        await this.handleEvent(jobId, {
          kind: 'assistant',
          origin: 'recovery',
          isRoot: true,
          final: true,
          text: `💬 ${safeResponse}`,
          notificationText: sanitizeActivityText(visibleText),
        });
      }
      if (/\[blocked\]/i.test(responseText)) {
        context.explicitBlocker = safeResponse || 'OpenClaw không xác minh chắc chắn được checkpoint hoặc UI.';
      }
      await this.markForegroundDone(jobId);
    } catch (error) {
      await this.markForegroundDone(jobId, { error });
    } finally {
      deadline.stop();
      this.setActivityTouch(jobId, null);
    }
    return context.settled;
  }

  async resend(jobId, selector = 'all', force = false) {
    const job = this.store.getJob(jobId);
    if (!job) {
      return [];
    }
    const artifacts = Object.values(job.artifacts)
      .sort((a, b) => a.order - b.order)
      .filter((artifact) => selector === 'all' || artifact.order === Number(selector))
      .filter((artifact) => force || artifact.status !== 'delivered');
    const results = [];
    for (const artifact of artifacts) {
      results.push(await this.deliverArtifact(jobId, artifact.id, { force }));
    }
    return results;
  }

  waitForSettled(jobId) {
    return this.contexts.get(jobId)?.settled || Promise.resolve(this.store.getJob(jobId));
  }

  async notifyJobChanged(jobId) {
    await this.onJobChanged(this.store.getJob(jobId));
  }
}

module.exports = {
  ACTIVE_TASK_STATUSES,
  JobSupervisor,
  TERMINAL_JOB_STATUSES,
  artifactCounts,
  durableTaskRecord,
  taskBelongsToJob,
};

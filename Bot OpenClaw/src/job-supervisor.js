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
const { TaskSnapshotService } = require('./task-snapshot-service');
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

function taskRecordChanged(current, next) {
  if (!current) {
    return true;
  }
  return Object.entries(next).some(([key, value]) => current[key] !== value);
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
    // Khi agent đã kết thúc lượt trả lời (transcript final) nhưng durable task
    // vẫn còn chạy nền, session OpenClaw thường TỰ TIẾP TỤC công việc sau khi
    // task xong (tạo task mới hoặc giao MEDIA muộn hơn nhiều so với lúc task
    // kết thúc — quan sát thấy tới ~50s). Sau task cuối, đợi thêm khoảng này
    // trước khi settle để không đóng job khi agent còn continuation.
    this.taskContinuationGraceMs = options.taskContinuationGraceMs ?? 90000;
    this.cancelGraceMs = options.cancelGraceMs ?? 120000;
    this.cancelConfirmationGraceMs = options.cancelConfirmationGraceMs ?? 10000;
    this.cancelRetryMs = options.cancelRetryMs ?? 5000;
    this.idleTimeoutMs = options.idleTimeoutMs;
    this.maxRuntimeMs = options.maxRuntimeMs;
    this.logger = options.logger;
    this.onJobChanged = options.onJobChanged || (() => {});
    this.sendActivity = options.sendActivity || (async () => {});
    this.onScreenshot = options.onScreenshot || (async () => {});
    this.sendArtifact = options.sendArtifact || (async () => {
      throw new Error('Chưa cấu hình bộ gửi artifact.');
    });
    this.taskSnapshotService = options.taskSnapshotService || new TaskSnapshotService({
      taskClient: this.taskClient,
      normalPollMs: this.pollMs,
      stoppingPollMs: Math.min(this.pollMs, options.stoppingPollMs ?? 1000),
      logger: this.logger,
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
      syncPromise: Promise.resolve(),
      settled,
      settleResolve,
      foregroundDone: options.recovered === true,
      foregroundError: null,
      settling: false,
      discoveryDeadline: null,
      terminalDeadline: null,
      terminalWaitDeadline: null,
      // Agent kết thúc lượt trả lời (transcript final / foreground xong) TRONG
      // khi durable task vẫn còn chạy nền → session OpenClaw có thể tự tiếp tục
      // sau khi task xong; cần chờ taskContinuationGraceMs trước khi settle.
      rootFinalWhileTasksActive: false,
      cancelDeadline: null,
      cancelConfirmationDeadline: null,
      cancelWarningTimer: null,
      cancelConfirmed: false,
      lastRootActivityAt: undefined,
      rootFinalReceived: false,
      cancelRequestedTaskIds: new Map(),
      removeTaskSubscription: null,
      lastTaskSyncPersistedAt: 0,
      lastTaskSyncErrorAt: 0,
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
    context.removeTaskSubscription = this.taskSnapshotService.subscribe(jobId, {
      stopping: context.stopRequested,
      onSnapshot: (snapshot) => this.applyTaskSnapshot(jobId, snapshot),
      onError: (error, state) => this.handleTaskSyncError(jobId, error, state),
    });
    if (context.stopRequested) {
      await this.ensureStoppingState(jobId, context);
    }
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
      onRecord: () => {
        const currentContext = this.contexts.get(jobId);
        if (currentContext && sessionKey === job.rootSessionKey) {
          currentContext.lastRootActivityAt = Date.now();
        }
        currentContext?.activityTouch?.();
      },
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
    if (
      activity.isRoot
      && activity.origin === 'transcript'
      && activity.kind === 'assistant'
      && activity.final === true
    ) {
      context.rootFinalReceived = true;
    }
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
    // Xem trước ảnh chụp màn hình: exec screen.snapshot "nạp đạn" cho job; tool
    // image kế tiếp mang đường dẫn ảnh thật → gửi 1 ảnh mới nhất lên Discord
    // (message cũ bị thay thế, không spam).
    if (activity.screenSnapshot) {
      context.screenshotArmed = true;
    }
    if (activity.imageFile && context?.screenshotArmed) {
      context.screenshotArmed = false;
      try {
        await this.onScreenshot(this.store.getJob(jobId), activity.imageFile);
      } catch (error) {
        this.logger?.warn('Không gửi được ảnh chụp màn hình xem trước.', {
          jobId,
          name: error.name,
          message: error.message,
        });
      }
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
    if (Array.isArray(options.tasks)) {
      return this.applyTaskSnapshot(jobId, {
        tasks: options.tasks,
        source: options.source || 'test',
        latencyMs: Number(options.latencyMs) || 0,
        at: new Date().toISOString(),
      });
    }
    try {
      await this.taskSnapshotService.refresh({
        fresh: options.fresh !== false,
        reason: options.reason || 'job-sync',
      });
    } catch {
      // TaskSnapshotService đã ghi trạng thái degraded cho mọi job đang theo dõi.
    }
  }

  async handleTaskSyncError(jobId, error, state = {}) {
    const context = this.contexts.get(jobId);
    const job = this.store.getJob(jobId);
    if (!context || context.settling || !job || TERMINAL_JOB_STATUSES.has(job.status)) {
      return;
    }
    const now = Date.now();
    const shouldPersist = job.taskSyncState !== 'degraded'
      || now - context.lastTaskSyncErrorAt >= 30000;
    if (!shouldPersist) {
      return;
    }
    context.lastTaskSyncErrorAt = now;
    await this.store.updateJob(jobId, {
      taskSyncState: 'degraded',
    });
    await this.notifyJobChanged(jobId);
  }

  async persistTaskSyncSuccess(jobId, context, snapshot) {
    const job = this.store.getJob(jobId);
    if (!job) {
      return false;
    }
    const now = Date.now();
    const stateChanged = job.taskSyncState !== 'healthy'
      || job.taskSyncSource !== snapshot.source;
    if (!stateChanged && now - context.lastTaskSyncPersistedAt < 15000) {
      return false;
    }
    context.lastTaskSyncPersistedAt = now;
    await this.store.updateJob(jobId, {
      taskSyncState: 'healthy',
      taskSyncSource: snapshot.source,
      lastTaskSyncAt: snapshot.at || new Date(now).toISOString(),
    });
    return stateChanged;
  }

  async applyTaskSnapshot(jobId, snapshot) {
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
      let job = this.store.getJob(jobId);
      if (!job || TERMINAL_JOB_STATUSES.has(job.status)) {
        return;
      }
      let jobChanged = await this.persistTaskSyncSuccess(jobId, context, snapshot);
      job = this.store.getJob(jobId);
      const workersBefore = summarizeWorkers(job);
      const knownTaskIds = new Set(Object.keys(job.tasks));
      let snapshotIncomplete = false;
      let taskCandidates = [...(snapshot.tasks || [])];
      if (context.stopRequested || job.stopRequested || job.status === 'stopping') {
        try {
          const sessionTasks = await this.taskSnapshotService.getSessionTasks(job.rootSessionKey);
          const byId = new Map(taskCandidates.map((task) => [task.taskId, task]));
          for (const task of sessionTasks) {
            byId.set(task.taskId, task);
          }
          taskCandidates = [...byId.values()];
        } catch (error) {
          snapshotIncomplete = true;
          await this.handleTaskSyncError(jobId, error, {
            retryInMs: this.taskSnapshotService.nextDelay(),
          });
        }
      }
      const knownSessions = new Set([
        job.rootSessionKey,
        ...Object.values(job.tasks).map((task) => task.childSessionKey).filter(Boolean),
      ]);
      const matched = new Map();
      let changed = true;
      while (changed) {
        changed = false;
        for (const task of taskCandidates) {
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

      if ([...matched.keys()].some((taskId) => !knownTaskIds.has(taskId))) {
        context.cancelConfirmationDeadline = null;
      }

      for (const task of matched.values()) {
        const record = durableTaskRecord(task);
        if (taskRecordChanged(job.tasks[task.taskId], record)) {
          await this.store.upsertTask(jobId, record);
          jobChanged = true;
        }
        if (task.childSessionKey && task.childSessionKey !== job.rootSessionKey) {
          await this.addSessionMonitor(jobId, task.childSessionKey, false);
        }
      }

      job = this.store.getJob(jobId);
      for (const task of Object.values(job.tasks)) {
        if (!ACTIVE_TASK_STATUSES.has(task.status) || matched.has(task.taskId)) {
          continue;
        }
        try {
          const refreshed = await this.taskSnapshotService.getTask(task.taskId);
          const record = durableTaskRecord(refreshed?.task || refreshed);
          if (taskRecordChanged(task, record)) {
            await this.store.upsertTask(jobId, record);
            jobChanged = true;
          }
        } catch (error) {
          snapshotIncomplete = true;
          await this.handleTaskSyncError(jobId, error, {
            retryInMs: this.taskSnapshotService.nextDelay(),
          });
        }
      }
      job = this.store.getJob(jobId);
      if (context.settling || this.contexts.get(jobId) !== context) {
        return;
      }
      const workersAfter = summarizeWorkers(job);
      const workerChanged = await this.recordWorkerTransitions(jobId, workersBefore, workersAfter);
      jobChanged ||= workerChanged;
      job = this.store.getJob(jobId);
      const jobTasks = Object.values(job.tasks);
      const activeTasks = jobTasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status));
      const stopping = context.stopRequested || job.stopRequested || job.status === 'stopping';
      if (activeTasks.length) {
        context.cancelConfirmationDeadline = null;
        if (stopping) {
          await this.ensureStoppingState(jobId, context);
          await this.cancelActiveTasks(jobId, context, activeTasks);
        } else {
          const latest = this.store.getJob(jobId);
          context.terminalDeadline = null;
          if (context.foregroundDone && latest.status !== 'background') {
            await this.store.updateJob(jobId, { status: 'background' });
            jobChanged = true;
          }
        }
        if (jobChanged) {
          await this.notifyJobChanged(jobId);
        }
        return;
      }

      if (stopping) {
        await this.ensureStoppingState(jobId, context);
        if (snapshotIncomplete || !context.foregroundDone) {
          if (jobChanged) {
            await this.notifyJobChanged(jobId);
          }
          return;
        }
        const now = Date.now();
        context.cancelConfirmationDeadline ||= now + this.cancelConfirmationGraceMs;
        if (now < context.cancelConfirmationDeadline) {
          if (jobChanged) {
            await this.notifyJobChanged(jobId);
          }
          return;
        }
        context.cancelConfirmed = true;
        await this.store.updateJob(jobId, {
          cancelConfirmedAt: new Date(now).toISOString(),
        });
        await this.settle(jobId);
        return;
      }

      if (jobChanged) {
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
        // Agent đã trả lời xong (final) trong khi worker nền còn chạy → session
        // có thể tự tiếp tục tạo task/giao MEDIA sau đó (quan sát thấy tới ~50s
        // sau task cuối). Đợi lâu hơn để không đóng job khi agent còn continuation.
        const continuationGrace = context.rootFinalWhileTasksActive
          ? this.taskContinuationGraceMs
          : this.terminalGraceMs;
        context.terminalDeadline ||= now + continuationGrace;
        if (now < context.terminalDeadline) {
          return;
        }
      }
      // Hoãn settle khi session gốc vẫn còn hoạt động mà chưa ra phản hồi cuối:
      // durable task có thể báo failed (vd image_generate "request timed out")
      // trong khi agent vẫn tiếp tục và phục hồi được. Chỉ settle khi session
      // gốc im lặng đủ lâu (idleTimeoutMs) hoặc đã có phản hồi cuối.
      if (!context.rootFinalReceived && !context.foregroundError) {
        const lastActivityAt = context.lastRootActivityAt;
        const rootAlive = lastActivityAt !== undefined
          && (now - lastActivityAt) < this.idleTimeoutMs;
        if (rootAlive) {
          context.terminalWaitDeadline ||= now + (this.maxRuntimeMs || this.idleTimeoutMs);
          if (now < context.terminalWaitDeadline) {
            return;
          }
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
    const stillHasActiveTask = Object.values(this.store.getJob(jobId)?.tasks || {})
      .some((task) => ACTIVE_TASK_STATUSES.has(task.status));
    if (stillHasActiveTask) {
      context.rootFinalWhileTasksActive = true;
    }
    if (result.error) {
      await this.handleEvent(jobId, {
        kind: 'system',
        origin: 'foreground',
        text: `✗ Yêu cầu cha gặp lỗi: ${result.error.code || result.error.name || 'Error'}`,
      });
    }
    await this.syncTasks(jobId, { fresh: true });
  }

  async ensureStoppingState(jobId, context) {
    const job = this.store.getJob(jobId);
    if (!job || TERMINAL_JOB_STATUSES.has(job.status)) {
      return false;
    }
    const requestedAt = job.cancelRequestedAt || new Date().toISOString();
    const requestedAtMs = Date.parse(requestedAt) || Date.now();
    context.stopRequested = true;
    context.cancelDeadline = requestedAtMs + this.cancelGraceMs;
    this.taskSnapshotService.setStopping(jobId, true);
    const changed = job.status !== 'stopping'
      || !job.stopRequested
      || !job.cancelRequestedAt;
    if (changed) {
      await this.store.updateJob(jobId, {
        status: 'stopping',
        stopRequested: true,
        cancelRequestedAt: requestedAt,
        cancelConfirmedAt: null,
      });
    }
    this.scheduleCancelWarning(jobId, context);
    return changed;
  }

  scheduleCancelWarning(jobId, context) {
    if (context.cancelWarningTimer || context.cancelConfirmed) {
      return;
    }
    const job = this.store.getJob(jobId);
    if (!job || job.cancelWarningAt) {
      return;
    }
    const waitMs = Math.max(0, Number(context.cancelDeadline) - Date.now());
    context.cancelWarningTimer = setTimeout(() => {
      context.cancelWarningTimer = null;
      void (async () => {
        const current = this.store.getJob(jobId);
        if (
          !current
          || current.status !== 'stopping'
          || context.cancelConfirmed
          || this.contexts.get(jobId) !== context
        ) {
          return;
        }
        await this.store.updateJob(jobId, {
          cancelWarningAt: new Date().toISOString(),
        });
        await this.handleEvent(jobId, {
          kind: 'system',
          origin: 'cancel-timeout',
          text: '⚠️ Hủy chưa được OpenClaw xác nhận; bot vẫn tiếp tục theo dõi worker.',
        });
      })().catch((error) => {
        this.logger?.warn('Không cập nhật được cảnh báo hủy chưa xác nhận.', {
          jobId,
          name: error.name,
        });
      });
    }, waitMs);
    context.cancelWarningTimer.unref?.();
  }

  async settle(jobId) {
    const context = this.contexts.get(jobId);
    if (!context) {
      return;
    }
    const currentJob = this.store.getJob(jobId);
    const stopRequested = context.stopRequested
      || currentJob?.stopRequested
      || currentJob?.status === 'stopping';
    if (stopRequested && !context.cancelConfirmed) {
      return currentJob;
    }
    if (!context.settlePromise) {
      context.settling = true;
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
        // Session gốc đã ra phản hồi cuối = agent tự quyết định kết quả; task con
        // báo failed (vd timeout phía gateway) không còn là cơ sở đánh fail job.
        const rootFinished = context.rootFinalReceived === true;
        let status = 'completed';
        let terminalReason = '';
        const shouldStop = context.stopRequested
          || job.stopRequested
          || job.status === 'stopping';
        if (shouldStop) {
          status = 'stopped';
          terminalReason = 'Đã dừng theo yêu cầu người dùng.';
        } else if (hasBlocked || (hasFailed && !rootFinished && counts.total > 0)) {
          status = 'completed_with_blocker';
          terminalReason = sanitizeInline(
            context.explicitBlocker
            || tasks.find((task) => task.progressSummary || task.error)?.progressSummary
            || tasks.find((task) => task.error)?.error
            || 'Có task con gặp blocker.',
          );
        } else if (hasFailed && !rootFinished) {
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
          stopRequested: shouldStop,
          ...(shouldStop && !job.cancelConfirmedAt
            ? { cancelConfirmedAt: new Date().toISOString() }
            : {}),
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
        if (shouldStop && job.cancelRequestedAt) {
          this.logger?.info('OpenClaw đã xác nhận dừng job.', {
            jobId,
            cancelConfirmMs: Math.max(0, Date.now() - Date.parse(job.cancelRequestedAt)),
          });
        }
        context.settleResolve(this.store.getJob(jobId));
      })();
    }
    return context.settlePromise;
  }

  async stopMonitoring(context) {
    if (context.cancelWarningTimer) {
      clearTimeout(context.cancelWarningTimer);
      context.cancelWarningTimer = null;
    }
    context.removeTaskSubscription?.();
    context.removeTaskSubscription = null;
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
    const firstRequest = !job.stopRequested && job.status !== 'stopping';
    const context = await this.watchJob(jobId, { recovered: true });
    await this.ensureStoppingState(jobId, context);
    await this.syncTasks(jobId, { fresh: true, reason: 'cancel' });
    const activeTasks = Object.values(this.store.getJob(jobId).tasks)
      .filter((task) => ACTIVE_TASK_STATUSES.has(task.status));
    await this.cancelActiveTasks(jobId, context, activeTasks);
    if (firstRequest) {
      await this.handleEvent(jobId, {
        kind: 'system',
        origin: 'command',
        text: '⏹ Đã gửi yêu cầu hủy; bot đang chờ OpenClaw xác nhận toàn bộ worker đã dừng.',
      });
    } else {
      await this.notifyJobChanged(jobId);
    }
    return this.store.getJob(jobId);
  }

  async cancelActiveTasks(jobId, context, tasks) {
    const now = Date.now();
    const candidates = tasks.filter((task) => {
      const lastRequestedAt = context.cancelRequestedTaskIds.get(task.taskId) || 0;
      return task.taskId && now - lastRequestedAt >= this.cancelRetryMs;
    });
    await Promise.allSettled(candidates.map(async (task) => {
      context.cancelRequestedTaskIds.set(task.taskId, now);
      try {
        const result = await this.taskClient.cancel(task.taskId);
        if (result?.task) {
          await this.store.upsertTask(jobId, durableTaskRecord(result.task));
        }
        return result;
      } catch (error) {
        context.cancelRequestedTaskIds.delete(task.taskId);
        throw error;
      }
    }));
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
        stopRequested: false,
        cancelRequestedAt: null,
        cancelConfirmedAt: null,
        cancelWarningAt: null,
      });
      job = this.store.getJob(jobId);
    }
    const context = await this.watchJob(jobId, { recovered: true });
    await this.syncTasks(jobId, { fresh: true });
    let current = this.store.getJob(jobId);
    if (!current || TERMINAL_JOB_STATUSES.has(current.status) || context.settling) {
      return context.settled;
    }
    if (current.stopRequested || current.status === 'stopping' || context.stopRequested) {
      await this.ensureStoppingState(jobId, context);
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

  async close() {
    await Promise.allSettled([...this.contexts.keys()].map((jobId) => this.closeContext(jobId)));
    this.taskSnapshotService.close();
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

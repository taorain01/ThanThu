'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const JOB_STATUSES = new Set([
  'queued',
  'running',
  'background',
  'recovering',
  'completed',
  'completed_with_blocker',
  'failed',
  'stopped',
]);
const ACTIVE_JOB_STATUSES = new Set(['queued', 'running', 'background', 'recovering']);

class JobStoreError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'JobStoreError';
  }
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createEmptyState() {
  return { version: 1, jobs: {} };
}

function validateState(state) {
  if (!state || state.version !== 1 || !state.jobs || typeof state.jobs !== 'object' || Array.isArray(state.jobs)) {
    throw new JobStoreError('data/jobs.json không đúng định dạng phiên bản 1.');
  }
  for (const [jobId, job] of Object.entries(state.jobs)) {
    if (job && job.stopRequested === undefined) {
      job.stopRequested = false;
    }
    if (job && job.responseSentAt === undefined) {
      job.responseSentAt = null;
    }
    if (job && job.startedAt === undefined) {
      job.startedAt = null;
    }
    if (job && job.firstDeltaAt === undefined) {
      job.firstDeltaAt = null;
    }
    if (job && job.requestSubmittedAt === undefined) {
      job.requestSubmittedAt = null;
    }
    if (job && job.sessionActivities === undefined) {
      job.sessionActivities = {};
    }
    if (
      !job
      || job.id !== jobId
      || typeof job.channelId !== 'string'
      || typeof job.rootSessionKey !== 'string'
      || !JOB_STATUSES.has(job.status)
      || !job.sessionOffsets
      || typeof job.sessionOffsets !== 'object'
      || !job.sessionActivities
      || typeof job.sessionActivities !== 'object'
      || Array.isArray(job.sessionActivities)
      || !job.tasks
      || typeof job.tasks !== 'object'
      || !job.artifacts
      || typeof job.artifacts !== 'object'
      || typeof job.stopRequested !== 'boolean'
    ) {
      throw new JobStoreError(`Job ${jobId} trong data/jobs.json không hợp lệ.`);
    }
  }
  return state;
}

class JobStore {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.now = options.now || (() => new Date());
    this.state = createEmptyState();
    this.writeChain = Promise.resolve();
  }

  async load() {
    try {
      this.state = validateState(JSON.parse(await fs.readFile(this.filePath, 'utf8')));
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.state = createEmptyState();
        return clone(this.state);
      }
      if (error instanceof JobStoreError) {
        throw error;
      }
      throw new JobStoreError('Không thể đọc data/jobs.json; file được giữ nguyên để kiểm tra.', error);
    }
    return clone(this.state);
  }

  getJob(jobId) {
    return clone(this.state.jobs[jobId] || null);
  }

  listJobs(options = {}) {
    const jobs = Object.values(this.state.jobs)
      .filter((job) => !options.channelId || job.channelId === options.channelId)
      .filter((job) => !options.activeOnly || ACTIVE_JOB_STATUSES.has(job.status))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return clone(jobs.slice(0, options.limit || jobs.length));
  }

  latestJob(channelId) {
    return this.listJobs({ channelId, limit: 1 })[0] || null;
  }

  async createJob(input) {
    return this.mutate(() => {
      const timestamp = this.now().toISOString();
      const job = {
        id: String(input.id),
        guildId: String(input.guildId),
        channelId: String(input.channelId),
        userId: String(input.userId),
        requestMessageId: String(input.requestMessageId || input.id),
        statusMessageId: input.statusMessageId || null,
        sessionGeneration: input.sessionGeneration,
        backendModel: input.backendModel || null,
        rootSessionKey: String(input.rootSessionKey),
        taskDiscoveryAfter: Date.parse(timestamp),
        status: 'queued',
        createdAt: timestamp,
        startedAt: null,
        firstDeltaAt: null,
        updatedAt: timestamp,
        lastActivityAt: timestamp,
        lastEvent: '',
        events: [],
        recoveryCount: 0,
        stopRequested: false,
        responseSent: false,
        responseSentAt: null,
        requestFingerprint: null,
        requestSubmittedAt: null,
        sessionOffsets: {},
        sessionStartedAt: { [String(input.rootSessionKey)]: Date.parse(timestamp) },
        sessionActivities: {},
        tasks: {},
        artifacts: {},
        terminalReason: '',
      };
      this.state.jobs[job.id] = job;
      return job;
    });
  }

  async updateJob(jobId, updater) {
    return this.mutate(() => {
      const job = this.state.jobs[jobId];
      if (!job) {
        throw new JobStoreError(`Không tìm thấy job ${jobId}.`);
      }
      if (typeof updater === 'function') {
        updater(job);
      } else {
        Object.assign(job, updater);
      }
      job.updatedAt = this.now().toISOString();
      return job;
    });
  }

  async addEvent(jobId, text) {
    const cleanText = String(text || '').trim();
    if (!cleanText) {
      return this.getJob(jobId);
    }
    return this.updateJob(jobId, (job) => {
      job.lastEvent = cleanText;
      job.lastActivityAt = this.now().toISOString();
      job.events.push(cleanText);
      if (job.events.length > 50) {
        job.events.splice(0, job.events.length - 50);
      }
    });
  }

  async addSessionEvent(jobId, sessionKey, event) {
    const key = String(sessionKey || '').trim();
    const cleanText = String(event?.text || '').trim();
    if (!key || !cleanText) {
      return this.getJob(jobId);
    }
    return this.updateJob(jobId, (job) => {
      const timestamp = this.now().toISOString();
      const activity = job.sessionActivities[key] || {
        label: '',
        messageId: null,
        events: [],
        updatedAt: timestamp,
      };
      if (event.label) {
        activity.label = String(event.label);
      }
      activity.events.push({
        kind: String(event.kind || 'activity'),
        text: cleanText,
        final: event.final === true,
        createdAt: event.createdAt || timestamp,
      });
      if (activity.events.length > 50) {
        activity.events.splice(0, activity.events.length - 50);
      }
      activity.updatedAt = timestamp;
      job.sessionActivities[key] = activity;
      job.lastEvent = cleanText;
      job.lastActivityAt = timestamp;
    });
  }

  async setSessionActivityMessageId(jobId, sessionKey, messageId) {
    const key = String(sessionKey || '').trim();
    if (!key) {
      return this.getJob(jobId);
    }
    return this.updateJob(jobId, (job) => {
      const timestamp = this.now().toISOString();
      const activity = job.sessionActivities[key] || {
        label: '',
        events: [],
        updatedAt: timestamp,
      };
      activity.messageId = messageId ? String(messageId) : null;
      job.sessionActivities[key] = activity;
    });
  }

  async setSessionOffset(jobId, sessionKey, offset, startedAt = null) {
    return this.updateJob(jobId, (job) => {
      job.sessionOffsets[sessionKey] = offset;
      if (startedAt !== null && job.sessionStartedAt[sessionKey] === undefined) {
        job.sessionStartedAt[sessionKey] = startedAt;
      }
    });
  }

  async upsertTask(jobId, task) {
    return this.updateJob(jobId, (job) => {
      job.tasks[task.taskId] = {
        ...(job.tasks[task.taskId] || {}),
        ...clone(task),
      };
      if (task.childSessionKey && job.sessionStartedAt[task.childSessionKey] === undefined) {
        job.sessionStartedAt[task.childSessionKey] = task.createdAt || Date.parse(job.createdAt);
      }
      job.lastActivityAt = this.now().toISOString();
    });
  }

  async upsertArtifact(jobId, artifact) {
    return this.updateJob(jobId, (job) => {
      const previous = job.artifacts[artifact.id] || {};
      job.artifacts[artifact.id] = {
        status: 'ready',
        attempts: 0,
        discordMessageIds: [],
        createdAt: this.now().toISOString(),
        ...previous,
        ...clone(artifact),
        updatedAt: this.now().toISOString(),
      };
      job.lastActivityAt = this.now().toISOString();
    });
  }

  async updateArtifact(jobId, artifactId, updater) {
    return this.updateJob(jobId, (job) => {
      const artifact = job.artifacts[artifactId];
      if (!artifact) {
        throw new JobStoreError(`Không tìm thấy artifact ${artifactId} trong job ${jobId}.`);
      }
      if (typeof updater === 'function') {
        updater(artifact);
      } else {
        Object.assign(artifact, updater);
      }
      artifact.updatedAt = this.now().toISOString();
    });
  }

  async mutate(mutator) {
    let result;
    const operation = this.writeChain.catch(() => {}).then(async () => {
      const previousState = clone(this.state);
      try {
        result = mutator();
        await this.saveNow();
      } catch (error) {
        this.state = previousState;
        throw error;
      }
    });
    this.writeChain = operation;
    await operation;
    return clone(result);
  }

  async saveNow() {
    const directory = path.dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(directory, { recursive: true });
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
      await fs.rename(temporaryPath, this.filePath);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => {});
      throw new JobStoreError('Không thể lưu data/jobs.json.', error);
    }
  }
}

module.exports = {
  ACTIVE_JOB_STATUSES,
  JOB_STATUSES,
  JobStore,
  JobStoreError,
};

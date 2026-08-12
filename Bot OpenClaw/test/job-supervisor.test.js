'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { JobStore } = require('../src/job-store');
const { JobSupervisor, TERMINAL_JOB_STATUSES } = require('../src/job-supervisor');
const { stageMediaReference } = require('../src/response-media');

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function transcriptMessage(message) {
  return `${JSON.stringify({ type: 'message', message })}\n`;
}

function jobInput(id, rootSessionKey) {
  return {
    id,
    guildId: '1239836342456942643',
    channelId: '1532669253722046484',
    userId: '395151484179841024',
    requestMessageId: id,
    sessionGeneration: 3,
    backendModel: 'ollama/qwen3:8b',
    rootSessionKey,
  };
}

async function createFixture(t, name) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sessionsDir = path.join(directory, 'sessions');
  const sourceRoot = path.join(directory, 'F-source');
  const openclawHome = path.join(directory, '.openclaw');
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.mkdir(sourceRoot, { recursive: true });
  const images = [];
  for (let index = 1; index <= 5; index += 1) {
    const imagePath = path.join(sourceRoot, `ảnh-${index}.png`);
    await fs.writeFile(imagePath, Buffer.concat([PNG_BYTES, Buffer.from([index])]));
    images.push(imagePath);
  }
  return {
    directory,
    sessionsDir,
    sourceRoot,
    openclawHome,
    images,
    storePath: path.join(directory, 'data', 'jobs.json'),
  };
}

function createTaskClient(tasksRef, cancelled = []) {
  return {
    list: async () => tasksRef.value.map((task) => ({ ...task })),
    listForSession: async (sessionKey) => tasksRef.value.filter((task) => (
      task.requesterSessionKey === sessionKey
      || task.ownerKey === sessionKey
      || task.childSessionKey === sessionKey
    )).map((task) => ({ ...task })),
    show: async (taskId) => {
      const task = tasksRef.value.find((item) => item.taskId === taskId);
      if (!task) {
        throw new Error('missing');
      }
      return { ...task };
    },
    cancel: async (taskId) => {
      cancelled.push(taskId);
      const task = tasksRef.value.find((item) => item.taskId === taskId);
      if (task) {
        task.status = 'cancelled';
      }
    },
  };
}

function createSupervisor(fixture, store, tasksRef, sendArtifact, overrides = {}) {
  return new JobSupervisor({
    store,
    taskClient: createTaskClient(tasksRef, overrides.cancelled),
    openclaw: overrides.openclaw || { chat: async () => 'Đã khôi phục.' },
    sessionsDir: fixture.sessionsDir,
    openclawHome: fixture.openclawHome,
    allowedRoots: [fixture.sourceRoot],
    outboxRoot: path.join(fixture.directory, 'outbox'),
    pollMs: 60000,
    discoveryGraceMs: overrides.discoveryGraceMs ?? 0,
    terminalGraceMs: overrides.terminalGraceMs ?? 0,
    taskContinuationGraceMs: overrides.taskContinuationGraceMs ?? 0,
    cancelGraceMs: overrides.cancelGraceMs ?? 10,
    cancelConfirmationGraceMs: overrides.cancelConfirmationGraceMs ?? 0,
    cancelRetryMs: overrides.cancelRetryMs ?? 0,
    retryDelaysMs: overrides.retryDelaysMs ?? [],
    idleTimeoutMs: 1000,
    maxRuntimeMs: 5000,
    sendActivity: overrides.sendActivity,
    sendArtifact,
  });
}

async function writeSessionIndex(fixture, rootSessionKey, childSessionKey) {
  const rootTranscript = path.join(fixture.sessionsDir, 'root.jsonl');
  const childTranscript = path.join(fixture.sessionsDir, '2026-08-01-child.jsonl');
  await fs.writeFile(rootTranscript, '', 'utf8');
  await fs.writeFile(childTranscript, '', 'utf8');
  await fs.writeFile(path.join(fixture.sessionsDir, 'sessions.json'), JSON.stringify({
    [rootSessionKey]: { sessionId: 'root', sessionFile: rootTranscript },
    [childSessionKey]: { sessionId: 'child', sessionFile: childTranscript },
  }), 'utf8');
  return { rootTranscript, childTranscript };
}

test('parent kết thúc nhưng child vẫn gửi đủ bốn MEDIA, kể cả trong toolUse', async (t) => {
  const fixture = await createFixture(t, 'bot-openclaw-supervisor');
  const rootSessionKey = 'agent:main:openai-user:discord:guild:channel:3';
  const childSessionKey = 'agent:main:subagent:child-1';
  const transcripts = await writeSessionIndex(fixture, rootSessionKey, childSessionKey);
  const tasksRef = { value: [{
    taskId: 'task-1',
    requesterSessionKey: rootSessionKey,
    ownerKey: rootSessionKey,
    childSessionKey,
    status: 'running',
    createdAt: Date.now(),
    task: 'prompt có sk-secretsecretsecret và C:\\Users\\songt\\secret.txt',
    progressSummary: 'Đang xử lý C:\\Users\\songt\\secret.txt với sk-secretsecretsecret',
  }] };
  const sent = [];
  const activities = [];
  const store = new JobStore(fixture.storePath);
  await store.load();
  const supervisor = createSupervisor(fixture, store, tasksRef, async (_job, artifact) => {
    sent.push(path.basename(artifact.sourcePath));
    return `discord-${sent.length}`;
  }, {
    sendActivity: async (_job, event) => activities.push(event),
  });
  const job = await supervisor.createJob(jobInput('job-parent-child', rootSessionKey), { watch: false });
  await supervisor.watchJob(job.id, { rootStartAtEnd: true });
  await supervisor.syncTasks(job.id);
  assert.equal(
    store.getJob(job.id).events.filter((event) => event.startsWith('🤖 Worker bắt đầu:')).length,
    1,
  );
  await supervisor.markForegroundDone(job.id);
  assert.equal(store.getJob(job.id).status, 'background');

  await fs.appendFile(transcripts.childTranscript, [
    transcriptMessage({
      role: 'assistant',
      stopReason: 'toolUse',
      content: [
        { type: 'text', text: `Ảnh 1/4 đã kiểm tra.\nMEDIA:${fixture.images[0]}` },
        { type: 'toolCall', name: 'image', arguments: { image: 'C:\\screen-check.png' } },
      ],
    }),
    ...fixture.images.slice(1, 4).map((imagePath, index) => transcriptMessage({
      role: 'assistant',
      stopReason: 'stop',
      content: [{ type: 'text', text: `Ảnh ${index + 2}/4 đã kiểm tra.\nMEDIA:${imagePath}` }],
    })),
  ].join(''), 'utf8');
  tasksRef.value[0].status = 'succeeded';
  const settledPromise = supervisor.waitForSettled(job.id);
  await supervisor.syncTasks(job.id);
  const settled = await settledPromise;
  assert.equal(settled.status, 'completed');
  assert.deepEqual(sent, ['ảnh-1.png', 'ảnh-2.png', 'ảnh-3.png', 'ảnh-4.png']);
  assert.equal(Object.values(settled.artifacts).every((artifact) => artifact.status === 'delivered'), true);
  assert.equal(Object.values(settled.tasks)[0].task, undefined);
  assert.equal(JSON.stringify(settled.tasks).includes('secret.txt'), false);
  assert.equal(JSON.stringify(settled.artifacts).includes('screen-check.png'), false);
  assert.equal(
    settled.events.filter((event) => event.startsWith('✓ Worker hoàn tất:')).length,
    1,
  );
  assert.equal(settled.events.some((event) => event.includes('Ảnh 4/4')), false);
  assert.equal(settled.sessionActivities[childSessionKey].events.some((event) => (
    event.kind === 'assistant' && event.text.includes('Ảnh 4/4')
  )), true);
  assert.equal(settled.sessionActivities[childSessionKey].events.some((event) => (
    event.kind === 'tool_call'
  )), true);
  assert.equal(activities.some((event) => (
    event.kind === 'assistant'
    && event.final
    && !event.isRoot
    && event.notificationText.includes('Ảnh 4/4')
  )), true);
  assert.equal(activities.some((event) => event.kind === 'tool_call' && !event.isRoot), true);
  assert.equal(activities.some((event) => event.origin === 'terminal'), true);
});

test('restart dùng offset bền vững, không gửi trùng và tiếp tục giữ child session', async (t) => {
  const fixture = await createFixture(t, 'bot-openclaw-restart');
  const rootSessionKey = 'agent:main:openai-user:discord:guild:channel:4';
  const childSessionKey = 'agent:main:subagent:child-restart';
  const transcripts = await writeSessionIndex(fixture, rootSessionKey, childSessionKey);
  const tasksRef = { value: [{
    taskId: 'task-restart',
    requesterSessionKey: rootSessionKey,
    ownerKey: rootSessionKey,
    childSessionKey,
    status: 'running',
    createdAt: Date.now(),
  }] };

  const firstStore = new JobStore(fixture.storePath);
  await firstStore.load();
  const firstSent = [];
  const firstSupervisor = createSupervisor(fixture, firstStore, tasksRef, async (_job, artifact) => {
    firstSent.push(artifact.id);
    return `before-${firstSent.length}`;
  });
  const job = await firstSupervisor.createJob(jobInput('job-restart', rootSessionKey), { watch: false });
  await firstSupervisor.watchJob(job.id, { rootStartAtEnd: true });
  await firstSupervisor.syncTasks(job.id);
  await firstSupervisor.markForegroundDone(job.id);
  await fs.appendFile(transcripts.childTranscript, fixture.images.slice(0, 2).map((imagePath, index) => (
    transcriptMessage({
      role: 'assistant',
      stopReason: 'stop',
      content: [{ type: 'text', text: `Ảnh ${index + 1}.\nMEDIA:${imagePath}` }],
    })
  )).join(''), 'utf8');
  await firstSupervisor.contexts.get(job.id).monitors.get(childSessionKey).poll();
  await Promise.all([...firstSupervisor.contexts.get(job.id).deliveries.values()]);
  await firstSupervisor.closeContext(job.id);
  assert.equal(firstSent.length, 2);
  const pending = await stageMediaReference(fixture.images[4], {
    jobId: job.id,
    allowedRoots: [fixture.sourceRoot],
    outboxRoot: path.join(fixture.directory, 'outbox'),
  });
  await firstStore.upsertArtifact(job.id, { ...pending.artifact, order: 3, status: 'ready' });
  // Write-behind gộp các lần ghi; flush mô phỏng shutdown sạch trước restart.
  await firstStore.flush();

  await fs.appendFile(transcripts.childTranscript, fixture.images.slice(2, 4).map((imagePath, index) => (
    transcriptMessage({
      role: 'assistant',
      stopReason: 'stop',
      content: [{ type: 'text', text: `Ảnh ${index + 3}.\nMEDIA:${imagePath}` }],
    })
  )).join(''), 'utf8');

  const secondStore = new JobStore(fixture.storePath);
  await secondStore.load();
  const secondSent = [];
  const secondSupervisor = createSupervisor(fixture, secondStore, tasksRef, async (_job, artifact) => {
    secondSent.push(artifact.id);
    return `after-${secondSent.length}`;
  });
  await secondSupervisor.watchJob(job.id, { recovered: true });
  await secondSupervisor.syncTasks(job.id);
  await secondSupervisor.contexts.get(job.id).monitors.get(childSessionKey).poll();
  tasksRef.value[0].status = 'succeeded';
  const settledPromise = secondSupervisor.waitForSettled(job.id);
  await secondSupervisor.syncTasks(job.id);
  const settled = await settledPromise;

  assert.equal(settled.status, 'completed');
  assert.equal(Object.keys(settled.artifacts).length, 5);
  assert.equal(secondSent.length, 3);
  assert.equal(new Set([...firstSent, ...secondSent]).size, 5);
});

test('delivery chỉ xác nhận sau Discord message ID, retry ba lần và resend có chủ đích', async (t) => {
  const fixture = await createFixture(t, 'bot-openclaw-delivery');
  const store = new JobStore(fixture.storePath);
  await store.load();
  const rootSessionKey = 'agent:main:openai-user:discord:guild:channel:5';
  const job = await store.createJob(jobInput('job-delivery', rootSessionKey));
  const staged = await stageMediaReference(fixture.images[0], {
    jobId: job.id,
    allowedRoots: [fixture.sourceRoot],
    outboxRoot: path.join(fixture.directory, 'outbox'),
  });
  await store.upsertArtifact(job.id, { ...staged.artifact, order: 1 });
  await fs.rm(staged.artifact.stagedPath);
  let calls = 0;
  const supervisor = createSupervisor(fixture, store, { value: [] }, async () => {
    calls += 1;
    if (calls < 3) {
      throw new Error('discord offline');
    }
    return calls === 3 ? 'message-1' : 'message-2';
  }, { retryDelaysMs: [1, 1] });

  await supervisor.deliverArtifact(job.id, staged.artifact.id);
  let artifact = store.getJob(job.id).artifacts[staged.artifact.id];
  assert.equal(artifact.status, 'delivered');
  assert.equal(artifact.attempts, 3);
  assert.deepEqual(artifact.discordMessageIds, ['message-1']);
  assert.equal(await fs.access(artifact.stagedPath).then(() => true, () => false), true);

  await supervisor.resend(job.id, '1', true);
  artifact = store.getJob(job.id).artifacts[staged.artifact.id];
  assert.equal(artifact.attempts, 4);
  assert.deepEqual(artifact.discordMessageIds, ['message-1', 'message-2']);
});

test('có thể staging nhiều ảnh trước rồi gửi tuần tự với caption riêng', async (t) => {
  const fixture = await createFixture(t, 'bot-openclaw-sequential-delivery');
  const store = new JobStore(fixture.storePath);
  await store.load();
  const rootSessionKey = 'agent:main:openai-user:discord:guild:channel:sequential';
  const job = await store.createJob(jobInput('job-sequential', rootSessionKey));
  const sent = [];
  const supervisor = createSupervisor(fixture, store, { value: [] }, async (_job, artifact) => {
    sent.push({ order: artifact.order, label: artifact.label });
    return `message-${sent.length}`;
  });

  const first = await supervisor.registerArtifact(
    job.id,
    fixture.images[0],
    '**0001 — Ảnh thứ nhất**',
    { deliver: false },
  );
  const second = await supervisor.registerArtifact(
    job.id,
    fixture.images[1],
    '**0002 — Ảnh thứ hai**',
    { deliver: false },
  );
  assert.deepEqual(sent, []);

  await supervisor.deliverArtifact(job.id, first.id);
  await supervisor.deliverArtifact(job.id, second.id);
  assert.deepEqual(sent, [
    { order: 1, label: '**0001 — Ảnh thứ nhất**' },
    { order: 2, label: '**0002 — Ảnh thứ hai**' },
  ]);
});

test('delivery thất bại sau ba lần vẫn giữ ready và stop gọi task cancel chính thức', async (t) => {
  const fixture = await createFixture(t, 'bot-openclaw-failure');
  const rootSessionKey = 'agent:main:openai-user:discord:guild:channel:6';
  const childSessionKey = 'agent:main:subagent:child-stop';
  await writeSessionIndex(fixture, rootSessionKey, childSessionKey);
  const tasksRef = { value: [] };
  const cancelled = [];
  const store = new JobStore(fixture.storePath);
  await store.load();
  const job = await store.createJob(jobInput('job-failure', rootSessionKey));
  const staged = await stageMediaReference(fixture.images[0], {
    jobId: job.id,
    allowedRoots: [fixture.sourceRoot],
    outboxRoot: path.join(fixture.directory, 'outbox'),
  });
  await store.upsertArtifact(job.id, { ...staged.artifact, order: 1 });
  const supervisor = createSupervisor(fixture, store, tasksRef, async () => {
    throw new Error('discord offline');
  }, { retryDelaysMs: [1, 1], cancelled, cancelGraceMs: 1000 });

  await assert.rejects(() => supervisor.deliverArtifact(job.id, staged.artifact.id), /discord offline/);
  assert.equal(store.getJob(job.id).artifacts[staged.artifact.id].status, 'ready');
  assert.equal(store.getJob(job.id).artifacts[staged.artifact.id].attempts, 3);

  await supervisor.watchJob(job.id);
  await supervisor.cancelJob(job.id);
  tasksRef.value.push({
    taskId: 'task-stop',
    requesterSessionKey: rootSessionKey,
    ownerKey: rootSessionKey,
    childSessionKey,
    status: 'running',
    createdAt: Date.now(),
  });
  await supervisor.syncTasks(job.id);
  assert.deepEqual(cancelled, ['task-stop']);
  await supervisor.markForegroundDone(job.id);
  await supervisor.syncTasks(job.id);
  assert.equal((await supervisor.waitForSettled(job.id)).status, 'stopped');
});

test('task từng chạy nhưng không truy vấn được vẫn giữ last-known và không recovery mù quáng', async (t) => {
  const fixture = await createFixture(t, 'bot-openclaw-recover-blocked');
  const rootSessionKey = 'agent:main:openai-user:discord:guild:channel:7';
  await writeSessionIndex(fixture, rootSessionKey, rootSessionKey);
  const store = new JobStore(fixture.storePath);
  await store.load();
  const job = await store.createJob(jobInput('job-recover-blocked', rootSessionKey));
  await store.updateJob(job.id, { status: 'background' });
  await store.upsertTask(job.id, {
    taskId: 'task-missing',
    requesterSessionKey: rootSessionKey,
    ownerKey: rootSessionKey,
    childSessionKey: rootSessionKey,
    status: 'running',
    createdAt: Date.now(),
  });
  let recoveryCalls = 0;
  const supervisor = createSupervisor(fixture, store, { value: [] }, async () => 'unused', {
    terminalGraceMs: 50,
    openclaw: {
      chat: async () => {
        recoveryCalls += 1;
        return 'không được gọi';
      },
    },
  });

  await supervisor.watchJob(job.id, { recovered: true });
  await supervisor.syncTasks(job.id);
  void supervisor.recoverJob(job.id);
  await supervisor.syncTasks(job.id);
  const current = store.getJob(job.id);
  assert.equal(recoveryCalls, 0);
  assert.equal(current.recoveryCount, 0);
  assert.equal(current.status, 'background');
  assert.equal(current.taskSyncState, 'degraded');
  assert.equal(current.tasks['task-missing'].status, 'running');
  await supervisor.closeContext(job.id);
});

test('restart sau khi đã gửi phản hồi không phát lại prompt nếu không có task', async (t) => {
  const fixture = await createFixture(t, 'bot-openclaw-recover-response');
  const rootSessionKey = 'agent:main:openai-user:discord:guild:channel:8';
  await writeSessionIndex(fixture, rootSessionKey, rootSessionKey);
  const store = new JobStore(fixture.storePath);
  await store.load();
  const job = await store.createJob(jobInput('job-response-sent', rootSessionKey));
  await store.updateJob(job.id, { status: 'running', responseSent: true });
  let recoveryCalls = 0;
  const supervisor = createSupervisor(fixture, store, { value: [] }, async () => 'unused', {
    discoveryGraceMs: 50,
    terminalGraceMs: 50,
    openclaw: {
      chat: async () => {
        recoveryCalls += 1;
        return 'không được gọi';
      },
    },
  });

  const settled = await supervisor.recoverJob(job.id);
  assert.equal(recoveryCalls, 0);
  assert.equal(settled.status, 'completed');
});

test('stop đồng thời với syncTasks giữ stopping và không bị ghi đè về background', async (t) => {
  const fixture = await createFixture(t, 'bot-openclaw-stop-race');
  const rootSessionKey = 'agent:main:openai-user:discord:guild:channel:9';
  const childSessionKey = 'agent:main:subagent:child-race';
  await writeSessionIndex(fixture, rootSessionKey, childSessionKey);
  const store = new JobStore(fixture.storePath);
  await store.load();
  const job = await store.createJob(jobInput('job-stop-race', rootSessionKey));
  const supervisor = createSupervisor(fixture, store, { value: [] }, async () => 'unused');
  const context = await supervisor.watchJob(job.id);
  context.foregroundDone = true;
  context.stopRequested = true;
  await store.updateJob(job.id, { status: 'background', stopRequested: true });

  let releaseList;
  let markListStarted;
  const listStarted = new Promise((resolve) => {
    markListStarted = resolve;
  });
  const listReleased = new Promise((resolve) => {
    releaseList = resolve;
  });
  supervisor.taskClient.list = async () => {
    markListStarted();
    await listReleased;
    return [{
      taskId: 'task-race',
      requesterSessionKey: rootSessionKey,
      ownerKey: rootSessionKey,
      childSessionKey,
      status: 'running',
      createdAt: Date.now(),
    }];
  };

  const pendingSync = supervisor.syncTasks(job.id);
  await listStarted;
  await supervisor.settle(job.id);
  releaseList();
  await pendingSync;

  assert.equal(store.getJob(job.id).status, 'stopping');
  assert.equal(store.getJob(job.id).stopRequested, true);
});

test('restart hòa giải background cũ đã yêu cầu dừng mà không chạy recovery', async (t) => {
  const fixture = await createFixture(t, 'bot-openclaw-recover-stopped');
  const rootSessionKey = 'agent:main:openai-user:discord:guild:channel:10';
  await writeSessionIndex(fixture, rootSessionKey, rootSessionKey);
  const store = new JobStore(fixture.storePath);
  await store.load();
  const job = await store.createJob(jobInput('job-recover-stopped', rootSessionKey));
  await store.updateJob(job.id, {
    status: 'background',
    responseSent: true,
    terminalReason: 'Đã dừng theo yêu cầu người dùng.',
  });
  await store.upsertTask(job.id, {
    taskId: 'task-stopped',
    requesterSessionKey: rootSessionKey,
    ownerKey: rootSessionKey,
    childSessionKey: rootSessionKey,
    status: 'succeeded',
    createdAt: Date.now(),
  });
  let recoveryCalls = 0;
  const supervisor = createSupervisor(fixture, store, { value: [] }, async () => 'unused', {
    openclaw: {
      chat: async () => {
        recoveryCalls += 1;
        return 'không được gọi';
      },
    },
  });

  const settled = await supervisor.recoverJob(job.id);
  assert.equal(recoveryCalls, 0);
  assert.equal(settled.status, 'stopped');
  assert.equal(settled.stopRequested, true);
});

test('task thất bại nhưng session gốc phục hồi và ra phản hồi cuối thì job hoàn tất', async (t) => {
  const fixture = await createFixture(t, 'bot-openclaw-root-recovery');
  const rootSessionKey = 'agent:main:openai-user:discord:guild:channel:recovery';
  const rootTranscript = path.join(fixture.sessionsDir, 'root.jsonl');
  await fs.writeFile(rootTranscript, '', 'utf8');
  await fs.writeFile(path.join(fixture.sessionsDir, 'sessions.json'), JSON.stringify({
    [rootSessionKey]: { sessionId: 'root', sessionFile: rootTranscript },
  }), 'utf8');
  const tasksRef = { value: [{
    taskId: 'task-failed-timeout',
    requesterSessionKey: rootSessionKey,
    ownerKey: rootSessionKey,
    childSessionKey: rootSessionKey,
    status: 'failed',
    error: 'request timed out',
    terminalSummary: 'request timed out',
    createdAt: Date.now() - 1000,
    endedAt: Date.now() - 1000,
  }] };
  const store = new JobStore(fixture.storePath);
  await store.load();
  const sent = [];
  const activities = [];
  const supervisor = createSupervisor(fixture, store, tasksRef, async (_job, artifact) => {
    sent.push(path.basename(artifact.sourcePath));
    return `discord-${sent.length}`;
  }, {
    sendActivity: async (_job, event) => activities.push(event),
  });
  const job = await supervisor.createJob(jobInput('job-root-recovery', rootSessionKey), { watch: false });
  await supervisor.watchJob(job.id, { rootStartAtEnd: true });

  // Session gốc vẫn hoạt động sau khi task thất bại (agent đang phục hồi).
  await fs.appendFile(rootTranscript, transcriptMessage({
    role: 'assistant',
    stopReason: 'toolUse',
    content: [{ type: 'toolCall', name: 'exec', arguments: { command: 'retry generate' } }],
  }), 'utf8');
  await supervisor.contexts.get(job.id).monitors.get(rootSessionKey).poll();
  await supervisor.markForegroundDone(job.id);
  await supervisor.syncTasks(job.id);
  assert.equal(TERMINAL_JOB_STATUSES.has(store.getJob(job.id).status), false);

  // Agent tiếp tục và ra phản hồi cuối với MEDIA → job phải settle completed,
  // không failed, và artifact được gửi.
  await fs.appendFile(rootTranscript, transcriptMessage({
    role: 'assistant',
    stopReason: 'stop',
    content: [{
      type: 'text',
      text: `Đã phục hồi sau lỗi task.\nMEDIA:${fixture.images[0]}`,
    }],
  }), 'utf8');
  await supervisor.contexts.get(job.id).monitors.get(rootSessionKey).poll();
  const settledPromise = supervisor.waitForSettled(job.id);
  await supervisor.syncTasks(job.id);
  const settled = await settledPromise;

  assert.equal(settled.status, 'completed');
  assert.equal(settled.terminalReason, '');
  assert.deepEqual(sent, [path.basename(fixture.images[0])]);
  assert.equal(settled.events.some((event) => event.startsWith('✗ Worker gặp vấn đề:')), true);
  assert.equal(activities.some((event) => (
    event.kind === 'assistant' && event.final && event.isRoot && event.responseText.includes('Đã phục hồi')
  )), true);
});

test('task thất bại và session gốc im lặng thì vẫn settle failed sau idle', async (t) => {
  const fixture = await createFixture(t, 'bot-openclaw-root-idle-fail');
  const rootSessionKey = 'agent:main:openai-user:discord:guild:channel:idle-fail';
  const rootTranscript = path.join(fixture.sessionsDir, 'root.jsonl');
  await fs.writeFile(rootTranscript, '', 'utf8');
  await fs.writeFile(path.join(fixture.sessionsDir, 'sessions.json'), JSON.stringify({
    [rootSessionKey]: { sessionId: 'root', sessionFile: rootTranscript },
  }), 'utf8');
  const tasksRef = { value: [{
    taskId: 'task-failed-quiet',
    requesterSessionKey: rootSessionKey,
    ownerKey: rootSessionKey,
    childSessionKey: rootSessionKey,
    status: 'failed',
    error: 'request timed out',
    createdAt: Date.now() - 1000,
    endedAt: Date.now() - 1000,
  }] };
  const store = new JobStore(fixture.storePath);
  await store.load();
  const supervisor = createSupervisor(fixture, store, tasksRef, async () => 'discord-x');
  const job = await supervisor.createJob(jobInput('job-idle-fail', rootSessionKey), { watch: false });
  await supervisor.watchJob(job.id, { rootStartAtEnd: true });

  await fs.appendFile(rootTranscript, transcriptMessage({
    role: 'assistant',
    stopReason: 'toolUse',
    content: [{ type: 'toolCall', name: 'exec', arguments: { command: 'work' } }],
  }), 'utf8');
  await supervisor.contexts.get(job.id).monitors.get(rootSessionKey).poll();
  await supervisor.markForegroundDone(job.id);
  await supervisor.syncTasks(job.id);
  assert.equal(TERMINAL_JOB_STATUSES.has(store.getJob(job.id).status), false);

  // Session gốc không ra phản hồi cuối; sau idleTimeoutMs (1000ms) phải settle failed.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const settledPromise = supervisor.waitForSettled(job.id);
  await supervisor.syncTasks(job.id);
  const settled = await settledPromise;

  assert.equal(settled.status, 'failed');
  assert.equal(settled.terminalReason, 'OpenClaw không hoàn tất được yêu cầu.');
});

test('foreground kết thúc khi worker nền còn chạy: chờ continuation, bắt task mới xuất hiện muộn', async (t) => {
  const fixture = await createFixture(t, 'bot-openclaw-continuation');
  const rootSessionKey = 'agent:main:openai-user:discord:guild:channel:continuation';
  const childSessionKey = 'agent:main:subagent:child-continuation';
  const transcripts = await writeSessionIndex(fixture, rootSessionKey, childSessionKey);
  const tasksRef = { value: [{
    taskId: 'task-1',
    requesterSessionKey: rootSessionKey,
    ownerKey: rootSessionKey,
    childSessionKey,
    status: 'running',
    createdAt: Date.now(),
  }] };
  const store = new JobStore(fixture.storePath);
  await store.load();
  const supervisor = createSupervisor(fixture, store, tasksRef, async () => 'discord-x', {
    taskContinuationGraceMs: 1000,
  });
  const job = await supervisor.createJob(jobInput('job-continuation', rootSessionKey), { watch: false });
  await supervisor.watchJob(job.id, { rootStartAtEnd: true });
  await supervisor.syncTasks(job.id);

  // Agent trả lời xong (foreground) trong khi worker nền vẫn chạy.
  await supervisor.markForegroundDone(job.id);
  assert.equal(store.getJob(job.id).status, 'background');

  // Worker nền kết thúc → job chưa được settle vì còn chờ continuation.
  tasksRef.value[0].status = 'succeeded';
  await supervisor.syncTasks(job.id);
  assert.equal(TERMINAL_JOB_STATUSES.has(store.getJob(job.id).status), false);

  // Agent tự tiếp tục nền: task MỚI xuất hiện sau task cũ (trong grace).
  tasksRef.value.push({
    taskId: 'task-2',
    requesterSessionKey: rootSessionKey,
    ownerKey: rootSessionKey,
    childSessionKey,
    status: 'running',
    createdAt: Date.now(),
  });
  await supervisor.syncTasks(job.id);
  assert.equal(TERMINAL_JOB_STATUSES.has(store.getJob(job.id).status), false);
  assert.equal(
    Object.values(store.getJob(job.id).tasks).some((task) => task.taskId === 'task-2'),
    true,
  );

  // Task continuation kết thúc → sau grace job mới settle.
  tasksRef.value[1].status = 'succeeded';
  await supervisor.syncTasks(job.id);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const settledPromise = supervisor.waitForSettled(job.id);
  await supervisor.syncTasks(job.id);
  const settled = await settledPromise;
  assert.equal(settled.status, 'completed');
  assert.equal(Object.keys(settled.tasks).length, 2);
});

test('foreground kết thúc sau khi worker xong: settle ngay, không chờ continuation', async (t) => {
  const fixture = await createFixture(t, 'bot-openclaw-continuation-fast');
  const rootSessionKey = 'agent:main:openai-user:discord:guild:channel:continuation-fast';
  const childSessionKey = 'agent:main:subagent:child-continuation-fast';
  const transcripts = await writeSessionIndex(fixture, rootSessionKey, childSessionKey);
  const tasksRef = { value: [{
    taskId: 'task-1',
    requesterSessionKey: rootSessionKey,
    ownerKey: rootSessionKey,
    childSessionKey,
    status: 'succeeded',
    createdAt: Date.now() - 1000,
    endedAt: Date.now() - 1000,
  }] };
  const store = new JobStore(fixture.storePath);
  await store.load();
  const supervisor = createSupervisor(fixture, store, tasksRef, async () => 'discord-x', {
    terminalGraceMs: 0,
    taskContinuationGraceMs: 600000,
  });
  const job = await supervisor.createJob(jobInput('job-continuation-fast', rootSessionKey), { watch: false });
  await supervisor.watchJob(job.id, { rootStartAtEnd: true });
  await supervisor.syncTasks(job.id);
  await supervisor.markForegroundDone(job.id);
  const settledPromise = supervisor.waitForSettled(job.id);
  await supervisor.syncTasks(job.id);
  const settled = await settledPromise;
  assert.equal(settled.status, 'completed');
});

test('hết thời gian cảnh báo vẫn giữ stopping khi worker còn chạy', async (t) => {
  const fixture = await createFixture(t, 'bot-openclaw-cancel-unconfirmed');
  const rootSessionKey = 'agent:main:openai-user:discord:guild:channel:cancel-unconfirmed';
  const childSessionKey = 'agent:main:subagent:cancel-unconfirmed';
  await writeSessionIndex(fixture, rootSessionKey, childSessionKey);
  const tasksRef = { value: [{
    taskId: 'task-cancel-unconfirmed',
    requesterSessionKey: rootSessionKey,
    ownerKey: rootSessionKey,
    childSessionKey,
    status: 'running',
    createdAt: Date.now(),
  }] };
  const cancelled = [];
  const store = new JobStore(fixture.storePath);
  await store.load();
  const supervisor = createSupervisor(fixture, store, tasksRef, async () => 'unused', {
    cancelled,
    cancelGraceMs: 10,
    cancelRetryMs: 10000,
  });
  supervisor.taskClient.cancel = async (taskId) => {
    cancelled.push(taskId);
    return { found: true, cancelled: false };
  };
  const job = await supervisor.createJob(jobInput('job-cancel-unconfirmed', rootSessionKey), { watch: false });
  const context = await supervisor.watchJob(job.id);
  context.foregroundDone = true;
  await supervisor.syncTasks(job.id);
  await supervisor.cancelJob(job.id);
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(store.getJob(job.id).status, 'stopping');
  assert.ok(store.getJob(job.id).cancelWarningAt);
  assert.equal((await supervisor.settle(job.id)).status, 'stopping');
  await supervisor.cancelJob(job.id);
  assert.deepEqual(cancelled, ['task-cancel-unconfirmed']);

  tasksRef.value[0].status = 'cancelled';
  const settledPromise = supervisor.waitForSettled(job.id);
  await supervisor.syncTasks(job.id);
  const settled = await settledPromise;
  assert.equal(settled.status, 'stopped');
  assert.ok(settled.cancelConfirmedAt);
});

test('RPC lỗi trong lúc hủy giữ last-known worker và trạng thái degraded', async (t) => {
  const fixture = await createFixture(t, 'bot-openclaw-cancel-degraded');
  const rootSessionKey = 'agent:main:openai-user:discord:guild:channel:cancel-degraded';
  await writeSessionIndex(fixture, rootSessionKey, rootSessionKey);
  const store = new JobStore(fixture.storePath);
  await store.load();
  const job = await store.createJob(jobInput('job-cancel-degraded', rootSessionKey));
  await store.updateJob(job.id, { status: 'background' });
  await store.upsertTask(job.id, {
    taskId: 'task-last-known',
    requesterSessionKey: rootSessionKey,
    ownerKey: rootSessionKey,
    childSessionKey: rootSessionKey,
    status: 'running',
    createdAt: Date.now(),
  });
  const supervisor = createSupervisor(fixture, store, { value: [] }, async () => 'unused');
  supervisor.taskClient.list = async () => { throw new Error('rpc offline'); };
  supervisor.taskClient.cancel = async () => ({ found: true, cancelled: false });

  await supervisor.cancelJob(job.id);
  const current = store.getJob(job.id);
  assert.equal(current.status, 'stopping');
  assert.equal(current.taskSyncState, 'degraded');
  assert.equal(current.tasks['task-last-known'].status, 'running');
  assert.equal((await supervisor.settle(job.id)).status, 'stopping');
  await supervisor.closeContext(job.id);
});

test('task con xuất hiện trong cửa sổ xác nhận hủy được phát hiện trước khi stopped', async (t) => {
  const fixture = await createFixture(t, 'bot-openclaw-cancel-discovery');
  const rootSessionKey = 'agent:main:openai-user:discord:guild:channel:cancel-discovery';
  const childSessionKey = 'agent:main:subagent:cancel-discovery';
  await writeSessionIndex(fixture, rootSessionKey, childSessionKey);
  const tasksRef = { value: [] };
  const cancelled = [];
  const store = new JobStore(fixture.storePath);
  await store.load();
  const supervisor = createSupervisor(fixture, store, tasksRef, async () => 'unused', {
    cancelled,
    cancelConfirmationGraceMs: 30,
    cancelRetryMs: 0,
  });
  supervisor.taskClient.cancel = async (taskId) => {
    cancelled.push(taskId);
    return { found: true, cancelled: false };
  };
  const job = await supervisor.createJob(jobInput('job-cancel-discovery', rootSessionKey), { watch: false });
  const context = await supervisor.watchJob(job.id);
  context.foregroundDone = true;
  await supervisor.cancelJob(job.id);
  assert.equal(store.getJob(job.id).status, 'stopping');

  tasksRef.value.push({
    taskId: 'task-late-child',
    requesterSessionKey: rootSessionKey,
    ownerKey: rootSessionKey,
    childSessionKey,
    status: 'running',
    createdAt: Date.now(),
  });
  await supervisor.syncTasks(job.id);
  assert.deepEqual(cancelled, ['task-late-child']);
  assert.equal(store.getJob(job.id).status, 'stopping');

  tasksRef.value[0].status = 'cancelled';
  await supervisor.syncTasks(job.id);
  await new Promise((resolve) => setTimeout(resolve, 40));
  const settledPromise = supervisor.waitForSettled(job.id);
  await supervisor.syncTasks(job.id);
  assert.equal((await settledPromise).status, 'stopped');
});

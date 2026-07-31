'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { JobStore, JobStoreError } = require('../src/job-store');

function jobInput(id = 'job-1') {
  return {
    id,
    guildId: '1239836342456942643',
    channelId: '1532669253722046484',
    userId: '395151484179841024',
    requestMessageId: id,
    sessionGeneration: 3,
    backendModel: 'ollama/qwen3:8b',
    rootSessionKey: `agent:main:openai-user:discord:guild:channel:${id}`,
  };
}

test('lưu nguyên tử job, offset và delivery ledger qua restart', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-openclaw-jobs-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'data', 'jobs.json');
  const store = new JobStore(filePath);
  await store.load();
  const created = await store.createJob(jobInput());
  await Promise.all([
    store.setSessionOffset(created.id, created.rootSessionKey, 123),
    store.addEvent(created.id, '✓ bước kiểm tra'),
  ]);
  await store.upsertArtifact(created.id, {
    id: 'hash-1',
    sha256: 'hash-1',
    sourcePath: 'F:\\Hình Ảnh\\anhYoutube\\01.png',
    stagedPath: 'C:\\outbox\\01.png',
    extension: '.png',
    size: 100,
    order: 1,
  });
  await store.updateArtifact(created.id, 'hash-1', {
    status: 'delivered',
    lastDiscordMessageId: '999999999999999999',
  });

  const reloaded = new JobStore(filePath);
  await reloaded.load();
  const job = reloaded.getJob(created.id);
  assert.equal(job.sessionOffsets[created.rootSessionKey], 123);
  assert.equal(job.backendModel, 'ollama/qwen3:8b');
  assert.equal(job.stopRequested, false);
  assert.equal(job.lastEvent, '✓ bước kiểm tra');
  assert.equal(job.artifacts['hash-1'].status, 'delivered');
  assert.equal(job.artifacts['hash-1'].lastDiscordMessageId, '999999999999999999');
  assert.equal((await fs.readFile(filePath, 'utf8')).endsWith('\n'), true);
});

test('job cũ thiếu stopRequested được nâng cấp mặc định thành false', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-openclaw-jobs-legacy-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'jobs.json');
  const store = new JobStore(filePath);
  await store.load();
  const job = await store.createJob(jobInput('job-legacy'));
  const state = JSON.parse(await fs.readFile(filePath, 'utf8'));
  delete state.jobs[job.id].stopRequested;
  await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  const reloaded = new JobStore(filePath);
  await reloaded.load();
  assert.equal(reloaded.getJob(job.id).stopRequested, false);
});

test('không ghi đè jobs.json bị hỏng', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-openclaw-jobs-bad-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'jobs.json');
  await fs.writeFile(filePath, '{bad json', 'utf8');
  const store = new JobStore(filePath);
  await assert.rejects(() => store.load(), JobStoreError);
  assert.equal(await fs.readFile(filePath, 'utf8'), '{bad json');
});

test('khôi phục state trong bộ nhớ nếu ghi nguyên tử thất bại', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-openclaw-jobs-rollback-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new JobStore(path.join(directory, 'jobs.json'));
  await store.load();
  const job = await store.createJob(jobInput('job-rollback'));
  store.saveNow = async () => {
    throw new JobStoreError('disk full');
  };

  await assert.rejects(() => store.updateJob(job.id, { status: 'running' }), /disk full/);
  assert.equal(store.getJob(job.id).status, 'queued');
});

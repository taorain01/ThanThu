'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ensureBridgeToken, startReviewerBridge } = require('../../src/reviewer-bridge');

test('reviewer bridge xác thực token và gửi command qua callback', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-reviewer-bridge-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const tokenPath = path.join(root, 'token.txt');
  const token = await ensureBridgeToken(tokenPath);
  const submitted = [];
  const bridge = await startReviewerBridge({
    port: 0,
    tokenPath,
    isReady: () => true,
    listChannels: async () => [{ id: '123456789012345678', name: 'demo', parentId: null }],
    listJobs: () => [],
    submitCommand: async (command) => {
      submitted.push(command);
      return { id: 'reviewer-test', channelId: command.channelId, status: 'queued', tasks: [], artifacts: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    },
    stopCommand: async () => null,
    resumeCommand: async () => null,
    logger: { info() {}, warn() {} },
  });
  t.after(() => bridge.close());

  const base = `http://127.0.0.1:${bridge.port}`;
  const health = await fetch(`${base}/health`).then((response) => response.json());
  assert.equal(health.ok, true);
  const unauthorized = await fetch(`${base}/channels`);
  assert.equal(unauthorized.status, 401);
  const channels = await fetch(`${base}/channels`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.json());
  assert.equal(channels.channels[0].name, 'demo');
  const command = await fetch(`${base}/commands`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId: '123456789012345678', text: 'Tạo một ảnh test.' }),
  }).then((response) => response.json());
  assert.equal(command.ok, true);
  assert.equal(submitted[0].text, 'Tạo một ảnh test.');
});

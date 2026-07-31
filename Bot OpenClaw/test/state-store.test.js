'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { StateStore, StateStoreError } = require('../src/state-store');

const GUILD_ID = '1239836342456942643';
const CHANNEL_A = '111111111111111111';
const CHANNEL_B = '222222222222222222';

async function makeStore(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-openclaw-state-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'data', 'state.json');
  const store = new StateStore(filePath, { now: () => new Date('2026-07-31T00:00:00.000Z') });
  await store.load();
  return { store, filePath };
}

test('mỗi channel giữ generation và trạng thái hoạt động độc lập', async (t) => {
  const { store, filePath } = await makeStore(t);

  assert.deepEqual(await store.bindChannel(GUILD_ID, CHANNEL_A), {
    channelId: CHANNEL_A,
    enabled: true,
    sessionGeneration: 1,
    updatedAt: '2026-07-31T00:00:00.000Z',
    changed: true,
    created: true,
    reactivated: false,
  });
  assert.equal((await store.bindChannel(GUILD_ID, CHANNEL_A)).sessionGeneration, 1);
  assert.equal((await store.bindChannel(GUILD_ID, CHANNEL_B)).sessionGeneration, 1);
  assert.equal((await store.resetSession(GUILD_ID, CHANNEL_A)).sessionGeneration, 2);
  assert.equal(store.getChannel(GUILD_ID, CHANNEL_B).sessionGeneration, 1);
  assert.equal((await store.unbind(GUILD_ID, CHANNEL_A)).sessionGeneration, 3);
  assert.equal(store.getChannel(GUILD_ID, CHANNEL_A).enabled, false);
  assert.equal(store.getChannel(GUILD_ID, CHANNEL_B).enabled, true);
  assert.equal((await store.bindChannel(GUILD_ID, CHANNEL_A)).sessionGeneration, 3);
  assert.deepEqual(
    store.getActiveChannels(GUILD_ID).map((entry) => entry.channelId),
    [CHANNEL_A, CHANNEL_B],
  );

  const reloaded = new StateStore(filePath);
  await reloaded.load();
  assert.equal(reloaded.getChannel(GUILD_ID, CHANNEL_A).sessionGeneration, 3);
  assert.equal(reloaded.getChannel(GUILD_ID, CHANNEL_B).sessionGeneration, 1);
  assert.equal(reloaded.getGuild(GUILD_ID).channels[CHANNEL_A].enabled, true);
});

test('tự chuyển state phiên bản 1 sang nhiều channel mà không mất phiên', async (t) => {
  const { filePath } = await makeStore(t);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({
    version: 1,
    guilds: {
      [GUILD_ID]: {
        channelId: CHANNEL_A,
        sessionGeneration: 7,
        updatedAt: '2026-07-31T01:00:00.000Z',
      },
    },
  }), 'utf8');

  const store = new StateStore(filePath);
  await store.load();
  assert.deepEqual(store.getChannel(GUILD_ID, CHANNEL_A), {
    channelId: CHANNEL_A,
    enabled: true,
    sessionGeneration: 7,
    updatedAt: '2026-07-31T01:00:00.000Z',
  });
  assert.equal(JSON.parse(await fs.readFile(filePath, 'utf8')).version, 2);
});

test('không ghi đè state JSON bị hỏng', async (t) => {
  const { filePath } = await makeStore(t);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, '{not-json', 'utf8');

  const store = new StateStore(filePath);
  await assert.rejects(() => store.load(), StateStoreError);
  assert.equal(await fs.readFile(filePath, 'utf8'), '{not-json');
});

test('từ chối state có entry null', async (t) => {
  const { filePath } = await makeStore(t);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    JSON.stringify({ version: 2, guilds: { [GUILD_ID]: null } }),
    'utf8',
  );
  const store = new StateStore(filePath);
  await assert.rejects(() => store.load(), StateStoreError);
});

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

test('bind, reset, đổi kênh và off tăng generation đúng cách', async (t) => {
  const { store, filePath } = await makeStore(t);

  assert.deepEqual(await store.bindChannel(GUILD_ID, CHANNEL_A), {
    channelId: CHANNEL_A,
    sessionGeneration: 1,
    updatedAt: '2026-07-31T00:00:00.000Z',
    changed: true,
  });
  assert.equal((await store.bindChannel(GUILD_ID, CHANNEL_A)).sessionGeneration, 1);
  assert.equal((await store.bindChannel(GUILD_ID, CHANNEL_B)).sessionGeneration, 2);
  assert.equal((await store.resetSession(GUILD_ID)).sessionGeneration, 3);
  assert.equal((await store.unbind(GUILD_ID)).sessionGeneration, 4);
  assert.equal(store.getGuild(GUILD_ID).channelId, null);

  const reloaded = new StateStore(filePath);
  await reloaded.load();
  assert.equal(reloaded.getGuild(GUILD_ID).sessionGeneration, 4);
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
    JSON.stringify({ version: 1, guilds: { [GUILD_ID]: null } }),
    'utf8',
  );
  const store = new StateStore(filePath);
  await assert.rejects(() => store.load(), StateStoreError);
});

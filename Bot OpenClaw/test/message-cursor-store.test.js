'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  MessageCursorStore,
  MessageCursorStoreError,
  compareSnowflakes,
} = require('../src/message-cursor-store');

const CHANNEL_ID = '1532669253722046484';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-openclaw-cursor-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return path.join(directory, 'data', 'message-cursors.json');
}

test('cursor chỉ tiến về message Discord mới hơn và giữ được qua restart', async (t) => {
  const filePath = await fixture(t);
  const store = new MessageCursorStore(filePath, {
    now: () => new Date('2026-08-01T01:00:00.000Z'),
  });
  await store.load();

  await store.advance(CHANNEL_ID, '1532898107770011688');
  await store.advance(CHANNEL_ID, '1532897034674110535');
  assert.equal(store.getChannel(CHANNEL_ID).lastMessageId, '1532898107770011688');

  const reloaded = new MessageCursorStore(filePath);
  await reloaded.load();
  assert.equal(reloaded.getChannel(CHANNEL_ID).lastMessageId, '1532898107770011688');
});

test('nhiều cập nhật đồng thời vẫn lưu snowflake lớn nhất', async (t) => {
  const filePath = await fixture(t);
  const store = new MessageCursorStore(filePath);
  await store.load();
  await Promise.all([
    store.advance(CHANNEL_ID, '1532898107770011688'),
    store.advance(CHANNEL_ID, '1532899999999999999'),
    store.advance(CHANNEL_ID, '1532899000000000000'),
  ]);
  assert.equal(store.getChannel(CHANNEL_ID).lastMessageId, '1532899999999999999');
});

test('so sánh snowflake không làm mất chính xác số lớn', () => {
  assert.equal(compareSnowflakes('1532898107770011688', '1532898107770011689'), -1);
  assert.equal(compareSnowflakes('1532898107770011689', '1532898107770011688'), 1);
  assert.equal(compareSnowflakes('1532898107770011688', '1532898107770011688'), 0);
});

test('không ghi đè file cursor bị hỏng', async (t) => {
  const filePath = await fixture(t);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, '{not-json', 'utf8');

  const store = new MessageCursorStore(filePath);
  await assert.rejects(() => store.load(), MessageCursorStoreError);
  assert.equal(await fs.readFile(filePath, 'utf8'), '{not-json');
});

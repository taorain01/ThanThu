'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const {
  SCREENSHOT_GALLERY_LIMIT,
  buildJobActionRows,
  buildScreenshotGalleryPayload,
} = require('../src/discord-job-ui');

test('tạo nút link mở thread chi tiết khi job đã có thread', () => {
  assert.deepEqual(buildJobActionRows({ guildId: '1', detailThreadId: null }), []);
  const rows = buildJobActionRows({ guildId: '1', detailThreadId: '2' });
  const button = rows[0].toJSON().components[0];
  assert.equal(button.label, 'Xem chi tiết');
  assert.equal(button.url, 'https://discord.com/channels/1/2');
});

test('gallery Components V2 chỉ giữ bốn ảnh gần nhất', () => {
  const screenshots = Array.from({ length: 5 }, (_, index) => ({
    id: `screen-${index + 1}`,
    stagedPath: `C:\\outbox\\screen-${index + 1}.png`,
    extension: '.png',
    capturedAt: `2026-08-01T00:00:0${index + 1}.000Z`,
  }));
  const payload = buildScreenshotGalleryPayload({
    id: '1535854242106052719',
    status: 'running',
    screenshots,
  });
  const container = payload.components[0].toJSON();
  const gallery = container.components.find((component) => component.type === 12);

  assert.equal(SCREENSHOT_GALLERY_LIMIT, 4);
  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  assert.equal(payload.attachments.length, 0);
  assert.equal(payload.files.length, 4);
  assert.equal(gallery.items.length, 4);
  assert.match(gallery.items.at(-1).description, /mới nhất/);
  assert.match(container.components[0].content, /4 ảnh gần nhất/);
  assert.match(container.components[0].content, /#06052719/);
});

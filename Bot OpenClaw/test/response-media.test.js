'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  extractMediaReferences,
  resolveMediaReferences,
} = require('../src/response-media');

test('tách MEDIA khỏi phản hồi và giữ nguyên văn bản hiển thị', () => {
  const parsed = extractMediaReferences([
    'Đã chụp xong.',
    'MEDIA:C:\\Users\\test\\.openclaw\\workspace\\screen one.png',
    'Dòng cuối.',
  ].join('\n'));

  assert.equal(parsed.text, 'Đã chụp xong.\nDòng cuối.');
  assert.deepEqual(parsed.references, [
    'C:\\Users\\test\\.openclaw\\workspace\\screen one.png',
  ]);
});

test('chỉ cho gửi ảnh trong workspace hoặc media của OpenClaw', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-openclaw-media-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const openclawHome = path.join(directory, '.openclaw');
  const workspace = path.join(openclawHome, 'workspace');
  const inbound = path.join(openclawHome, 'media', 'inbound');
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(inbound, { recursive: true });

  const workspaceImage = path.join(workspace, 'screen.png');
  const mediaImage = path.join(inbound, 'camera.webp');
  const outsideImage = path.join(directory, 'secret.png');
  await fs.writeFile(workspaceImage, Buffer.from('png'));
  await fs.writeFile(mediaImage, Buffer.from('webp'));
  await fs.writeFile(outsideImage, Buffer.from('outside'));

  const resolved = await resolveMediaReferences([
    workspaceImage,
    'media://inbound/camera.webp',
    outsideImage,
    workspaceImage,
  ], { openclawHome });

  assert.deepEqual(resolved.files.map((file) => path.basename(file.path)), [
    'screen.png',
    'camera.webp',
  ]);
  assert.equal(resolved.rejectedCount, 1);
});

test('từ chối ảnh vượt giới hạn dung lượng', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-openclaw-media-size-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const workspace = path.join(directory, 'workspace');
  await fs.mkdir(workspace, { recursive: true });
  const image = path.join(workspace, 'large.jpg');
  await fs.writeFile(image, Buffer.alloc(20));

  const resolved = await resolveMediaReferences([image], {
    allowedRoots: [workspace],
    mediaRoot: workspace,
    maxBytes: 10,
  });
  assert.equal(resolved.files.length, 0);
  assert.equal(resolved.rejectedCount, 1);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  artifactCaption,
  cleanupOutbox,
  extractMediaReferences,
  mediaNameFromReference,
  resolveMediaReferences,
  stageMediaReference,
} = require('../src/response-media');

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const WEBP_BYTES = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');

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
  assert.deepEqual(parsed.items, [{
    reference: 'C:\\Users\\test\\.openclaw\\workspace\\screen one.png',
    label: 'Đã chụp xong.',
  }]);
  assert.equal(parsed.standaloneText, 'Dòng cuối.');
});

test('ghép từng caption với đúng MEDIA và chỉ giữ lời dẫn làm văn bản riêng', () => {
  const parsed = extractMediaReferences([
    'Đã chép đủ 2 ảnh, gửi lại để duyệt:',
    '',
    '**0001 — Trời xanh yên bình**  ',
    'MEDIA:C:\\output\\0001 - Trời xanh yên bình (background).png',
    '',
    '**0002 — Buổi chiều nhẹ nhàng**  ',
    'MEDIA:C:\\output\\0002 - Buổi chiều nhẹ nhàng (background).png',
  ].join('\n'));

  assert.equal(parsed.standaloneText, 'Đã chép đủ 2 ảnh, gửi lại để duyệt:');
  assert.deepEqual(parsed.items, [
    {
      reference: 'C:\\output\\0001 - Trời xanh yên bình (background).png',
      label: '**0001 — Trời xanh yên bình**',
    },
    {
      reference: 'C:\\output\\0002 - Buổi chiều nhẹ nhàng (background).png',
      label: '**0002 — Buổi chiều nhẹ nhàng**',
    },
  ]);
});

test('tạo caption ảnh từ đúng tên file khi nhãn chung hoặc chứa nhiều ID', () => {
  const sourcePath = 'F:\\Hình Ảnh\\0013 - Give Yourself an Easy Start Today (background).png';
  assert.equal(
    mediaNameFromReference(sourcePath),
    '0013 — Give Yourself an Easy Start Today',
  );
  assert.equal(
    artifactCaption({ sourcePath, label: 'Ảnh thành phẩm từ OpenClaw', order: 13 }),
    '**0013 — Give Yourself an Easy Start Today**',
  );
  assert.equal(
    artifactCaption({
      sourcePath,
      label: '**0001 — Tên một** **0002 — Tên hai**',
      order: 13,
    }),
    '**0013 — Give Yourself an Easy Start Today**',
  );
  assert.equal(
    artifactCaption({ sourcePath, label: 'Phản hồi để duyệt: `duyệt 0013`', order: 13 }),
    '**0013 — Give Yourself an Easy Start Today**\nPhản hồi để duyệt: `duyệt 0013`',
  );
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
  await fs.writeFile(workspaceImage, PNG_BYTES);
  await fs.writeFile(mediaImage, WEBP_BYTES);
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

test('staging ảnh từ nguồn ngoài workspace bằng hash và chống gửi trùng', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-openclaw-stage-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourceRoot = path.join(directory, 'F-source', 'Hình Ảnh', 'anhYoutube');
  const outboxRoot = path.join(directory, 'outbox');
  const image = path.join(sourceRoot, 'ảnh gốc.png');
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.writeFile(image, PNG_BYTES);

  const first = await stageMediaReference(image, {
    jobId: 'job-1',
    allowedRoots: [sourceRoot],
    outboxRoot,
  });
  const second = await stageMediaReference(image, {
    jobId: 'job-1',
    allowedRoots: [sourceRoot],
    outboxRoot,
  });

  assert.equal(first.artifact.id, second.artifact.id);
  assert.equal(first.artifact.sourcePath, await fs.realpath(image));
  assert.equal((await fs.readFile(first.artifact.stagedPath)).equals(PNG_BYTES), true);
});

test('từ chối path traversal, symlink vượt allowlist và file giả ảnh', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-openclaw-media-safe-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const openclawHome = path.join(directory, '.openclaw');
  const mediaRoot = path.join(openclawHome, 'media');
  const allowedRoot = path.join(openclawHome, 'workspace');
  const outsideImage = path.join(directory, 'outside.png');
  const fakeImage = path.join(allowedRoot, 'fake.png');
  const linkedImage = path.join(allowedRoot, 'link.png');
  await fs.mkdir(allowedRoot, { recursive: true });
  await fs.mkdir(mediaRoot, { recursive: true });
  await fs.writeFile(outsideImage, PNG_BYTES);
  await fs.writeFile(fakeImage, Buffer.from('không phải ảnh'));
  try {
    await fs.symlink(outsideImage, linkedImage, 'file');
  } catch (error) {
    if (error.code !== 'EPERM') {
      throw error;
    }
  }

  const references = ['media://../outside.png', outsideImage, fakeImage];
  if (await fs.lstat(linkedImage).then(() => true, () => false)) {
    references.push(linkedImage);
  }
  const resolved = await resolveMediaReferences(references, {
    openclawHome,
    allowedRoots: [allowedRoot, mediaRoot],
  });
  assert.equal(resolved.files.length, 0);
  assert.equal(resolved.rejectedCount, references.length);
});

test('dọn thư mục staging quá hạn sau thời gian lưu giữ', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-openclaw-cleanup-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const oldJob = path.join(directory, 'old-job');
  const newJob = path.join(directory, 'new-job');
  await fs.mkdir(oldJob, { recursive: true });
  await fs.mkdir(newJob, { recursive: true });
  const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  await fs.utimes(oldJob, oldTime, oldTime);

  assert.equal(await cleanupOutbox(directory, 7 * 24 * 60 * 60 * 1000), 1);
  assert.equal(await fs.access(newJob).then(() => true, () => false), true);
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

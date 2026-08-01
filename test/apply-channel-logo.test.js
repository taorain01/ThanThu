'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const {
  applyChannelLogo,
  ChannelLogoError,
} = require('../scripts/apply-channel-logo');

test('chèn logo đúng giữa mép trên và giữ nguyên kích thước ảnh', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apply-channel-logo-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, 'input.png');
  const logoPath = path.join(directory, 'logo.png');
  const outputPath = path.join(directory, 'output.png');
  await sharp({
    create: { width: 1000, height: 500, channels: 4, background: '#4b92c4' },
  }).png().toFile(inputPath);
  await sharp({
    create: { width: 400, height: 100, channels: 4, background: '#ffffff' },
  }).png().toFile(logoPath);

  const result = await applyChannelLogo({
    inputPath,
    logoPath,
    outputPath,
    widthPercent: 20,
    topPercent: 4,
    shadow: false,
  });
  const metadata = await sharp(outputPath).metadata();
  const pixel = await sharp(outputPath).extract({ left: 400, top: 20, width: 1, height: 1 }).raw().toBuffer();

  assert.equal(metadata.width, 1000);
  assert.equal(metadata.height, 500);
  assert.equal(result.left, 400);
  assert.equal(result.top, 20);
  assert.deepEqual([...pixel.slice(0, 3)], [255, 255, 255]);
});

test('không ghi đè output cũ nếu chưa bật overwrite', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apply-channel-logo-existing-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, 'input.png');
  const logoPath = path.join(directory, 'logo.png');
  const outputPath = path.join(directory, 'output.png');
  const source = sharp({
    create: { width: 100, height: 100, channels: 4, background: '#000000' },
  }).png();
  await source.clone().toFile(inputPath);
  await source.clone().toFile(logoPath);
  await fs.writeFile(outputPath, Buffer.from('đã tồn tại', 'utf8'));

  await assert.rejects(
    applyChannelLogo({ inputPath, logoPath, outputPath }),
    (error) => error instanceof ChannelLogoError && error.code === 'output_exists',
  );
});

test('overwrite thay ảnh cũ nhưng không để lại file backup', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apply-channel-logo-overwrite-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, 'input.png');
  const logoPath = path.join(directory, 'logo.png');
  const outputPath = path.join(directory, 'output.png');
  await sharp({
    create: { width: 200, height: 100, channels: 4, background: '#336699' },
  }).png().toFile(inputPath);
  await sharp({
    create: { width: 40, height: 10, channels: 4, background: '#ffffff' },
  }).png().toFile(logoPath);
  await fs.writeFile(outputPath, Buffer.from('ảnh cũ', 'utf8'));

  await applyChannelLogo({ inputPath, logoPath, outputPath, overwrite: true, shadow: false });

  const metadata = await sharp(outputPath).metadata();
  const files = await fs.readdir(directory);
  assert.equal(metadata.width, 200);
  assert.equal(files.some((file) => file.endsWith('.bak')), false);
});

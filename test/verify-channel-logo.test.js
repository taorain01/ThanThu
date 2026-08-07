'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { applyChannelLogo } = require('../scripts/apply-channel-logo');
const { verifyChannelLogo, parseArgs } = require('../scripts/verify-channel-logo');

/** Logo hai màu giống asset thật của Seomichill: nét trắng + nét hồng, viền trong suốt. */
async function writeTwoToneLogo(logoPath) {
  await sharp({
    create: { width: 600, height: 200, channels: 4, background: '#00000000' },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 400, height: 50, channels: 4, background: '#ffffff' },
        }).png().toBuffer(),
        left: 100,
        top: 30,
      },
      {
        input: await sharp({
          create: { width: 300, height: 40, channels: 4, background: '#f0a8bd' },
        }).png().toBuffer(),
        left: 150,
        top: 110,
      },
    ])
    .png()
    .toFile(logoPath);
}

async function setup(t, prefix, background) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `verify-channel-logo-${prefix}-`));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const barePath = path.join(directory, 'bare.png');
  const logoPath = path.join(directory, 'logo.png');
  await sharp({
    create: { width: 2048, height: 1152, channels: 4, background },
  }).png().toFile(barePath);
  await writeTwoToneLogo(logoPath);
  return { directory, barePath, logoPath };
}

const OPTIONS = { widthPercent: 7, topPercent: 2.2, trimTransparent: true };

test('phát hiện ảnh CHƯA được chèn logo trên nền tối', async (t) => {
  const { barePath, logoPath } = await setup(t, 'missing-dark', '#171220');

  const result = await verifyChannelLogo({ inputPath: barePath, logoPath, ...OPTIONS });

  assert.equal(result.logoPresent, false);
  assert.ok(result.delta < result.minDelta);
});

test('phát hiện ảnh ĐÃ được chèn logo trên nền tối', async (t) => {
  const { directory, barePath, logoPath } = await setup(t, 'present-dark', '#171220');
  const finalPath = path.join(directory, 'final.png');
  await applyChannelLogo({ inputPath: barePath, logoPath, outputPath: finalPath, ...OPTIONS });

  const result = await verifyChannelLogo({ inputPath: finalPath, logoPath, ...OPTIONS });

  assert.equal(result.logoPresent, true);
  assert.ok(result.delta >= result.minDelta, `delta ${result.delta} phải đạt ngưỡng`);
});

/**
 * Nền sáng là ca dễ báo nhầm nhất: logo trắng gần như hoà vào nền nên delta nhỏ.
 * Ảnh chưa chèn vẫn phải FAIL, và ảnh đã chèn vẫn phải PASS nhờ nét hồng tối hơn nền.
 */
test('không báo nhầm trên nền sáng — chưa chèn vẫn FAIL, đã chèn vẫn PASS', async (t) => {
  const { directory, barePath, logoPath } = await setup(t, 'bright', '#c9d8ea');
  const finalPath = path.join(directory, 'final.png');
  await applyChannelLogo({ inputPath: barePath, logoPath, outputPath: finalPath, ...OPTIONS });

  const missing = await verifyChannelLogo({ inputPath: barePath, logoPath, ...OPTIONS });
  const present = await verifyChannelLogo({ inputPath: finalPath, logoPath, ...OPTIONS });

  assert.equal(missing.logoPresent, false);
  assert.equal(present.logoPresent, true);
});

/**
 * Đúng lỗi đã gặp: chữ PLAYLIST khổng lồ trắng trải qua dải top-center. Vùng logo bị
 * phủ trắng đều nên nét logo không còn nổi so với nền quanh nó → phải FAIL, buộc
 * pipeline retry Playlist với chữ hạ xuống dưới vùng logo.
 */
test('FAIL khi chữ PLAYLIST phủ trắng chiếm vùng logo', async (t) => {
  const { directory, barePath, logoPath } = await setup(t, 'playlist-clash', '#171220');
  const clashPath = path.join(directory, 'clash.png');
  await sharp(barePath)
    .composite([{
      input: await sharp({
        create: { width: 1600, height: 220, channels: 4, background: '#ffffff' },
      }).png().toBuffer(),
      left: 224,
      top: 0,
    }])
    .png()
    .toFile(clashPath);

  const result = await verifyChannelLogo({ inputPath: clashPath, logoPath, ...OPTIONS });

  assert.equal(result.logoPresent, false);
});

test('parseArgs đọc đủ tham số và giữ mặc định 7% / 2.2%', () => {
  const parsed = parseArgs(['--input', 'a.png', '--logo', 'b.png', '--trim-transparent']);

  assert.equal(parsed.inputPath, 'a.png');
  assert.equal(parsed.logoPath, 'b.png');
  assert.equal(parsed.trimTransparent, true);
  assert.equal(parsed.widthPercent, 7);
  assert.equal(parsed.topPercent, 2.2);
});

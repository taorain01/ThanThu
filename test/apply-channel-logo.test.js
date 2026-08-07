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

/**
 * Logo test phải có viền trong suốt quanh nét, giống asset thật (~14% pixel
 * opaque). Hình chữ nhật đặc kín khung sẽ tự che hết halo của chính nó nên
 * không đo được gì.
 */
async function writeSparseLogo(logoPath) {
  await sharp({
    create: { width: 400, height: 120, channels: 4, background: '#00000000' },
  })
    .composite([{
      input: await sharp({
        create: { width: 200, height: 40, channels: 4, background: '#ffffff' },
      }).png().toBuffer(),
      left: 100,
      top: 40,
    }])
    .png()
    .toFile(logoPath);
}

test('bóng chỉ là halo mềm đối xứng, không tạo vệt đen đậm lệch hướng', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apply-channel-logo-shadow-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, 'input.png');
  const logoPath = path.join(directory, 'logo.png');
  const outputPath = path.join(directory, 'output.png');
  // Nền sáng đều: mọi thay đổi độ sáng quanh logo đều là do halo, không do ảnh.
  await sharp({
    create: { width: 800, height: 600, channels: 4, background: '#d8e6f2' },
  }).png().toFile(inputPath);
  await writeSparseLogo(logoPath);

  // topPercent đủ lớn để vùng đo không tràn mép trên ảnh.
  const result = await applyChannelLogo({
    inputPath,
    logoPath,
    outputPath,
    widthPercent: 20,
    topPercent: 15,
    shadowStrength: 5,
    overwrite: true,
  });

  const pad = Math.round(result.height * 0.8);
  const box = {
    left: result.left - pad,
    top: result.top - pad,
    width: result.width + pad * 2,
    height: result.height + pad * 2,
  };
  const before = await sharp(inputPath).ensureAlpha().extract(box).raw().toBuffer();
  const after = await sharp(outputPath).ensureAlpha().extract(box).raw().toBuffer();
  const luminance = (buffer, i) => 0.2126 * buffer[i] + 0.7152 * buffer[i + 1] + 0.0722 * buffer[i + 2];

  let heavy = 0;
  let above = 0;
  let below = 0;
  for (let y = 0; y < box.height; y += 1) {
    for (let x = 0; x < box.width; x += 1) {
      const i = (y * box.width + x) * 4;
      const drop = Math.max(0, luminance(before, i) - luminance(after, i));
      // Bỏ qua chính vùng logo: ở đó pixel sáng lên (logo trắng), không tối đi.
      if (drop > 60) heavy += 1;
      if (y < box.height / 2) above += drop;
      else below += drop;
    }
  }

  // Ngay ở strength tối đa cũng không được có pixel nào tối đi quá 60/255 —
  // đó là ngưỡng mà halo đọc ra thành khối đen bám dưới chữ.
  assert.equal(heavy, 0);
  // Halo bao quanh đều: tổng độ tối nửa trên và nửa dưới phải xấp xỉ nhau.
  // Drop-shadow lệch xuống (bug cũ) đẩy tỉ lệ này lệch hẳn khỏi 1.
  const ratio = above / below;
  assert.ok(ratio > 0.7 && ratio < 1.4, `halo lệch hướng: trên/dưới = ${ratio.toFixed(2)}`);
});

test('shadowStrength nhỏ cho halo nhạt hơn strength lớn', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apply-channel-logo-strength-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, 'input.png');
  const logoPath = path.join(directory, 'logo.png');
  await sharp({
    create: { width: 800, height: 600, channels: 4, background: '#d8e6f2' },
  }).png().toFile(inputPath);
  await writeSparseLogo(logoPath);

  const darkness = async (strength) => {
    const outputPath = path.join(directory, `output-${strength}.png`);
    const result = await applyChannelLogo({
      inputPath,
      logoPath,
      outputPath,
      widthPercent: 20,
      topPercent: 15,
      shadowStrength: strength,
      overwrite: true,
    });
    const pad = Math.round(result.height * 0.8);
    const box = {
      left: result.left - pad,
      top: result.top - pad,
      width: result.width + pad * 2,
      height: result.height + pad * 2,
    };
    const before = await sharp(inputPath).ensureAlpha().extract(box).raw().toBuffer();
    const after = await sharp(outputPath).ensureAlpha().extract(box).raw().toBuffer();
    let total = 0;
    for (let i = 0; i < after.length; i += 4) {
      const beforeLuminance = 0.2126 * before[i] + 0.7152 * before[i + 1] + 0.0722 * before[i + 2];
      const afterLuminance = 0.2126 * after[i] + 0.7152 * after[i + 1] + 0.0722 * after[i + 2];
      total += Math.max(0, beforeLuminance - afterLuminance);
    }
    return total;
  };

  const light = await darkness(1);
  const heavy = await darkness(4);
  assert.ok(light < heavy, `strength 1 (${light.toFixed(0)}) phải nhạt hơn strength 4 (${heavy.toFixed(0)})`);
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

/**
 * Asset logo thật của kênh Seomichill là canvas vuông 1254x1254 nhưng wordmark chỉ
 * chiếm 1023x719 ở giữa — phần còn lại trong suốt. Không trim thì `--width-percent 7`
 * áp lên cả canvas, wordmark thực chỉ ra 5.76% và bị đẩy xuống 4.5% mép trên thay vì
 * 2.2%: logo nhìn nhỏ và lệch hẳn so với kênh có asset khít.
 */
async function writePaddedLogo(logoPath, canvas, content) {
  await sharp({
    create: { width: canvas, height: canvas, channels: 4, background: '#00000000' },
  })
    .composite([{
      input: await sharp({
        create: { width: content.width, height: content.height, channels: 4, background: '#ffffff' },
      }).png().toBuffer(),
      left: Math.round((canvas - content.width) / 2),
      top: Math.round((canvas - content.height) / 2),
    }])
    .png()
    .toFile(logoPath);
}

test('trimTransparent tính width/top theo wordmark thực, không theo canvas có padding', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apply-channel-logo-trim-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, 'input.png');
  const logoPath = path.join(directory, 'logo.png');
  await sharp({
    create: { width: 2048, height: 1152, channels: 4, background: '#171220' },
  }).png().toFile(inputPath);
  await writePaddedLogo(logoPath, 1000, { width: 800, height: 400 });

  const measureWordmark = async (outputPath) => {
    const { data, info } = await sharp(outputPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let minX = info.width;
    let maxX = -1;
    let minY = info.height;
    for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
      if (data[pixel * info.channels] <= 90) continue;
      const x = pixel % info.width;
      const y = Math.floor(pixel / info.width);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
    }
    return { width: maxX - minX + 1, top: minY };
  };

  const withoutTrim = path.join(directory, 'without-trim.png');
  const withTrim = path.join(directory, 'with-trim.png');
  const shared = { inputPath, logoPath, widthPercent: 7, topPercent: 2.2, shadow: false };
  await applyChannelLogo({ ...shared, outputPath: withoutTrim });
  await applyChannelLogo({ ...shared, outputPath: withTrim, trimTransparent: true });

  const plain = await measureWordmark(withoutTrim);
  const trimmed = await measureWordmark(withTrim);
  const expectedWidth = Math.round(2048 * 0.07);
  const expectedTop = Math.round(1152 * 0.022);

  // Không trim: wordmark hụt và bị đẩy xuống — đúng lỗi đã gặp trên Seomichill.
  assert.ok(plain.width < expectedWidth - 10, `không trim phải hụt bề rộng, đo ${plain.width}`);
  assert.ok(plain.top > expectedTop + 10, `không trim phải bị đẩy xuống, đo y=${plain.top}`);
  // Có trim: đúng cả bề rộng và mép trên đã yêu cầu.
  assert.ok(Math.abs(trimmed.width - expectedWidth) <= 2, `trim phải đạt ${expectedWidth}px, đo ${trimmed.width}`);
  assert.ok(Math.abs(trimmed.top - expectedTop) <= 2, `trim phải đặt tại y=${expectedTop}, đo ${trimmed.top}`);
});

test('trimTransparent không đổi kết quả với asset đã khít wordmark', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apply-channel-logo-trim-tight-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, 'input.png');
  const logoPath = path.join(directory, 'logo.png');
  await sharp({
    create: { width: 1000, height: 500, channels: 4, background: '#222222' },
  }).png().toFile(inputPath);
  await sharp({
    create: { width: 400, height: 100, channels: 4, background: '#ffffff' },
  }).png().toFile(logoPath);

  const shared = { inputPath, logoPath, widthPercent: 20, topPercent: 4, shadow: false };
  const plain = await applyChannelLogo({ ...shared, outputPath: path.join(directory, 'a.png') });
  const trimmed = await applyChannelLogo({
    ...shared,
    outputPath: path.join(directory, 'b.png'),
    trimTransparent: true,
  });

  assert.equal(trimmed.logoContentBox, null);
  assert.deepEqual(
    [trimmed.left, trimmed.top, trimmed.width, trimmed.height],
    [plain.left, plain.top, plain.width, plain.height],
  );
});

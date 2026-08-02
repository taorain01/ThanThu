'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const DEFAULT_WIDTH_PERCENT = 14;
const DEFAULT_TOP_PERCENT = 2.2;
const DEFAULT_SHADOW_STRENGTH = 2;
const MIN_LOGO_CONTRAST = 3;

class ChannelLogoError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ChannelLogoError';
    this.code = code;
  }
}

function takeValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new ChannelLogoError('missing_argument', `Thiếu giá trị cho ${name}.`);
  }
  return value;
}

function parsePercent(value, name, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new ChannelLogoError(
      'invalid_percent',
      `${name} phải nằm trong khoảng ${minimum}–${maximum}.`,
    );
  }
  return number;
}

/** Hệ số nhân alpha cho lớp shadow: càng lớn shadow càng đậm. */
function parseShadowStrength(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0.5 || number > 5) {
    throw new ChannelLogoError(
      'invalid_shadow_strength',
      '--shadow-strength phải nằm trong khoảng 0.5–5.',
    );
  }
  return number;
}

function relativeLuminance({ r, g, b }) {
  const linear = (channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Màu trung bình (theo alpha) của một vùng ảnh. */
async function regionAverageColor(filePath, region) {
  const { data } = await sharp(filePath)
    .ensureAlpha()
    .extract(region)
    .resize({ width: 16, height: 16, fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) continue;
    r += data[i] * a;
    g += data[i + 1] * a;
    b += data[i + 2] * a;
    weight += a;
  }
  if (weight === 0) {
    return { r: 255, g: 255, b: 255 };
  }
  return { r: r / weight, g: g / weight, b: b / weight };
}

function parseArgs(argv) {
  const result = {
    widthPercent: DEFAULT_WIDTH_PERCENT,
    topPercent: DEFAULT_TOP_PERCENT,
    shadow: true,
    shadowStrength: DEFAULT_SHADOW_STRENGTH,
    dryRun: false,
    overwrite: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') {
      result.inputPath = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === '--logo') {
      result.logoPath = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === '--output') {
      result.outputPath = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === '--width-percent') {
      result.widthPercent = parsePercent(takeValue(argv, index, arg), arg, 4, 40);
      index += 1;
    } else if (arg === '--top-percent') {
      result.topPercent = parsePercent(takeValue(argv, index, arg), arg, 0, 20);
      index += 1;
    } else if (arg === '--shadow-strength') {
      result.shadowStrength = parseShadowStrength(takeValue(argv, index, arg));
      index += 1;
    } else if (arg === '--no-shadow') {
      result.shadow = false;
    } else if (arg === '--overwrite') {
      result.overwrite = true;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else {
      throw new ChannelLogoError('invalid_argument', `Tham số không hợp lệ: ${arg}`);
    }
  }
  return result;
}

async function resolveInputFile(filePath, name) {
  if (!filePath) {
    throw new ChannelLogoError('missing_path', `Thiếu đường dẫn ${name}.`);
  }
  let resolved;
  try {
    resolved = await fs.realpath(path.resolve(filePath));
  } catch {
    throw new ChannelLogoError('file_not_found', `Không tìm thấy ${name}: ${filePath}`);
  }
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) {
    throw new ChannelLogoError('not_a_file', `${name} không phải file: ${filePath}`);
  }
  return resolved;
}

async function planChannelLogo(options = {}) {
  const inputPath = await resolveInputFile(options.inputPath, 'ảnh nguồn');
  const logoPath = await resolveInputFile(options.logoPath, 'logo');
  const widthPercent = parsePercent(
    options.widthPercent ?? DEFAULT_WIDTH_PERCENT,
    'widthPercent',
    4,
    40,
  );
  const topPercent = parsePercent(
    options.topPercent ?? DEFAULT_TOP_PERCENT,
    'topPercent',
    0,
    20,
  );
  const inputMetadata = await sharp(inputPath).metadata();
  const logoMetadata = await sharp(logoPath).metadata();
  if (!inputMetadata.width || !inputMetadata.height || !logoMetadata.width || !logoMetadata.height) {
    throw new ChannelLogoError('invalid_image', 'Không đọc được kích thước ảnh nguồn hoặc logo.');
  }

  const width = Math.max(1, Math.round(inputMetadata.width * widthPercent / 100));
  const height = Math.max(1, Math.round(width * logoMetadata.height / logoMetadata.width));
  const left = Math.max(0, Math.round((inputMetadata.width - width) / 2));
  const top = Math.max(0, Math.round(inputMetadata.height * topPercent / 100));
  if (left + width > inputMetadata.width || top + height > inputMetadata.height) {
    throw new ChannelLogoError('logo_out_of_bounds', 'Logo vượt ra ngoài khung ảnh nguồn.');
  }

  // Ước lượng tương phản logo trắng trên nền thực tế của vùng đặt logo (trước khi chèn).
  const logoZoneColor = await regionAverageColor(inputPath, {
    left,
    top,
    width,
    height,
  });
  const contrastEstimate = contrastRatio({ r: 255, g: 255, b: 255 }, logoZoneColor);

  return {
    inputPath,
    logoPath,
    width,
    height,
    left,
    top,
    canvasWidth: inputMetadata.width,
    canvasHeight: inputMetadata.height,
    logoZoneColor,
    contrastEstimate,
  };
}

/**
 * Tạo lớp bóng đổ cho logo. Asset logo có nét rất mảnh (chỉ ~14% pixel opaque);
 * sau resize xuống 7% chiều rộng, nét còn ~8% opaque và blur lớn sẽ bào mòn
 * lõi tới mức bóng gần như vô hình. Vì vậy: blur giữ ở mức nhỏ để lõi còn
 * nguyên, rồi nhân alpha rất mạnh (clamp 255) để bóng đậm đặc phía dưới logo.
 * Lưu ý: sharp `.tint()` giữ luminance nên không dùng được để tạo bóng đen —
 * phải set kênh RGB về 0 trực tiếp trên raw data.
 * strength 0.5–5, mặc định 2.
 */
async function buildShadow(logoBuffer, canvasWidth, canvasHeight, strength) {
  const blur = Math.max(1.2, canvasWidth / 2000 * strength);
  const { data, info } = await sharp(logoBuffer)
    .ensureAlpha()
    .blur(blur)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alphaScale = 2 + strength * 1.5;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
    data[i + 3] = Math.min(255, Math.round(data[i + 3] * alphaScale));
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

async function applyChannelLogo(options = {}) {
  const plan = await planChannelLogo(options);
  if (!options.outputPath) {
    throw new ChannelLogoError('missing_path', 'Thiếu đường dẫn ảnh output.');
  }
  const outputPath = path.resolve(options.outputPath);
  if (path.extname(outputPath).toLowerCase() !== '.png') {
    throw new ChannelLogoError('invalid_output', 'Ảnh output bắt buộc dùng định dạng PNG.');
  }
  if (!options.overwrite) {
    try {
      await fs.access(outputPath);
      throw new ChannelLogoError('output_exists', `File output đã tồn tại: ${outputPath}`);
    } catch (error) {
      if (error instanceof ChannelLogoError) {
        throw error;
      }
    }
  }
  if (options.dryRun) {
    return {
      dryRun: true,
      outputPath,
      shadowStrength: options.shadow === false ? 0 : parseShadowStrength(String(options.shadowStrength ?? DEFAULT_SHADOW_STRENGTH)),
      minContrast: MIN_LOGO_CONTRAST,
      ...plan,
    };
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const logo = await sharp(plan.logoPath)
    .resize({ width: plan.width, height: plan.height, fit: 'fill' })
    .png()
    .toBuffer();
  const composites = [];
  if (options.shadow !== false) {
    const strength = parseShadowStrength(
      options.shadowStrength === undefined ? DEFAULT_SHADOW_STRENGTH : String(options.shadowStrength),
    );
    const shadow = await buildShadow(logo, plan.canvasWidth, plan.canvasHeight, strength);
    composites.push({
      input: shadow,
      left: plan.left,
      top: Math.min(plan.canvasHeight - plan.height, plan.top + Math.max(2, Math.round(plan.canvasHeight / 320 * strength))),
      blend: 'over',
    });
  }
  composites.push({ input: logo, left: plan.left, top: plan.top, blend: 'over' });

  const temporaryPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath, '.png')}.${process.pid}.${Date.now()}.tmp.png`,
  );
  const backupPath = `${outputPath}.${process.pid}.${Date.now()}.bak`;
  let movedOriginal = false;
  try {
    await sharp(plan.inputPath).composite(composites).png().toFile(temporaryPath);
    if (options.overwrite) {
      try {
        await fs.rename(outputPath, backupPath);
        movedOriginal = true;
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
    }
    await fs.rename(temporaryPath, outputPath);
    if (movedOriginal) {
      await fs.rm(backupPath, { force: true });
    }
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    if (movedOriginal) {
      await fs.rename(backupPath, outputPath).catch(() => {});
    }
    throw error;
  }

  return {
    dryRun: false,
    outputPath,
    shadowStrength: options.shadow === false ? 0 : parseShadowStrength(String(options.shadowStrength ?? DEFAULT_SHADOW_STRENGTH)),
    minContrast: MIN_LOGO_CONTRAST,
    ...plan,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await applyChannelLogo(options);
  process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error instanceof ChannelLogoError ? error.code : 'apply_logo_failed',
      message: error.message,
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  ChannelLogoError,
  applyChannelLogo,
  buildShadow,
  parseArgs,
  planChannelLogo,
};

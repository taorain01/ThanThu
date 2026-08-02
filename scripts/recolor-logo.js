'use strict';

/**
 * Đổi màu logo kênh theo background (hoặc theo màu ép cụ thể).
 * Giữ nguyên hình dạng/alpha của logo, chỉ nhuộm lại màu pixel.
 *
 * Cách dùng:
 *   node recolor-logo.js --logo "<logo.png>" --background "<background.png>" --output "<logo-recolored.png>"
 *   node recolor-logo.js --logo "<logo.png>" --background "<background.png>" --output "<out.png>" --mode white
 *   node recolor-logo.js --logo "<logo.png>" --background "<bg.png>" --output "<out.png>" --color "#FF69B4"
 *   node recolor-logo.js --logo "<logo.png>" --background "<bg.png>" --output "<out.png>" --mode keep --dry-run
 *
 * Modes:
 *   auto (mặc định): phân tích màu chủ đạo + độ sáng background.
 *     - Nền tối -> logo trắng.
 *     - Nền sáng -> logo dùng màu chủ đạo của nền nhưng tối hóa đủ tương phản
 *       (fallback đen nếu vẫn thiếu tương phản).
 *   white: luôn nhuộm trắng.
 *   dark: luôn nhuộm đen.
 *   keep: giữ nguyên màu gốc của logo (chỉ dùng để chuẩn bị/dry-run).
 *
 * Tùy chọn:
 *   --color <hex>  Ép màu cụ thể, bỏ qua phân tích background.
 *   --dry-run      Chỉ in kế hoạch màu, không ghi file.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

class RecolorLogoError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RecolorLogoError';
    this.code = code;
  }
}

function takeValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new RecolorLogoError('missing_argument', `Thiếu giá trị cho ${name}.`);
  }
  return value;
}

function parseHex(value, name) {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
  if (!match) {
    throw new RecolorLogoError('invalid_color', `${name} phải là mã hex 6 ký tự (ví dụ #FF69B4).`);
  }
  const hex = match[1];
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function parseArgs(argv) {
  const result = { mode: 'auto' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--logo') {
      result.logoPath = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === '--background') {
      result.backgroundPath = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === '--output') {
      result.outputPath = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === '--mode') {
      result.mode = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === '--color') {
      result.color = parseHex(takeValue(argv, index, arg), arg);
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else {
      throw new RecolorLogoError('invalid_argument', `Tham số không hợp lệ: ${arg}`);
    }
  }
  return result;
}

function luminance({ r, g, b }) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
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

function darken(color, factor) {
  return {
    r: Math.round(color.r * factor),
    g: Math.round(color.g * factor),
    b: Math.round(color.b * factor),
  };
}

function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hexString(color) {
  const toHex = (v) => clampChannel(v).toString(16).padStart(2, '0');
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

/**
 * Lấy màu chủ đạo của background: resize nhỏ, đọc RGBA,
 * tính trung bình có trọng số theo alpha (giữ mảng chính giữa nơi logo đặt).
 */
async function dominantColor(imageBuffer) {
  const { data, info } = await sharp(imageBuffer)
    .resize({ width: 16, height: 16, fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const pixels = [];
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) continue;
    pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2], a });
  }
  if (pixels.length === 0) {
    return { r: 255, g: 255, b: 255 };
  }

  // Vùng trung tâm (nơi logo nằm) nặng hơn vùng biên.
  let totalWeight = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const a = data[i + 3];
      if (a === 0) continue;
      const centerBias = 0.5 + 0.5 * Math.exp(-(((x - width / 2) / (width / 4)) ** 2 + ((y - height / 2) / (height / 4)) ** 2));
      const weight = (a / 255) * centerBias;
      totalWeight += weight;
      r += data[i] * weight;
      g += data[i + 1] * weight;
      b += data[i + 2] * weight;
    }
  }
  if (totalWeight === 0) {
    return { r: 255, g: 255, b: 255 };
  }
  return { r: r / totalWeight, g: g / totalWeight, b: b / totalWeight };
}

async function planRecolor(options = {}) {
  if (!options.logoPath) {
    throw new RecolorLogoError('missing_path', 'Thiếu đường dẫn --logo.');
  }
  const logoPath = await resolveFile(options.logoPath, 'logo');
  const logoMeta = await sharp(logoPath).metadata();
  if (!logoMeta.width || !logoMeta.height) {
    throw new RecolorLogoError('invalid_logo', 'Không đọc được kích thước logo.');
  }

  // Nếu logo không có alpha, tách nền tự động bằng màu trung bình của viền.
  const needsBgRemoval = typeof logoMeta.alpha === 'undefined' || logoMeta.alpha === false;

  const backgroundPath = options.backgroundPath
    ? await resolveFile(options.backgroundPath, 'background')
    : null;

  let backgroundDominant = null;
  if (backgroundPath && options.mode === 'auto' && !options.color) {
    backgroundDominant = await dominantColor(await fs.readFile(backgroundPath));
  }

  const mode = options.mode || 'auto';
  let targetColor;
  let reason;

  if (options.color) {
    targetColor = options.color;
    reason = `ép màu ${hexString(options.color)}`;
  } else if (mode === 'white') {
    targetColor = { r: 255, g: 255, b: 255 };
    reason = 'mode white';
  } else if (mode === 'dark') {
    targetColor = { r: 0, g: 0, b: 0 };
    reason = 'mode dark';
  } else if (mode === 'keep') {
    targetColor = null;
    reason = 'mode keep (giữ màu gốc)';
  } else if (mode === 'auto') {
    if (!backgroundDominant) {
      throw new RecolorLogoError('missing_background', 'Mode auto cần --background để phân tích màu.');
    }
    const lum = luminance(backgroundDominant);
    if (lum < 0.45) {
      targetColor = { r: 255, g: 255, b: 255 };
      reason = `nền tối (lum ${lum.toFixed(2)}) -> logo trắng`;
    } else {
      // Nền sáng: tối hóa màu chủ đạo tới khi đạt tỷ lệ tương phản >= 3:1 so với nền.
      let candidate = darken(backgroundDominant, 0.55);
      if (contrastRatio(candidate, backgroundDominant) < 3) {
        candidate = darken(backgroundDominant, 0.35);
      }
      if (contrastRatio(candidate, backgroundDominant) < 3) {
        candidate = { r: 0, g: 0, b: 0 };
        reason = `nền sáng (lum ${lum.toFixed(2)}) -> màu chủ đạo tối hóa, fallback đen`;
      } else {
        reason = `nền sáng (lum ${lum.toFixed(2)}) -> màu chủ đạo tối hóa ${hexString(candidate)}`;
      }
      targetColor = candidate;
    }
  } else {
    throw new RecolorLogoError('invalid_mode', `Mode không hợp lệ: ${mode}. Dùng auto|white|dark|keep.`);
  }

  return {
    logoPath,
    backgroundPath,
    mode,
    targetColor,
    reason,
    needsBgRemoval,
    dryRun: Boolean(options.dryRun),
  };
}

/** Ước lượng màu nền từ viền ảnh (giả định nền đồng nhất ở biên). */
async function estimateBorderColor(imageBuffer) {
  const { data, info } = await sharp(imageBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const step = 20;
  for (let x = 0; x < width; x += step) {
    for (let y = 0; y < height; y += step) {
      if (x < 4 || y < 4 || x > width - 5 || y > height - 5) {
        const i = (y * width + x) * 4;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n += 1;
      }
    }
  }
  if (n === 0) {
    return { r: 255, g: 255, b: 255 };
  }
  return { r: r / n, g: g / n, b: b / n };
}

/** Tách nền: pixel gần màu nền -> trong suốt, xa -> giữ màu, giữa -> mờ dần. */
async function removeBackground(logoPath, borderColor) {
  const { data, info } = await sharp(logoPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const out = Buffer.from(data);
  const SOFT_START = 90;
  const SOFT_END = 150;
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - borderColor.r;
    const dg = data[i + 1] - borderColor.g;
    const db = data[i + 2] - borderColor.b;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    let alpha = 0;
    if (dist >= SOFT_END) {
      alpha = 255;
    } else if (dist > SOFT_START) {
      alpha = Math.round(((dist - SOFT_START) / (SOFT_END - SOFT_START)) * 255);
    }
    out[i + 3] = alpha;
  }
  return sharp(out, { raw: { width, height, channels: 4 } });
}

async function resolveFile(filePath, name) {
  let resolved;
  try {
    resolved = await fs.realpath(path.resolve(filePath));
  } catch {
    throw new RecolorLogoError('file_not_found', `Không tìm thấy ${name}: ${filePath}`);
  }
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) {
    throw new RecolorLogoError('not_a_file', `${name} không phải file: ${filePath}`);
  }
  return resolved;
}

async function recolorLogo(options = {}) {
  const plan = await planRecolor(options);
  if (!options.outputPath) {
    throw new RecolorLogoError('missing_path', 'Thiếu đường dẫn --output.');
  }
  const outputPath = path.resolve(options.outputPath);
  if (path.extname(outputPath).toLowerCase() !== '.png') {
    throw new RecolorLogoError('invalid_output', 'Ảnh output bắt buộc dùng định dạng PNG.');
  }
  if (plan.dryRun) {
    return { dryRun: true, outputPath, ...plan };
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  let pipeline = sharp(plan.logoPath);
  if (plan.needsBgRemoval) {
    const borderColor = await estimateBorderColor(await fs.readFile(plan.logoPath));
    pipeline = await removeBackground(plan.logoPath, borderColor);
  }
  if (plan.targetColor) {
    pipeline = pipeline.tint({ r: plan.targetColor.r, g: plan.targetColor.g, b: plan.targetColor.b });
  }
  const temporaryPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath, '.png')}.${process.pid}.${Date.now()}.tmp.png`,
  );
  try {
    await pipeline.png().toFile(temporaryPath);
    await fs.rename(temporaryPath, outputPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }

  return { dryRun: false, outputPath, ...plan };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await recolorLogo(options);
  process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error instanceof RecolorLogoError ? error.code : 'recolor_logo_failed',
      message: error.message,
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  RecolorLogoError,
  dominantColor,
  estimateBorderColor,
  removeBackground,
  luminance,
  contrastRatio,
  parseArgs,
  planRecolor,
  recolorLogo,
};

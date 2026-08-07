'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const DEFAULT_WIDTH_PERCENT = 14;
const DEFAULT_TOP_PERCENT = 2.2;
const DEFAULT_SHADOW_STRENGTH = 2;
const MIN_LOGO_CONTRAST = 3;
/**
 * Trần alpha tuyệt đối của halo. 64/255 trên nền sáng (luminance ~226) chỉ làm
 * nền tối đi ~57 — nằm dưới ngưỡng 60 mà halo bắt đầu đọc ra thành khối đen,
 * kể cả với logo có nét đặc (halo sát mép nét đạt gần trần).
 */
const MAX_SHADOW_ALPHA = 64;
/** Alpha trần cho mỗi nấc strength: strength 2 (mặc định) → 48; từ strength ~2.7 chạm trần. */
const SHADOW_ALPHA_PER_STRENGTH = 24;
/** Bán kính blur theo CHIỀU CAO LOGO cho mỗi nấc strength: strength 2 → 14% chiều cao logo. */
const SHADOW_BLUR_PER_STRENGTH = 0.07;
/** Gamma < 1 trên alpha logo: nét mảnh sau resize bị loãng alpha, boost cho đặc lại. */
const LOGO_ALPHA_GAMMA = 0.65;
/**
 * Alpha tối thiểu để một pixel được tính là "nội dung logo" khi đo bounding box.
 * Ngưỡng > 0 để bỏ qua rìa antialiasing gần như vô hình của asset xuất từ Photoshop.
 */
const LOGO_CONTENT_ALPHA_THRESHOLD = 20;

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
    trimTransparent: false,
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
    } else if (arg === '--trim-transparent') {
      result.trimTransparent = true;
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

/**
 * Đo bounding box của phần thực sự nhìn thấy được (alpha > ngưỡng) trong asset logo.
 *
 * Asset logo không phải lúc nào cũng khít wordmark: `seomichill-logo-white.png` là
 * canvas vuông 1254x1254 nhưng wordmark chỉ chiếm 1023x719 ở giữa, phần còn lại là
 * viền trong suốt. Nếu resize cả canvas về `--width-percent 7` thì wordmark thực chỉ
 * ra 81.6% của 7% (118px thay vì 143px) và bị đẩy xuống dưới `--top-percent` đã yêu
 * cầu (y=52 thay vì y=25) — logo trông nhỏ và lệch so với kênh có asset khít.
 *
 * Trả `null` khi asset đã khít (không có padding đáng kể) để giữ nguyên hành vi cũ.
 */
async function measureLogoContentBox(logoPath) {
  const { data, info } = await sharp(logoPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let maxX = -1;
  let minY = info.height;
  let maxY = -1;
  for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
    if (data[pixel * 4 + 3] <= LOGO_CONTENT_ALPHA_THRESHOLD) continue;
    const x = pixel % info.width;
    const y = Math.floor(pixel / info.width);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (maxX < 0) {
    throw new ChannelLogoError('logo_fully_transparent', 'Logo không có pixel nào nhìn thấy được.');
  }
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    canvasWidth: info.width,
    canvasHeight: info.height,
  };
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

  // `--trim-transparent`: đo wordmark thực rồi tính tỉ lệ trên nó, để `--width-percent`
  // và `--top-percent` luôn nói về phần logo nhìn thấy được — không phụ thuộc vào việc
  // asset có padding trong suốt hay không.
  let contentBox = null;
  if (options.trimTransparent) {
    const measured = await measureLogoContentBox(logoPath);
    const hasPadding = measured.width < measured.canvasWidth || measured.height < measured.canvasHeight;
    contentBox = hasPadding ? measured : null;
  }
  const sourceWidth = contentBox ? contentBox.width : logoMetadata.width;
  const sourceHeight = contentBox ? contentBox.height : logoMetadata.height;

  const width = Math.max(1, Math.round(inputMetadata.width * widthPercent / 100));
  const height = Math.max(1, Math.round(width * sourceHeight / sourceWidth));
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
    logoContentBox: contentBox,
    logoZoneColor,
    contrastEstimate,
  };
}

/**
 * Resize logo về đúng kích thước rồi boost alpha bằng gamma. Asset gốc 992x294 chỉ
 * có ~14% pixel opaque (nét serif rất mảnh); resize xuống 117px rộng làm alpha bị
 * trung bình hoá, nét mỏng còn alpha thấp nên logo trắng đọc ra xám nhạt. Gamma
 * < 1 kéo alpha trung gian lên cao, giữ nét trắng đặc mà không phá antialiasing.
 *
 * `contentBox` (từ `planChannelLogo` khi bật `--trim-transparent`) cắt bỏ viền trong
 * suốt trước khi resize, để wordmark thực đạt đúng `--width-percent` yêu cầu.
 */
async function buildLogo(logoPath, width, height, contentBox) {
  const pipeline = sharp(logoPath).ensureAlpha();
  if (contentBox) {
    pipeline.extract({
      left: contentBox.left,
      top: contentBox.top,
      width: contentBox.width,
      height: contentBox.height,
    });
  }
  const { data, info } = await pipeline
    .resize({ width, height, fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha === 0 || alpha === 255) continue;
    data[i + 3] = Math.min(255, Math.round(255 * (alpha / 255) ** LOGO_ALPHA_GAMMA));
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

/**
 * Tạo halo tối MỀM, ĐỐI XỨNG quanh logo — không phải drop-shadow lệch hướng.
 *
 * Bản trước blur theo `canvasWidth` (2048/2000*2 ≈ 2px) trong khi logo chỉ cao
 * 42px, nên halo quá chật: alpha dồn vào sát nét chữ rồi clamp 130 → đọc ra
 * viền đen cứng. Cộng thêm offset lệch xuống, kết quả là vệt đen đổ bóng đậm
 * bám dưới-phải wordmark (đo được 2.6% pixel bị tối >60 so với nền gốc).
 *
 * Nay: blur tỉ lệ theo `logoHeight` để halo luôn loang đúng tỉ lệ nét chữ ở mọi
 * kích thước logo, alpha trần thấp (strength 2 → 70) và KHÔNG offset — halo bao
 * quanh đều nên nó tách logo khỏi nền sáng mà không tự đọc ra như một cái bóng.
 * Đo lại trên cùng vùng: max độ tối 35 (trước: 65), 0% pixel tối >60.
 *
 * Lưu ý: sharp `.tint()` giữ luminance nên không dùng được để tạo halo tối —
 * phải set kênh RGB về 0 trực tiếp trên raw data.
 *
 * `logoHeight` cho phép bỏ qua khi gọi kiểu cũ (suy ra từ chính buffer).
 * strength 0.5–5, mặc định 2.
 */
async function buildShadow(logoBuffer, canvasWidth, canvasHeight, strength, logoHeight) {
  const source = sharp(logoBuffer).ensureAlpha();
  const height = logoHeight || (await source.metadata()).height || canvasHeight;
  const blur = Math.max(0.8, height * SHADOW_BLUR_PER_STRENGTH * strength);
  const { data, info } = await sharp(logoBuffer)
    .ensureAlpha()
    .blur(blur)
    .raw()
    .toBuffer({ resolveWithObject: true });
  // Trần alpha co theo strength thay vì cố định: strength nhỏ phải ra halo nhạt
  // thật, không phải cùng một trần với strength lớn.
  const alphaCeiling = Math.min(MAX_SHADOW_ALPHA, Math.round(SHADOW_ALPHA_PER_STRENGTH * strength));
  // Blur làm alpha đỉnh sụt (nét mảnh, ~14% pixel opaque); bù lại vừa đủ để halo
  // đạt trần ở lõi rồi tắt dần ra ngoài.
  const alphaScale = 1.7;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
    data[i + 3] = Math.min(alphaCeiling, Math.round(data[i + 3] * alphaScale));
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
  const logo = await buildLogo(plan.logoPath, plan.width, plan.height, plan.logoContentBox);
  const composites = [];
  if (options.shadow !== false) {
    const strength = parseShadowStrength(
      options.shadowStrength === undefined ? DEFAULT_SHADOW_STRENGTH : String(options.shadowStrength),
    );
    const shadow = await buildShadow(logo, plan.canvasWidth, plan.canvasHeight, strength, plan.height);
    // KHÔNG offset: halo phải bao quanh đều để chỉ làm nhiệm vụ tách logo khỏi
    // nền sáng. Mọi offset (dù 1px) biến nó thành drop-shadow lệch hướng — đúng
    // cái vệt đen đậm cần bỏ.
    composites.push({
      input: shadow,
      left: plan.left,
      top: plan.top,
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
  buildLogo,
  buildShadow,
  measureLogoContentBox,
  parseArgs,
  planChannelLogo,
};

'use strict';

/**
 * Kiểm tra một ảnh final ĐÃ THỰC SỰ được chèn logo kênh hay chưa.
 *
 * Lý do tồn tại: trong workflow tạo cặp Background + Playlist, Playlist được tạo bằng
 * Edit từ Background master (bản chưa có logo). Bước chèn logo cho Playlist là một lệnh
 * riêng, nên rất dễ bị bỏ sót — kết quả là Background có logo còn Playlist thì không, và
 * không có gì trong pipeline phát hiện ra. Script này là cửa chặn deterministic: chạy nó
 * trên cả hai final trước khi giao hàng.
 *
 * Cách đo: dựng lại logo ở đúng vị trí/kích thước mà `apply-channel-logo.js` sẽ dùng
 * (chia sẻ cùng `planChannelLogo` nên không lệch tham số), lấy alpha của logo làm mask,
 * rồi so độ sáng trung bình của pixel TRONG mask với pixel NGOÀI mask trong cùng vùng
 * logo. Logo đã chèn → nét logo sáng hơn hẳn nền quanh nó. Chưa chèn → hai giá trị xấp
 * xỉ nhau vì cả hai đều chỉ là nền.
 *
 * Ngưỡng dùng hiệu độ sáng thay vì so pixel tuyệt đối để không phụ thuộc vào việc nền
 * sáng hay tối, và vẫn đúng với logo hai màu (ví dụ Seomichill: chữ script hồng + chữ
 * trắng — cả hai đều sáng hơn nền tối của kênh).
 *
 * Dùng:
 *   node verify-channel-logo.js --input "<final.png>" --logo "<logo.png>" \
 *     [--width-percent 7] [--top-percent 2.2] [--trim-transparent] [--min-delta 24]
 *
 * Thoát 0 khi PASS, 1 khi FAIL (kèm JSON lý do trên stderr).
 */

const sharp = require('sharp');
const { planChannelLogo, buildLogo, ChannelLogoError } = require('./apply-channel-logo');

const DEFAULT_WIDTH_PERCENT = 7;
const DEFAULT_TOP_PERCENT = 2.2;
/**
 * Hiệu độ sáng tối thiểu (0–255) giữa nét logo và nền quanh nó để coi là "đã chèn".
 * Đo thực tế: logo trắng trên nền tối cho delta ~120–190; ảnh chưa chèn logo cho delta
 * dưới 10 (chỉ là dao động tự nhiên của nền). 24 nằm giữa hai vùng với biên rất rộng,
 * nên vừa không báo nhầm trên nền có gradient, vừa không bỏ sót logo mờ.
 */
const DEFAULT_MIN_DELTA = 24;
/** Chỉ tính pixel có alpha cao là "nét logo", bỏ rìa antialiasing pha trộn với nền. */
const MASK_ALPHA_THRESHOLD = 160;
/** Pixel gần như trong suốt mới được tính là "nền" — tránh lấy rìa nét làm nền. */
const BACKGROUND_ALPHA_THRESHOLD = 8;

function takeValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new ChannelLogoError('missing_argument', `Thiếu giá trị cho ${name}.`);
  }
  return value;
}

function parseArgs(argv) {
  const result = {
    widthPercent: DEFAULT_WIDTH_PERCENT,
    topPercent: DEFAULT_TOP_PERCENT,
    minDelta: DEFAULT_MIN_DELTA,
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
    } else if (arg === '--width-percent') {
      result.widthPercent = Number(takeValue(argv, index, arg));
      index += 1;
    } else if (arg === '--top-percent') {
      result.topPercent = Number(takeValue(argv, index, arg));
      index += 1;
    } else if (arg === '--min-delta') {
      result.minDelta = Number(takeValue(argv, index, arg));
      index += 1;
    } else if (arg === '--trim-transparent') {
      result.trimTransparent = true;
    } else {
      throw new ChannelLogoError('invalid_argument', `Tham số không hợp lệ: ${arg}`);
    }
  }
  return result;
}

function brightness(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

async function verifyChannelLogo(options = {}) {
  const minDelta = Number.isFinite(options.minDelta) ? options.minDelta : DEFAULT_MIN_DELTA;
  // Dùng chính planChannelLogo để vị trí/kích thước khớp tuyệt đối với lúc chèn.
  const plan = await planChannelLogo({
    inputPath: options.inputPath,
    logoPath: options.logoPath,
    widthPercent: options.widthPercent ?? DEFAULT_WIDTH_PERCENT,
    topPercent: options.topPercent ?? DEFAULT_TOP_PERCENT,
    trimTransparent: options.trimTransparent === true,
  });

  const logoBuffer = await buildLogo(plan.logoPath, plan.width, plan.height, plan.logoContentBox);
  const { data: mask } = await sharp(logoBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data: region, info } = await sharp(plan.inputPath)
    .removeAlpha()
    .extract({ left: plan.left, top: plan.top, width: plan.width, height: plan.height })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let logoSum = 0;
  let logoCount = 0;
  let backgroundSum = 0;
  let backgroundCount = 0;
  for (let pixel = 0; pixel < plan.width * plan.height; pixel += 1) {
    const alpha = mask[pixel * 4 + 3];
    const offset = pixel * info.channels;
    const value = brightness(region[offset], region[offset + 1], region[offset + 2]);
    if (alpha >= MASK_ALPHA_THRESHOLD) {
      logoSum += value;
      logoCount += 1;
    } else if (alpha <= BACKGROUND_ALPHA_THRESHOLD) {
      backgroundSum += value;
      backgroundCount += 1;
    }
  }
  if (logoCount === 0 || backgroundCount === 0) {
    throw new ChannelLogoError(
      'logo_mask_unusable',
      'Mask logo không có đủ pixel nét hoặc pixel nền để so sánh.',
    );
  }

  const logoBrightness = logoSum / logoCount;
  const backgroundBrightness = backgroundSum / backgroundCount;
  const delta = logoBrightness - backgroundBrightness;
  return {
    inputPath: plan.inputPath,
    logoPath: plan.logoPath,
    left: plan.left,
    top: plan.top,
    width: plan.width,
    height: plan.height,
    logoBrightness: Number(logoBrightness.toFixed(2)),
    backgroundBrightness: Number(backgroundBrightness.toFixed(2)),
    delta: Number(delta.toFixed(2)),
    minDelta,
    logoPresent: delta >= minDelta,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await verifyChannelLogo(options);
  if (!result.logoPresent) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: 'logo_missing',
      message: `Không phát hiện logo trong vùng top-center (delta ${result.delta} < ${result.minDelta}). Ảnh này chưa được chèn logo.`,
      ...result,
    }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error instanceof ChannelLogoError ? error.code : 'verify_logo_failed',
      message: error.message,
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  verifyChannelLogo,
};

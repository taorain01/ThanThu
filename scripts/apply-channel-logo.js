'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const DEFAULT_WIDTH_PERCENT = 14;
const DEFAULT_TOP_PERCENT = 2.2;

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

function parseArgs(argv) {
  const result = {
    widthPercent: DEFAULT_WIDTH_PERCENT,
    topPercent: DEFAULT_TOP_PERCENT,
    shadow: true,
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

  return {
    inputPath,
    logoPath,
    width,
    height,
    left,
    top,
    canvasWidth: inputMetadata.width,
    canvasHeight: inputMetadata.height,
  };
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
    return { dryRun: true, outputPath, ...plan };
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const logo = await sharp(plan.logoPath)
    .resize({ width: plan.width, height: plan.height, fit: 'fill' })
    .png()
    .toBuffer();
  const composites = [];
  if (options.shadow !== false) {
    const shadow = await sharp(logo)
      .tint({ r: 0, g: 0, b: 0 })
      .blur(Math.max(0.6, plan.canvasWidth / 1800))
      .png()
      .toBuffer();
    composites.push({
      input: shadow,
      left: plan.left,
      top: Math.min(plan.canvasHeight - plan.height, plan.top + Math.max(1, Math.round(plan.canvasHeight / 540))),
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

  return { dryRun: false, outputPath, ...plan };
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
  parseArgs,
  planChannelLogo,
};

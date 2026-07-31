'use strict';

const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const photon = require('@silvia-odwyer/photon-node');

const ALLOWED_IMAGE_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp']);
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

function hasImageSignature(bytes, extension) {
  if (extension === '.png') {
    return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (extension === '.webp') {
    return bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  if (extension === '.gif') {
    const signature = bytes.subarray(0, 6).toString('ascii');
    return signature === 'GIF87a' || signature === 'GIF89a';
  }
  return false;
}

function isDecodableImage(bytes) {
  let image;
  try {
    image = photon.PhotonImage.new_from_byteslice(bytes);
    return image.get_width() > 0 && image.get_height() > 0;
  } catch {
    return false;
  } finally {
    image?.free();
  }
}

function cleanReference(value) {
  let reference = String(value || '').trim();
  if (
    (reference.startsWith('"') && reference.endsWith('"'))
    || (reference.startsWith("'") && reference.endsWith("'"))
    || (reference.startsWith('`') && reference.endsWith('`'))
  ) {
    reference = reference.slice(1, -1).trim();
  }
  return reference;
}

function extractMediaReferences(value) {
  const references = [];
  const lines = String(value || '').split(/\r?\n/);
  const visibleLines = [];

  for (const line of lines) {
    const match = line.match(/^\s*MEDIA:\s*(.+?)\s*$/i);
    if (match) {
      const reference = cleanReference(match[1]);
      if (reference) {
        references.push(reference);
      }
      continue;
    }
    visibleLines.push(line);
  }

  return {
    text: visibleLines.join('\n').trim(),
    references: [...new Set(references)],
  };
}

function isInsideRoot(filePath, rootPath) {
  const relative = path.relative(rootPath, filePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function referenceToPath(reference, mediaRoot) {
  if (!reference.toLowerCase().startsWith('media://')) {
    return reference;
  }

  try {
    const url = new URL(reference);
    const relative = decodeURIComponent(`${url.hostname}${url.pathname}`)
      .replace(/^[/\\]+/, '');
    return path.join(mediaRoot, relative);
  } catch {
    return null;
  }
}

async function resolveMediaReferences(references, options = {}) {
  const openclawHome = options.openclawHome || path.join(os.homedir(), '.openclaw');
  const mediaRoot = options.mediaRoot || path.join(openclawHome, 'media');
  const allowedRoots = options.allowedRoots || [
    path.join(openclawHome, 'workspace'),
    mediaRoot,
  ];
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  const maxFiles = options.maxFiles || 8;
  const canonicalRoots = [];

  for (const root of allowedRoots) {
    try {
      canonicalRoots.push(await fs.realpath(root));
    } catch {
      // A missing optional media root is harmless.
    }
  }

  const files = [];
  const seen = new Set();
  let rejectedCount = 0;

  for (const rawReference of references || []) {
    if (files.length >= maxFiles) {
      rejectedCount += 1;
      continue;
    }

    const reference = cleanReference(rawReference);
    const candidate = referenceToPath(reference, mediaRoot);
    if (!candidate || (!path.isAbsolute(candidate) && !reference.startsWith('media://'))) {
      rejectedCount += 1;
      continue;
    }

    try {
      const realPath = await fs.realpath(candidate);
      const dedupeKey = process.platform === 'win32' ? realPath.toLowerCase() : realPath;
      if (seen.has(dedupeKey)) {
        continue;
      }
      if (!canonicalRoots.some((root) => isInsideRoot(realPath, root))) {
        rejectedCount += 1;
        continue;
      }

      const extension = path.extname(realPath).toLowerCase();
      const stat = await fs.stat(realPath);
      if (!stat.isFile() || !ALLOWED_IMAGE_EXTENSIONS.has(extension) || stat.size > maxBytes) {
        rejectedCount += 1;
        continue;
      }
      const bytes = await fs.readFile(realPath);
      if (!hasImageSignature(bytes, extension) || !isDecodableImage(bytes)) {
        rejectedCount += 1;
        continue;
      }

      seen.add(dedupeKey);
      files.push({ path: realPath, extension, size: stat.size });
    } catch {
      rejectedCount += 1;
    }
  }

  return { files, rejectedCount };
}

async function stageMediaReference(reference, options = {}) {
  const resolved = await resolveMediaReferences([reference], {
    ...options,
    maxFiles: 1,
  });
  if (resolved.files.length === 0) {
    return { artifact: null, rejectedCount: resolved.rejectedCount || 1 };
  }

  const file = resolved.files[0];
  const bytes = await fs.readFile(file.path);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const openclawHome = options.openclawHome || path.join(os.homedir(), '.openclaw');
  const outboxRoot = options.outboxRoot || path.join(openclawHome, 'media', 'discord-outbox');
  const safeJobId = String(options.jobId || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
  const directory = path.join(outboxRoot, safeJobId);
  const stagedPath = path.join(directory, `${sha256.slice(0, 24)}${file.extension}`);
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.access(stagedPath);
  } catch {
    await fs.copyFile(file.path, stagedPath);
  }

  return {
    artifact: {
      id: sha256,
      sha256,
      sourcePath: file.path,
      stagedPath,
      extension: file.extension,
      size: file.size,
    },
    rejectedCount: resolved.rejectedCount,
  };
}

async function cleanupOutbox(outboxRoot, retentionMs, now = Date.now()) {
  let entries;
  try {
    entries = await fs.readdir(outboxRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return 0;
    }
    throw error;
  }

  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const directory = path.join(outboxRoot, entry.name);
    const stat = await fs.stat(directory);
    if (now - stat.mtimeMs >= retentionMs) {
      await fs.rm(directory, { recursive: true, force: true });
      removed += 1;
    }
  }
  return removed;
}

module.exports = {
  DEFAULT_MAX_BYTES,
  cleanupOutbox,
  extractMediaReferences,
  hasImageSignature,
  isDecodableImage,
  resolveMediaReferences,
  stageMediaReference,
};

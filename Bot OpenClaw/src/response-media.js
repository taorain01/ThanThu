'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const ALLOWED_IMAGE_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp']);
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

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

      seen.add(dedupeKey);
      files.push({ path: realPath, extension, size: stat.size });
    } catch {
      rejectedCount += 1;
    }
  }

  return { files, rejectedCount };
}

module.exports = {
  DEFAULT_MAX_BYTES,
  extractMediaReferences,
  resolveMediaReferences,
};

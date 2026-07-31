'use strict';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30000;

class AttachmentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AttachmentError';
    this.code = code;
  }
}

function normalizeMime(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

function createDownloadSignal(externalSignal) {
  const timeoutSignal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  return externalSignal ? AbortSignal.any([externalSignal, timeoutSignal]) : timeoutSignal;
}

async function prepareImageParts(attachments, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const signal = options.signal;
  const items = Array.from(attachments || []);

  if (items.length > MAX_IMAGES) {
    throw new AttachmentError('too_many', `Chỉ hỗ trợ tối đa ${MAX_IMAGES} ảnh mỗi tin nhắn.`);
  }

  let declaredTotal = 0;
  for (const attachment of items) {
    const mime = normalizeMime(attachment.contentType);
    if (!ALLOWED_MIME_TYPES.has(mime)) {
      throw new AttachmentError(
        'unsupported_type',
        `File ${attachment.name || 'đính kèm'} không phải JPEG, PNG hoặc WebP.`,
      );
    }
    if (Number(attachment.size) > MAX_IMAGE_BYTES) {
      throw new AttachmentError('image_too_large', 'Mỗi ảnh phải nhỏ hơn hoặc bằng 4 MB.');
    }
    declaredTotal += Number(attachment.size) || 0;
  }
  if (declaredTotal > MAX_TOTAL_BYTES) {
    throw new AttachmentError('total_too_large', 'Tổng dung lượng ảnh phải nhỏ hơn hoặc bằng 12 MB.');
  }

  let actualTotal = 0;
  const parts = [];
  for (const attachment of items) {
    let response;
    try {
      response = await fetchImpl(attachment.url, { signal: createDownloadSignal(signal) });
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason || error;
      }
      throw new AttachmentError('download_failed', 'Không thể tải ảnh từ Discord CDN.');
    }
    if (!response.ok) {
      throw new AttachmentError('download_failed', 'Discord CDN trả lỗi khi tải ảnh.');
    }

    const originalMime = normalizeMime(attachment.contentType);
    const responseMime = normalizeMime(response.headers?.get?.('content-type'));
    const mime = ALLOWED_MIME_TYPES.has(responseMime) ? responseMime : originalMime;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) {
      throw new AttachmentError('image_too_large', 'Mỗi ảnh phải nhỏ hơn hoặc bằng 4 MB.');
    }
    actualTotal += bytes.length;
    if (actualTotal > MAX_TOTAL_BYTES) {
      throw new AttachmentError('total_too_large', 'Tổng dung lượng ảnh phải nhỏ hơn hoặc bằng 12 MB.');
    }

    parts.push({
      type: 'image_url',
      image_url: { url: `data:${mime};base64,${bytes.toString('base64')}` },
    });
  }

  return parts;
}

module.exports = {
  ALLOWED_MIME_TYPES,
  AttachmentError,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  MAX_TOTAL_BYTES,
  prepareImageParts,
};

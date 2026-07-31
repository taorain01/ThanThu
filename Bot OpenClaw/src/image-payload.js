'use strict';

const path = require('node:path');

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const IMAGE_EXTENSION_MIMES = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);
const AUDIO_MIME_TYPES = new Map([
  ['audio/aac', '.aac'],
  ['audio/flac', '.flac'],
  ['audio/mp4', '.m4a'],
  ['audio/mp3', '.mp3'],
  ['audio/mpeg', '.mp3'],
  ['audio/mpga', '.mpga'],
  ['audio/ogg', '.ogg'],
  ['audio/wav', '.wav'],
  ['audio/wave', '.wav'],
  ['audio/webm', '.webm'],
  ['audio/x-flac', '.flac'],
  ['audio/x-m4a', '.m4a'],
  ['audio/x-wav', '.wav'],
  ['application/ogg', '.ogg'],
]);
const AUDIO_EXTENSION_MIMES = new Map([
  ['.aac', 'audio/aac'],
  ['.flac', 'audio/flac'],
  ['.m4a', 'audio/mp4'],
  ['.mp3', 'audio/mpeg'],
  ['.mpga', 'audio/mpga'],
  ['.oga', 'audio/ogg'],
  ['.ogg', 'audio/ogg'],
  ['.opus', 'audio/ogg'],
  ['.wav', 'audio/wav'],
  ['.webm', 'audio/webm'],
]);
const MAX_IMAGES = 4;
const MAX_AUDIO_FILES = 2;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_AUDIO_BYTES = 40 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30000;

class AttachmentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AttachmentError';
    this.code = code;
  }
}

function normalizeMime(value) {
  const mime = String(value || '').split(';', 1)[0].trim().toLowerCase();
  if (mime === 'image/jpg') {
    return 'image/jpeg';
  }
  return mime;
}

function createDownloadSignal(externalSignal) {
  const timeoutSignal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  return externalSignal ? AbortSignal.any([externalSignal, timeoutSignal]) : timeoutSignal;
}

function attachmentName(attachment, index) {
  const name = String(attachment.name || `file-${index + 1}`)
    .replace(/[\r\n]/g, ' ')
    .trim();
  return name.slice(0, 120) || `file-${index + 1}`;
}

function classifyAttachment(attachment) {
  const mime = normalizeMime(attachment.contentType);
  const extension = path.extname(String(attachment.name || '')).toLowerCase();

  if (ALLOWED_MIME_TYPES.has(mime)) {
    return { kind: 'image', mime, extension };
  }
  if (AUDIO_MIME_TYPES.has(mime)) {
    return { kind: 'audio', mime, extension: AUDIO_MIME_TYPES.get(mime) };
  }

  if (!mime || mime === 'application/octet-stream') {
    if (IMAGE_EXTENSION_MIMES.has(extension)) {
      return { kind: 'image', mime: IMAGE_EXTENSION_MIMES.get(extension), extension };
    }
    if (AUDIO_EXTENSION_MIMES.has(extension)) {
      return {
        kind: 'audio',
        mime: AUDIO_EXTENSION_MIMES.get(extension),
        extension: AUDIO_MIME_TYPES.get(AUDIO_EXTENSION_MIMES.get(extension)) || extension,
      };
    }
  }

  throw new AttachmentError(
    'unsupported_type',
    `File ${attachment.name || 'đính kèm'} phải là ảnh JPEG/PNG/WebP hoặc âm thanh MP3/M4A/OGG/WAV/WebM/FLAC/AAC.`,
  );
}

function classifyDownloadedMime(value) {
  const mime = normalizeMime(value);
  if (ALLOWED_MIME_TYPES.has(mime)) {
    return { kind: 'image', mime };
  }
  if (AUDIO_MIME_TYPES.has(mime)) {
    return { kind: 'audio', mime, extension: AUDIO_MIME_TYPES.get(mime) };
  }
  return null;
}

function appendAudioTranscripts(text, transcripts) {
  const blocks = [];
  if (String(text || '').trim()) {
    blocks.push(String(text).trim());
  }
  for (const [index, transcript] of (transcripts || []).entries()) {
    blocks.push([
      `[Bản phiên âm file âm thanh ${index + 1}: ${transcript.name}]`,
      transcript.text,
      '[Hết bản phiên âm]',
    ].join('\n'));
  }
  return blocks.join('\n\n');
}

async function prepareMessageAttachments(attachments, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const signal = options.signal;
  const items = Array.from(attachments || []);
  const classified = items.map((attachment) => classifyAttachment(attachment));
  const imageCount = classified.filter((item) => item.kind === 'image').length;
  const audioCount = classified.filter((item) => item.kind === 'audio').length;

  if (imageCount > MAX_IMAGES) {
    throw new AttachmentError('too_many', `Chỉ hỗ trợ tối đa ${MAX_IMAGES} ảnh mỗi tin nhắn.`);
  }
  if (audioCount > MAX_AUDIO_FILES) {
    throw new AttachmentError(
      'too_many_audio',
      `Chỉ hỗ trợ tối đa ${MAX_AUDIO_FILES} file âm thanh mỗi tin nhắn.`,
    );
  }
  if (audioCount && !options.audioTranscriber) {
    throw new AttachmentError('audio_unavailable', 'Bộ phiên âm OpenClaw chưa sẵn sàng.');
  }

  let declaredImageTotal = 0;
  let declaredAudioTotal = 0;
  for (const [index, attachment] of items.entries()) {
    const size = Number(attachment.size) || 0;
    if (classified[index].kind === 'image') {
      if (size > MAX_IMAGE_BYTES) {
        throw new AttachmentError('image_too_large', 'Mỗi ảnh phải nhỏ hơn hoặc bằng 4 MB.');
      }
      declaredImageTotal += size;
    } else {
      if (size > MAX_AUDIO_BYTES) {
        throw new AttachmentError('audio_too_large', 'Mỗi file âm thanh phải nhỏ hơn hoặc bằng 20 MB.');
      }
      declaredAudioTotal += size;
    }
  }
  if (declaredImageTotal > MAX_TOTAL_BYTES) {
    throw new AttachmentError('total_too_large', 'Tổng dung lượng ảnh phải nhỏ hơn hoặc bằng 12 MB.');
  }
  if (declaredAudioTotal > MAX_TOTAL_AUDIO_BYTES) {
    throw new AttachmentError(
      'audio_total_too_large',
      'Tổng dung lượng âm thanh phải nhỏ hơn hoặc bằng 40 MB.',
    );
  }

  let actualImageTotal = 0;
  let actualAudioTotal = 0;
  const imageParts = [];
  const audioTranscripts = [];
  for (const [index, attachment] of items.entries()) {
    let response;
    try {
      response = await fetchImpl(attachment.url, { signal: createDownloadSignal(signal) });
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason || error;
      }
      throw new AttachmentError('download_failed', 'Không thể tải file đính kèm từ Discord CDN.');
    }
    if (!response.ok) {
      throw new AttachmentError('download_failed', 'Discord CDN trả lỗi khi tải file đính kèm.');
    }

    const declaredType = classified[index];
    const responseMime = normalizeMime(response.headers?.get?.('content-type'));
    const downloadedType = classifyDownloadedMime(responseMime);
    if (
      responseMime
      && responseMime !== 'application/octet-stream'
      && responseMime !== 'binary/octet-stream'
      && !downloadedType
    ) {
      throw new AttachmentError('unsupported_download_type', 'Discord CDN trả về định dạng file không được hỗ trợ.');
    }
    if (downloadedType && downloadedType.kind !== declaredType.kind) {
      throw new AttachmentError('type_mismatch', 'Định dạng file tải về không khớp file Discord.');
    }
    const fileType = downloadedType || declaredType;
    const bytes = Buffer.from(await response.arrayBuffer());

    if (fileType.kind === 'image') {
      if (bytes.length > MAX_IMAGE_BYTES) {
        throw new AttachmentError('image_too_large', 'Mỗi ảnh phải nhỏ hơn hoặc bằng 4 MB.');
      }
      actualImageTotal += bytes.length;
      if (actualImageTotal > MAX_TOTAL_BYTES) {
        throw new AttachmentError('total_too_large', 'Tổng dung lượng ảnh phải nhỏ hơn hoặc bằng 12 MB.');
      }
      imageParts.push({
        type: 'image_url',
        image_url: { url: `data:${fileType.mime};base64,${bytes.toString('base64')}` },
      });
      continue;
    }

    if (bytes.length > MAX_AUDIO_BYTES) {
      throw new AttachmentError('audio_too_large', 'Mỗi file âm thanh phải nhỏ hơn hoặc bằng 20 MB.');
    }
    actualAudioTotal += bytes.length;
    if (actualAudioTotal > MAX_TOTAL_AUDIO_BYTES) {
      throw new AttachmentError(
        'audio_total_too_large',
        'Tổng dung lượng âm thanh phải nhỏ hơn hoặc bằng 40 MB.',
      );
    }
    const name = attachmentName(attachment, index);
    await options.onAudioStart?.({ name, index });
    const transcript = await options.audioTranscriber.transcribe({
      bytes,
      extension: fileType.extension,
      mime: fileType.mime,
      signal,
    });
    audioTranscripts.push({ name, text: transcript });
    await options.onAudioComplete?.({ name, index });
  }

  return { imageParts, audioTranscripts };
}

async function prepareImageParts(attachments, options = {}) {
  const result = await prepareMessageAttachments(attachments, options);
  return result.imageParts;
}

module.exports = {
  ALLOWED_MIME_TYPES,
  AUDIO_MIME_TYPES,
  AttachmentError,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_FILES,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  MAX_TOTAL_BYTES,
  appendAudioTranscripts,
  classifyAttachment,
  prepareMessageAttachments,
  prepareImageParts,
};

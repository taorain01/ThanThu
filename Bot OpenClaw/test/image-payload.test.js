'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AttachmentError,
  MAX_AUDIO_BYTES,
  MAX_IMAGE_BYTES,
  appendAudioTranscripts,
  prepareMessageAttachments,
  prepareImageParts,
} = require('../src/image-payload');

function image(name = 'screen.png', overrides = {}) {
  return {
    name,
    url: `https://cdn.discordapp.com/${name}`,
    contentType: 'image/png',
    size: 3,
    ...overrides,
  };
}

function audio(name = 'voice.ogg', overrides = {}) {
  return {
    name,
    url: `https://cdn.discordapp.com/${name}`,
    contentType: 'audio/ogg; codecs=opus',
    size: 4,
    ...overrides,
  };
}

test('chuyển ảnh hợp lệ thành data URL', async () => {
  const calls = [];
  const parts = await prepareImageParts([image()], {
    fetchImpl: async (url) => {
      calls.push(url);
      return new Response(Buffer.from([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    },
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(parts, [{
    type: 'image_url',
    image_url: { url: 'data:image/png;base64,AQID' },
  }]);
});

test('từ chối file không phải ảnh và ảnh quá lớn trước khi tải', async () => {
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    return new Response();
  };

  await assert.rejects(
    () => prepareImageParts([image('file.pdf', { contentType: 'application/pdf' })], { fetchImpl }),
    AttachmentError,
  );
  await assert.rejects(
    () => prepareImageParts([image('big.png', { size: MAX_IMAGE_BYTES + 1 })], { fetchImpl }),
    /4 MB/,
  );
  assert.equal(fetchCalls, 0);
});

test('từ chối quá 4 ảnh', async () => {
  await assert.rejects(
    () => prepareImageParts([
      image('1.png'), image('2.png'), image('3.png'), image('4.png'), image('5.png'),
    ]),
    /tối đa 4 ảnh/,
  );
});

test('kiểm tra kích thước thật sau khi tải', async () => {
  await assert.rejects(
    () => prepareImageParts([image()], {
      fetchImpl: async () => new Response(Buffer.alloc(MAX_IMAGE_BYTES + 1), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    }),
    /4 MB/,
  );
});

test('xử lý ảnh và audio trong cùng tin nhắn rồi ghép transcript vào prompt', async () => {
  const transcribeCalls = [];
  const activity = [];
  const result = await prepareMessageAttachments([image(), audio()], {
    fetchImpl: async (url) => {
      const isAudio = url.endsWith('.ogg');
      return new Response(Buffer.from(isAudio ? [4, 5, 6, 7] : [1, 2, 3]), {
        status: 200,
        headers: { 'content-type': isAudio ? 'audio/ogg' : 'image/png' },
      });
    },
    audioTranscriber: {
      async transcribe(input) {
        transcribeCalls.push(input);
        return 'Hãy mở game ở màn hình thứ hai.';
      },
    },
    onAudioStart: ({ name }) => activity.push(`start:${name}`),
    onAudioComplete: ({ name }) => activity.push(`complete:${name}`),
  });

  assert.equal(result.imageParts.length, 1);
  assert.equal(result.audioTranscripts.length, 1);
  assert.equal(result.audioTranscripts[0].name, 'voice.ogg');
  assert.equal(transcribeCalls[0].extension, '.ogg');
  assert.deepEqual(transcribeCalls[0].bytes, Buffer.from([4, 5, 6, 7]));
  assert.deepEqual(activity, ['start:voice.ogg', 'complete:voice.ogg']);
  assert.equal(
    appendAudioTranscripts('Làm theo nội dung ghi âm.', result.audioTranscripts),
    'Làm theo nội dung ghi âm.\n\n'
      + '[Bản phiên âm file âm thanh 1: voice.ogg]\n'
      + 'Hãy mở game ở màn hình thứ hai.\n'
      + '[Hết bản phiên âm]',
  );
});

test('nhận diện audio theo đuôi file khi Discord không gửi MIME', async () => {
  const result = await prepareMessageAttachments([
    audio('memo.m4a', { contentType: null }),
  ], {
    fetchImpl: async () => new Response(Buffer.from([1, 2]), {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    }),
    audioTranscriber: { transcribe: async () => 'Xin chào' },
  });
  assert.equal(result.audioTranscripts[0].text, 'Xin chào');
});

test('giới hạn số lượng và dung lượng audio trước khi tải', async () => {
  let fetchCalls = 0;
  const options = {
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response();
    },
    audioTranscriber: { transcribe: async () => '' },
  };

  await assert.rejects(
    () => prepareMessageAttachments([audio('1.mp3'), audio('2.mp3'), audio('3.mp3')], options),
    /tối đa 2 file âm thanh/,
  );
  await assert.rejects(
    () => prepareMessageAttachments([
      audio('large.mp3', { size: MAX_AUDIO_BYTES + 1 }),
    ], options),
    /20 MB/,
  );
  assert.equal(fetchCalls, 0);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AttachmentError,
  MAX_IMAGE_BYTES,
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

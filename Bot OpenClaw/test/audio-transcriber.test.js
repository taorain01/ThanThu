'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const {
  AudioTranscriber,
  AudioTranscriptionError,
  extractTranscript,
} = require('../src/audio-transcriber');

function fakeSpawn(result, inspect) {
  return (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};

    setImmediate(async () => {
      try {
        await inspect?.({ command, args, options });
        if (result.stdout) {
          child.stdout.write(result.stdout);
        }
        if (result.stderr) {
          child.stderr.write(result.stderr);
        }
        child.stdout.end();
        child.stderr.end();
        child.emit('close', result.code ?? 0);
      } catch (error) {
        child.emit('error', error);
      }
    });
    return child;
  };
}

test('đọc transcript từ JSON của OpenClaw', () => {
  assert.equal(extractTranscript(JSON.stringify({
    outputs: [{ text: '  Mở trình duyệt giúp tôi.  ' }],
  })), 'Mở trình duyệt giúp tôi.');
  assert.throws(() => extractTranscript('{}'), AudioTranscriptionError);
  assert.throws(() => extractTranscript('không phải JSON'), /không hợp lệ/);
});

test('ghi audio tạm, gọi OpenClaw không qua shell và xóa file sau khi phiên âm', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-transcriber-test-'));
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  const bytes = Buffer.from([1, 2, 3, 4]);

  const transcriber = new AudioTranscriber({
    nodePath: 'node-test',
    openclawModulePath: 'openclaw-test.mjs',
    tempRoot,
    timeoutMs: 1000,
    spawnImpl: fakeSpawn({
      stdout: JSON.stringify({ outputs: [{ text: 'Nội dung âm thanh' }] }),
    }, async ({ command, args, options }) => {
      assert.equal(command, 'node-test');
      assert.equal(options.windowsHide, true);
      assert.equal(options.shell, undefined);
      assert.deepEqual(args.slice(0, 5), [
        'openclaw-test.mjs', 'infer', 'audio', 'transcribe', '--file',
      ]);
      assert.equal(args.at(-1), '--json');
      assert.deepEqual(await fs.readFile(args[5]), bytes);
    }),
  });

  assert.equal(await transcriber.transcribe({ bytes, extension: '.ogg' }), 'Nội dung âm thanh');
  assert.deepEqual(await fs.readdir(tempRoot), []);
});

test('không lộ stderr khi tiến trình OpenClaw thất bại', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-transcriber-test-'));
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  const transcriber = new AudioTranscriber({
    tempRoot,
    timeoutMs: 1000,
    spawnImpl: fakeSpawn({ code: 1, stderr: 'Authorization: Bearer secret-value' }),
  });

  await assert.rejects(
    () => transcriber.transcribe({ bytes: Buffer.from([1]), extension: '.mp3' }),
    (error) => (
      error instanceof AudioTranscriptionError
      && error.code === 'audio_transcription_failed'
      && !error.message.includes('secret-value')
    ),
  );
});

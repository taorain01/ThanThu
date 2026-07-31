'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const MAX_PROCESS_OUTPUT_BYTES = 1024 * 1024;

class AudioTranscriptionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AudioTranscriptionError';
    this.code = code;
  }
}

function defaultOpenClawModulePath() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'npm', 'node_modules', 'openclaw', 'openclaw.mjs');
}

function extractTranscript(stdout) {
  let payload;
  try {
    payload = JSON.parse(String(stdout || '').trim());
  } catch {
    throw new AudioTranscriptionError(
      'audio_invalid_response',
      'OpenClaw trả về kết quả phiên âm không hợp lệ.',
    );
  }

  const transcript = payload?.outputs?.[0]?.text;
  if (typeof transcript !== 'string' || !transcript.trim()) {
    throw new AudioTranscriptionError(
      'audio_empty_transcript',
      'OpenClaw không nhận diện được nội dung trong file âm thanh.',
    );
  }
  return transcript.trim();
}

function runProcess(command, args, options = {}) {
  const spawnImpl = options.spawnImpl || spawn;
  const signal = options.signal;

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(command, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;

    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const finish = (callback) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => {
      child.kill();
      finish(() => reject(signal.reason || new Error('Audio transcription aborted.')));
    };
    const collect = (target) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) {
        child.kill();
        finish(() => reject(new AudioTranscriptionError(
          'audio_output_too_large',
          'Tiến trình phiên âm trả về quá nhiều dữ liệu.',
        )));
        return;
      }
      if (target === 'stdout') {
        stdout += chunk.toString('utf8');
      } else {
        stderr += chunk.toString('utf8');
      }
    };

    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    child.once('error', (error) => finish(() => reject(error)));
    child.once('close', (code) => finish(() => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new AudioTranscriptionError(
        'audio_transcription_failed',
        'OpenClaw không thể phiên âm file âm thanh này.',
      ));
    }));

    if (signal?.aborted) {
      onAbort();
    } else {
      signal?.addEventListener('abort', onAbort, { once: true });
    }
  });
}

class AudioTranscriber {
  constructor(options = {}) {
    this.openclawModulePath = options.openclawModulePath || defaultOpenClawModulePath();
    this.nodePath = options.nodePath || process.execPath;
    this.timeoutMs = options.timeoutMs || 300000;
    this.tempRoot = options.tempRoot || os.tmpdir();
    this.spawnImpl = options.spawnImpl || spawn;
  }

  async transcribe({ bytes, extension, signal }) {
    if (!/^\.[a-z0-9]{2,5}$/.test(extension)) {
      throw new AudioTranscriptionError('audio_invalid_extension', 'Định dạng âm thanh không hợp lệ.');
    }

    const tempDir = await fs.mkdtemp(path.join(this.tempRoot, 'openclaw-discord-audio-'));
    const audioPath = path.join(tempDir, `audio${extension}`);
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const processSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;

    try {
      await fs.writeFile(audioPath, bytes, { mode: 0o600 });
      const stdout = await runProcess(
        this.nodePath,
        [
          this.openclawModulePath,
          'infer',
          'audio',
          'transcribe',
          '--file',
          audioPath,
          '--json',
        ],
        { signal: processSignal, spawnImpl: this.spawnImpl },
      );
      return extractTranscript(stdout);
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason || error;
      }
      if (timeoutSignal.aborted) {
        throw new AudioTranscriptionError(
          'audio_timeout',
          'OpenClaw phiên âm quá thời gian cho phép.',
        );
      }
      if (error instanceof AudioTranscriptionError) {
        throw error;
      }
      throw new AudioTranscriptionError(
        'audio_transcription_failed',
        'Không thể khởi chạy bộ phiên âm của OpenClaw.',
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

module.exports = {
  AudioTranscriber,
  AudioTranscriptionError,
  extractTranscript,
};

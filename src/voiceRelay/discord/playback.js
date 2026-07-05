const { PassThrough } = require('node:stream');
const {
  StreamType,
  createAudioPlayer,
  createAudioResource
} = require('@discordjs/voice');

// Frame opus "im lặng" chuẩn của Discord — dùng để giữ luồng phát sống khi chưa có audio.
const SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);
const FRAME_MS = 20;              // 1 frame opus = 20ms
const DEFAULT_JITTER_MS = 400;    // buffer chống jitter mặc định (~0.4s trễ, chịu nghẽn mạng tốt)
const MIN_PREBUFFER_FRAMES = 3;   // luôn gom tối thiểu 60ms trước khi phát
const MAX_QUEUE_SECONDS = 3;      // van an toàn: dồn quá 3s (mạng lỗi nặng) mới bỏ frame cũ

class VoiceRelayPlayback {
  constructor(logger, env = {}) {
    this.logger = logger;

    // Jitter buffer: gom bao nhiêu frame trước khi phát. Lớn hơn = trễ hơn nhưng đỡ giật hơn.
    const jitterMs = Number(env.jitterBufferMs) > 0 ? Number(env.jitterBufferMs) : DEFAULT_JITTER_MS;
    this.envJitterMs = jitterMs;
    this.prebufferFrames = Math.max(MIN_PREBUFFER_FRAMES, Math.round(jitterMs / FRAME_MS));
    this.maxQueueFrames = Math.max(this.prebufferFrames * 2, Math.round((MAX_QUEUE_SECONDS * 1000) / FRAME_MS));

    this.connection = null;
    this.player = createAudioPlayer();
    this.stream = null;
    this.subscription = null;

    // Hàng đợi frame opus của người đang giữ "slot" nói.
    this.queue = [];
    this.buffering = true;        // đang gom prebuffer

    // Khoá 1 người nói tại một thời điểm để tránh trộn opus nhiều nguồn (gây giật/vỡ).
    this.activeSpeakerKey = null;
    this.lastFrameAt = 0;
    this.speakerReleaseMs = 500; // 0 = tắt chờ nhả mic; >0 = im quá lâu này thì nhả mic cho người khác.

    this.pacer = null;

    this.player.on('error', (error) => {
      this.logger.warn('Playback audio lỗi', error.message);
      // Chỉ tạo lại luồng, không đụng pacer/queue để không làm gián đoạn nhịp phát.
      this.startStream();
    });
    // Cố ý KHÔNG tạo lại luồng khi Idle: pacer luôn chèn silence nên player không bị Idle,
    // tránh việc huỷ/tạo resource liên tục gây khựng.
  }

  attach(connection) {
    this.connection = connection;
    this.subscription = connection.subscribe(this.player);
    this.queue = [];
    this.buffering = true;
    this.activeSpeakerKey = null;
    this.startStream();
    this.startPacer();
  }

  // Cập nhật độ trễ jitter buffer lúc chạy (web chỉnh -> config đổi). ms<=0 hoặc rỗng => dùng env/mặc định.
  setJitterMs(ms) {
    const jitterMs = Number(ms) > 0 ? Number(ms) : (this.envJitterMs || DEFAULT_JITTER_MS);
    const nextPrebuffer = Math.max(MIN_PREBUFFER_FRAMES, Math.round(jitterMs / FRAME_MS));
    if (nextPrebuffer === this.prebufferFrames) return;
    this.prebufferFrames = nextPrebuffer;
    this.maxQueueFrames = Math.max(this.prebufferFrames * 2, Math.round((MAX_QUEUE_SECONDS * 1000) / FRAME_MS));
    // Gom lại buffer theo mức mới để lần phát kế tiếp áp dụng ngay, không cắt ngang câu đang nói.
    this.buffering = true;
    if (this.logger?.info) this.logger.info(`Đã đổi jitter buffer phát audio: ${jitterMs}ms (${this.prebufferFrames} frame)`);
  }

  // Cập nhật "nhường người nói": 0 = tắt chờ nhả mic; >0 = im bao lâu (ms) thì nhả mic.
  setSpeakerReleaseMs(ms) {
    const raw = Number(ms);
    const value = Number.isFinite(raw) && raw === 0
      ? 0
      : (raw > 0 ? Math.min(3000, Math.max(100, Math.round(raw))) : 500);
    if (value === this.speakerReleaseMs) return;
    this.speakerReleaseMs = value;
    if (this.logger?.info) {
      this.logger.info(value === 0 ? 'Đã tắt thời gian nhường người nói' : `Đã đổi thời gian nhường người nói: ${value}ms`);
    }
  }

  startStream() {
    if (this.stream) this.stream.destroy();
    this.stream = new PassThrough({ highWaterMark: 1 << 18 });
    const resource = createAudioResource(this.stream, { inputType: StreamType.Opus });
    this.player.play(resource);
  }

  startPacer() {
    if (this.pacer) return;
    this.pacer = setInterval(() => this.tick(), FRAME_MS);
    if (typeof this.pacer.unref === 'function') this.pacer.unref();
  }

  tick() {
    if (!this.stream || this.stream.destroyed) return;

    // Chờ gom đủ prebuffer (đầu mỗi lượt nói, hoặc sau khi bị hụt) — vẫn phát silence để giữ luồng.
    if (this.buffering) {
      if (this.queue.length < this.prebufferFrames) {
        this.safeWrite(SILENCE_FRAME);
        return;
      }
      this.buffering = false;
    }

    // Hết frame giữa chừng (underrun do mạng nghẽn): thay vì phát lắt nhắt từng frame gây giật,
    // nạp lại buffer từ đầu để lần phát sau liền mạch.
    if (this.queue.length === 0) {
      this.buffering = true;
      this.safeWrite(SILENCE_FRAME);
      return;
    }

    // Phát đều đặn 1 frame/tick. KHÔNG nhảy 2 frame để bù trễ (gây "vượt tốc" nghe như giật).
    this.safeWrite(this.queue.shift());
  }

  safeWrite(buf) {
    try {
      this.stream.write(buf);
    } catch (error) {
      this.logger.warn('Không ghi được frame playback', error.message);
      this.startStream();
    }
  }

  onAudioFrame(frame) {
    if (!this.connection || !this.stream) return;

    const key = `${frame.srcBotId}:${frame.userId}`;
    const now = Date.now();

    // Slot trống, đang tắt chờ nhả mic, hoặc người giữ slot im quá lâu → cho người này chiếm slot.
    if (this.activeSpeakerKey === null || this.speakerReleaseMs === 0 || (now - this.lastFrameAt) > this.speakerReleaseMs) {
      if (this.activeSpeakerKey !== key) {
        this.activeSpeakerKey = key;
        this.queue = [];          // đổi người → bỏ queue cũ
        this.buffering = true;    // prebuffer lại cho người mới
      }
    }

    // Chỉ nhận tiếng của người đang giữ slot; bỏ frame người khác để không trộn opus.
    if (this.activeSpeakerKey !== key) return;

    this.lastFrameAt = now;
    this.queue.push(frame.opus);
    if (this.queue.length > this.maxQueueFrames) this.queue.shift(); // van an toàn: chống trễ dồn vô hạn
  }

  stop() {
    if (this.pacer) {
      clearInterval(this.pacer);
      this.pacer = null;
    }
    if (this.stream) this.stream.destroy();
    this.stream = null;
    this.player.stop(true);
    this.subscription = null;
    this.connection = null;
    this.queue = [];
    this.activeSpeakerKey = null;
    this.buffering = true;
  }
}

module.exports = { VoiceRelayPlayback };

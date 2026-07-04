const { PassThrough } = require('node:stream');
const {
  StreamType,
  createAudioPlayer,
  createAudioResource
} = require('@discordjs/voice');

// Frame opus "im lặng" chuẩn của Discord — dùng để giữ luồng phát sống khi chưa có audio.
const SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);
const FRAME_MS = 20;              // 1 frame opus = 20ms
const PREBUFFER_FRAMES = 5;       // gom ~100ms trước khi phát để chống jitter
const MAX_QUEUE_FRAMES = 50;      // giới hạn ~1s để độ trễ không dồn vô hạn
const CATCHUP_THRESHOLD = PREBUFFER_FRAMES * 3; // nếu dồn quá thì phát bù cho kịp

class VoiceRelayPlayback {
  constructor(logger) {
    this.logger = logger;
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
    this.SPEAKER_RELEASE_MS = 500; // người đang nói im quá lâu này thì nhả slot

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

    // Chờ gom đủ prebuffer (chỉ ở đầu mỗi lượt nói mới) — vẫn phát silence để giữ luồng.
    if (this.buffering) {
      if (this.queue.length < PREBUFFER_FRAMES) {
        this.safeWrite(SILENCE_FRAME);
        return;
      }
      this.buffering = false;
    }

    const frame = this.queue.shift();
    this.safeWrite(frame || SILENCE_FRAME);

    // Nếu bị dồn (writer chậm hơn frame tới), phát bù thêm 1 frame để độ trễ không tăng dần.
    if (this.queue.length > CATCHUP_THRESHOLD) {
      const extra = this.queue.shift();
      if (extra) this.safeWrite(extra);
    }
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

    // Slot trống hoặc người đang giữ slot im quá lâu → cho người này chiếm slot.
    if (this.activeSpeakerKey === null || (now - this.lastFrameAt) > this.SPEAKER_RELEASE_MS) {
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
    if (this.queue.length > MAX_QUEUE_FRAMES) this.queue.shift(); // chống trễ dồn vô hạn
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

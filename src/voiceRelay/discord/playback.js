const { PassThrough } = require('node:stream');
const {
  AudioPlayerStatus,
  StreamType,
  createAudioPlayer,
  createAudioResource
} = require('@discordjs/voice');

class VoiceRelayPlayback {
  constructor(logger) {
    this.logger = logger;
    this.connection = null;
    this.player = createAudioPlayer();
    this.stream = null;
    this.subscription = null;
    // Khoá 1 người nói tại một thời điểm để tránh trộn opus từ nhiều nguồn (gây giật/vỡ tiếng).
    this.activeSpeakerKey = null;
    this.lastFrameAt = 0;
    this.SPEAKER_RELEASE_MS = 500; // người đang nói im quá lâu này thì nhả slot cho người khác
    this.player.on('error', (error) => {
      this.logger.warn('Playback audio lỗi', error.message);
      this.recreateStream();
    });
    this.player.on(AudioPlayerStatus.Idle, () => {
      if (this.connection) this.recreateStream();
    });
  }

  attach(connection) {
    this.connection = connection;
    this.subscription = connection.subscribe(this.player);
    this.recreateStream();
  }

  recreateStream() {
    if (this.stream) this.stream.destroy();
    this.stream = new PassThrough({ highWaterMark: 64 * 1024 });
    const resource = createAudioResource(this.stream, { inputType: StreamType.Opus });
    this.player.play(resource);
  }

  onAudioFrame(frame) {
    if (!this.connection || !this.stream || this.stream.destroyed) return;

    const key = `${frame.srcBotId}:${frame.userId}`;
    const now = Date.now();

    // Slot trống, hoặc người đang giữ slot đã im quá lâu → cho người này chiếm slot.
    if (this.activeSpeakerKey === null || (now - this.lastFrameAt) > this.SPEAKER_RELEASE_MS) {
      if (this.activeSpeakerKey !== key) {
        this.activeSpeakerKey = key;
        this.recreateStream(); // reset decoder cho sạch khi đổi người nói
      }
    }

    // Chỉ phát tiếng của người đang giữ slot; bỏ frame người khác để không trộn opus.
    if (this.activeSpeakerKey !== key) return;

    this.lastFrameAt = now;
    try {
      this.stream.write(frame.opus);
    } catch (error) {
      this.logger.warn('Không ghi được frame playback', error.message);
      this.recreateStream();
    }
  }

  stop() {
    if (this.stream) this.stream.destroy();
    this.stream = null;
    this.player.stop(true);
    this.subscription = null;
    this.connection = null;
    this.activeSpeakerKey = null;
    this.lastFrameAt = 0;
  }
}

module.exports = { VoiceRelayPlayback };

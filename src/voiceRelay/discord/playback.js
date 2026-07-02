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
  }
}

module.exports = { VoiceRelayPlayback };

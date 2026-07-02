const { EndBehaviorType } = require('@discordjs/voice');
const { evaluateSpeaker, pickActiveSpeakers, resolveTargets, roleIdsOf } = require('./rules');

class VoiceRelayCapture {
  constructor(env, relayState, logger) {
    this.env = env;
    this.relayState = relayState;
    this.logger = logger;
    this.config = null;
    this.link = null;
    this.connection = null;
    this.guild = null;
    this.active = new Map();
    this.onSpeakingStart = (userId) => this.handleSpeakingStart(userId);
  }

  setLink(link) {
    this.link = link;
  }

  updateConfig(config) {
    this.config = config;
  }

  attach(connection, guild) {
    this.detach();
    this.connection = connection;
    this.guild = guild;
    connection.receiver.speaking.on('start', this.onSpeakingStart);
  }

  detach() {
    if (this.connection?.receiver?.speaking) {
      this.connection.receiver.speaking.off('start', this.onSpeakingStart);
    }
    for (const item of this.active.values()) item.stream?.destroy();
    this.active.clear();
    this.connection = null;
    this.guild = null;
    this.relayState.update({ activeSpeakers: [] });
  }

  async handleSpeakingStart(userId) {
    if (!this.connection || !this.guild || !this.config?.relay_enabled) return;
    if (this.active.has(userId)) return;

    try {
      const member = await this.guild.members.fetch(userId).catch(() => null);
      const decision = evaluateSpeaker(member, this.config);
      if (!decision.allowed) return;

      const roleIds = roleIdsOf(member);
      const stream = this.connection.receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 150 }
      });

      this.active.set(userId, { userId, roleIds, stream, startedAt: Date.now() });
      this.updateActiveState();

      stream.on('data', (chunk) => {
        if (!this.shouldForward(userId)) return;
        if (!this.targetsPeer()) return;
        this.link?.sendAudio(userId, chunk);
      });
      stream.on('end', () => this.removeActive(userId));
      stream.on('close', () => this.removeActive(userId));
      stream.on('error', (error) => {
        this.logger.warn(`Luồng thu của user ${userId} lỗi`, error.message);
        this.removeActive(userId);
      });
    } catch (error) {
      this.logger.warn(`Không thu được voice user ${userId}`, error.message);
    }
  }

  shouldForward(userId) {
    if (!this.config?.relay_enabled) return false;
    const chosen = pickActiveSpeakers([...this.active.values()], this.config);
    return chosen.some((speaker) => String(speaker.userId) === String(userId));
  }

  targetsPeer() {
    return resolveTargets(this.config, this.env.botId).includes(this.env.peerBotId);
  }

  removeActive(userId) {
    const item = this.active.get(userId);
    if (item?.stream && !item.stream.destroyed) item.stream.destroy();
    this.active.delete(userId);
    this.updateActiveState();
  }

  updateActiveState() {
    this.relayState.update({ activeSpeakers: [...this.active.keys()] });
  }
}

module.exports = { VoiceRelayCapture };

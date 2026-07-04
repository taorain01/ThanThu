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
    this.skipLogAt = new Map();
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
    this.logger.info(`Đã gắn bộ thu voice ở guild ${guild?.id || 'unknown'}`);
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
    if (!this.connection || !this.guild) return;
    if (!this.config?.relay_enabled) {
      // Relay đang tắt → bỏ qua im lặng, không log để tránh spam mỗi khi có người nói.
      return;
    }
    if (this.active.has(userId)) return;

    try {
      const member = await this.guild.members.fetch(userId).catch(() => null);
      const decision = evaluateSpeaker(member, this.config);
      if (!decision.allowed) {
        this.logSkip(userId, decision.reason, member);
        return;
      }

      const targets = this.targets();
      if (!targets.length) {
        this.logSkip(userId, 'no_targets', member);
        return;
      }

      const roleIds = roleIdsOf(member);
      const stream = this.connection.receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 150 }
      });

      this.active.set(userId, {
        userId,
        roleIds,
        stream,
        startedAt: Date.now(),
        chunks: 0,
        bytes: 0,
        forwardedChunks: 0,
        forwardedBytes: 0,
        loggedFirstForward: false,
        label: speakerLabel(member, userId)
      });
      this.updateActiveState();
      this.logger.info(`Bắt đầu thu voice: ${speakerLabel(member, userId)}`);

      stream.on('data', (chunk) => {
        const item = this.active.get(userId);
        if (item) {
          item.chunks += 1;
          item.bytes += chunk.length || 0;
        }
        if (!this.shouldForward(userId)) return;
        const currentTargets = this.targets();
        if (!currentTargets.length) return;
        if (item) {
          item.forwardedChunks += 1;
          item.forwardedBytes += chunk.length || 0;
          if (!item.loggedFirstForward) {
            item.loggedFirstForward = true;
            this.logger.info(`Đang chuyển audio sang ${currentTargets.map((id) => `Bot${id}`).join(', ')}: ${item.label}`);
          }
        }
        this.link?.sendAudio(this.env.botId, currentTargets, userId, chunk);
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

  targets() {
    return resolveTargets(this.config, this.env.botId, this.env.allBotIds || [1, 2, 3]);
  }

  removeActive(userId) {
    const item = this.active.get(userId);
    if (item?.stream && !item.stream.destroyed) item.stream.destroy();
    this.active.delete(userId);
    if (item) {
      const durationMs = Date.now() - item.startedAt;
      this.logger.info(`Kết thúc thu voice: ${item.label}`, {
        durationMs,
        chunks: item.chunks,
        bytes: item.bytes,
        forwardedChunks: item.forwardedChunks,
        forwardedBytes: item.forwardedBytes
      });
    }
    this.updateActiveState();
  }

  updateActiveState() {
    this.relayState.update({ activeSpeakers: [...this.active.keys()] });
  }
}

function speakerLabel(member, userId) {
  const name = member?.displayName || member?.user?.username || 'unknown';
  return `${name} (${userId})`;
}

function reasonLabel(reason) {
  return {
    relay_disabled: 'relay đang tắt',
    member_not_found: 'không tìm thấy member',
    bot_user: 'người nói là bot',
    muted_user: 'bị mute riêng',
    blocked_role: 'dính blocked role',
    no_callers_configured: 'chưa chọn role/người được nói',
    missing_caller_permission: 'không có quyền nói',
    no_targets: 'không có bot đích'
  }[reason] || reason;
}

VoiceRelayCapture.prototype.logSkip = function logSkip(userId, reason, member = null) {
  const key = `${userId}:${reason}`;
  const now = Date.now();
  if (now - (this.skipLogAt.get(key) || 0) < 5000) return;
  this.skipLogAt.set(key, now);
  this.logger.info(`Bỏ qua voice: ${speakerLabel(member, userId)} - ${reasonLabel(reason)}`);
};

module.exports = { VoiceRelayCapture };

const { EventEmitter } = require('node:events');

class RelayState extends EventEmitter {
  constructor(env) {
    super();
    this.state = {
      botId: env.botId,
      botUsername: null,
      botAvatarUrl: null,
      discordConnected: false,
      voiceChannelId: null,
      voiceChannelName: null,
      relayEnabled: false,
      linkConnected: false,
      linkPeerBotId: env.peerBotId,
      linkPeerBotIds: env.peerBotIds || [],
      channelMemberCount: 0,
      lastError: null,
      activeSpeakers: []
    };
  }

  update(patch) {
    let changed = false;
    for (const [key, value] of Object.entries(patch || {})) {
      const next = Array.isArray(value) ? [...value] : value;
      if (JSON.stringify(this.state[key]) !== JSON.stringify(next)) {
        this.state[key] = next;
        changed = true;
      }
    }
    if (changed) this.emit('change', this.snapshot());
  }

  snapshot() {
    return { ...this.state, activeSpeakers: [...this.state.activeSpeakers] };
  }
}

module.exports = { RelayState };
